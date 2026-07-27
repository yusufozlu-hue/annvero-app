/**
 * Sync/upload retry yardımcıları — exponential backoff + idempotency.
 */

export const SYNC_RETRY_MAX_ATTEMPTS = 5;

export function computeSyncBackoffMs(attempt = 0, baseMs = 1000, maxMs = 60_000) {
  const n = Math.max(0, Number(attempt) || 0);
  const exp = Math.min(maxMs, baseMs * 2 ** n);
  const jitter = Math.floor(Math.random() * Math.min(250, exp * 0.1));
  return Math.min(maxMs, exp + jitter);
}

export function shouldRetrySyncAttempt(attempt = 0, maxAttempts = SYNC_RETRY_MAX_ATTEMPTS) {
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
