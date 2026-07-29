/**
 * Sync/upload retry — exponential backoff + idempotency + DB due-state.
 * Secret / Drive ID loglanmaz.
 */

export const SYNC_RETRY_MAX_ATTEMPTS = 5;
export const SYNC_RETRY_PREFIX = "sync_retry:";

export function computeSyncBackoffMs(attempt = 0, baseMs = 1000, maxMs = 60_000) {
  const n = Math.max(0, Number(attempt) || 0);
  const exp = Math.min(maxMs, baseMs * 2 ** n);
  const jitter = Math.floor(Math.random() * Math.min(250, exp * 0.1));
  return Math.min(maxMs, exp + jitter);
}

export function shouldRetrySyncAttempt(
  attempt = 0,
  maxAttempts = SYNC_RETRY_MAX_ATTEMPTS
) {
  return Number(attempt) < Number(maxAttempts);
}

export function buildUploadIdempotencyKey({
  companyId = "",
  contentHash = "",
  targetFolderPath = "",
} = {}) {
  return [
    String(companyId || "").trim(),
    String(contentHash || "").trim().toLowerCase(),
    String(targetFolderPath || "").trim(),
  ].join(":");
}

export function nextReviewStatusAfterMaxRetries() {
  return "review_required";
}

/**
 * @returns {{ pending: boolean, attempt: number, dueAtMs: number } | null}
 */
export function parseSyncRetryState(lastError = "") {
  const raw = String(lastError || "").trim();
  if (!raw.startsWith(SYNC_RETRY_PREFIX)) return null;
  const parts = raw.slice(SYNC_RETRY_PREFIX.length).split(":");
  const attempt = Number(parts[0] || 0);
  const dueAtMs = Number(parts[1] || 0);
  if (!Number.isFinite(attempt) || attempt < 1) return null;
  return {
    pending: true,
    attempt,
    dueAtMs: Number.isFinite(dueAtMs) ? dueAtMs : 0,
  };
}

export function formatSyncRetryError(attempt, dueAtMs) {
  return `${SYNC_RETRY_PREFIX}${attempt}:${dueAtMs}`;
}

export function isSyncRetryDue(lastError, nowMs = Date.now()) {
  const state = parseSyncRetryState(lastError);
  if (!state) return false;
  if (!state.dueAtMs) return true;
  return nowMs >= state.dueAtMs;
}

/**
 * Geçici ağ / timeout → retry; kalıcı yetki hatası → review.
 */
export function classifySyncFailure(error) {
  const code = String(error?.code || error?.message || "").toUpperCase();
  if (
    code.includes("TIMEOUT") ||
    code.includes("ETIMEDOUT") ||
    code.includes("ECONNRESET") ||
    code.includes("ENOTFOUND") ||
    code.includes("429") ||
    code.includes("503") ||
    code.includes("502") ||
    code.includes("SYNC_LEASE_BUSY")
  ) {
    return { retryable: true, category: "transient" };
  }
  if (
    code.includes("UNAUTHORIZED") ||
    code.includes("FORBIDDEN") ||
    code.includes("INVALID_GRANT") ||
    code.includes("TOKEN")
  ) {
    return { retryable: false, category: "auth" };
  }
  return { retryable: true, category: "unknown" };
}

/**
 * company_cloud_folders.last_error üzerinde retry kuyruğu.
 */
export async function enqueueSyncRetry(supabase, companyId, { attempt = 1 } = {}) {
  const nextAttempt = Math.max(1, Number(attempt) || 1);
  const dueAtMs = Date.now() + computeSyncBackoffMs(nextAttempt - 1);
  const last_error = formatSyncRetryError(nextAttempt, dueAtMs);
  await supabase
    .from("company_cloud_folders")
    .update({
      sync_status: "error",
      last_error,
    })
    .eq("company_id", String(companyId));
  return { attempt: nextAttempt, dueAtMs, last_error };
}

export async function clearSyncRetry(supabase, companyId) {
  await supabase
    .from("company_cloud_folders")
    .update({ last_error: null, sync_status: "ok" })
    .eq("company_id", String(companyId));
}
