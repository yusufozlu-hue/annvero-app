/**
 * Transfer cache lifecycle — logout / user change / company switch.
 * Yalnız luca transfer IDB + pointer + pending + memory/gates.
 * localStorage.clear / deleteDatabase yok. Satır/PII loglanmaz.
 */

import {
  fenceAllTransfers,
  fenceCompanyTransfers,
  getTransferAuthEpoch,
} from "@/src/utils/transferCacheFence";
import {
  clearAllLucaTransferDatasets,
  clearCompanyLucaTransferDatasets,
  PENDING_LUCA_ROWS_STORAGE_KEY,
} from "@/src/utils/companyCenter";
import { clearCanonicalTransferRuntimeCaches } from "@/src/utils/canonicalFisControlTransfer";

export const TRANSFER_CLEANUP_PENDING_KEY = "annvero:transfer_cleanup_pending_v1";

const CLEANUP_TIMEOUT_MS = 2500;

function textId(value) {
  return value == null ? "" : String(value).trim();
}

function transferLifecycleLog(code) {
  console.warn(`[transfer-cache] ${String(code || "error")}`);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      window.setTimeout(() => resolve({ ok: false, timedOut: true }), ms);
    }),
  ]);
}

function readPendingCleanup() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(TRANSFER_CLEANUP_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePendingCleanup(payload) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      TRANSFER_CLEANUP_PENDING_KEY,
      JSON.stringify(payload)
    );
  } catch {
    // ignore
  }
}

function clearPendingCleanupFlag() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(TRANSFER_CLEANUP_PENDING_KEY);
  } catch {
    // ignore
  }
}

/**
 * Logout timeout / abort — bootstrap retry için.
 * companyId / userId / run / PII yok. type: "all" | "company".
 */
export function markTransferCleanupRetryPending(scope = { type: "all" }) {
  const type = scope?.type === "company" ? "company" : "all";
  writePendingCleanup({
    type,
    authEpoch: getTransferAuthEpoch(),
    at: Date.now(),
  });
}

export function clearTransferCleanupRetryPending() {
  clearPendingCleanupFlag();
}

function clearRuntimeCachesForScope(companyId = "") {
  const company = textId(companyId);
  clearCanonicalTransferRuntimeCaches(
    company ? { companyId: company } : { all: true }
  );
}

/** Senkron fence — write’lar hemen stale olur. */
export function synchronouslyFenceAllTransfers() {
  return fenceAllTransfers();
}

export function synchronouslyFenceCompanyTransfers(companyId = "") {
  return fenceCompanyTransfers(companyId);
}

/**
 * Tüm transfer cache temizliği (logout / user change).
 * @returns {Promise<{ ok: boolean, code?: string }>}
 */
export async function clearAllTransferCache() {
  if (typeof window === "undefined") {
    return { ok: false, code: "window_unavailable" };
  }

  clearRuntimeCachesForScope();
  try {
    const result = await clearAllLucaTransferDatasets();
    if (result?.ok) {
      clearPendingCleanupFlag();
      return { ok: true, code: "cleared_all" };
    }
    markTransferCleanupRetryPending({ type: "all" });
    transferLifecycleLog("clear_all_incomplete");
    return { ok: false, code: "clear_all_incomplete" };
  } catch {
    markTransferCleanupRetryPending({ type: "all" });
    transferLifecycleLog("clear_all_failed");
    return { ok: false, code: "clear_all_failed" };
  }
}

/**
 * Yalnız bir firmaya ait transfer residue.
 * @returns {Promise<{ ok: boolean, code?: string }>}
 */
export async function clearCompanyTransferCache(companyId = "") {
  const company = textId(companyId);
  if (!company) return { ok: false, code: "missing_company" };
  if (typeof window === "undefined") {
    return { ok: false, code: "window_unavailable" };
  }

  clearRuntimeCachesForScope(company);
  try {
    const result = await clearCompanyLucaTransferDatasets(company);
    if (result?.ok) {
      const pending = readPendingCleanup();
      // Yalnız company-scoped pending kaldırılır; logout type:"all" korunur
      if (pending?.type === "company") clearPendingCleanupFlag();
      return { ok: true, code: "cleared_company" };
    }
    // companyId saklanmaz — fail-closed escalate to all
    markTransferCleanupRetryPending({ type: "all" });
    transferLifecycleLog("clear_company_incomplete");
    return { ok: false, code: "clear_company_incomplete" };
  } catch {
    markTransferCleanupRetryPending({ type: "all" });
    transferLifecycleLog("clear_company_failed");
    return { ok: false, code: "clear_company_failed" };
  }
}

/**
 * Logout / signOut öncesi fence + timeout’lu cleanup.
 * Redirect’i kilitlemez; başarısızsa retry-pending bırakır.
 */
export async function runLogoutTransferCleanup() {
  synchronouslyFenceAllTransfers();
  markTransferCleanupRetryPending({ type: "all" });
  if (typeof window === "undefined") {
    return { ok: false, code: "window_unavailable", fenced: true };
  }
  const result = await withTimeout(clearAllTransferCache(), CLEANUP_TIMEOUT_MS);
  if (result?.timedOut) {
    markTransferCleanupRetryPending({ type: "all" });
    transferLifecycleLog("clear_all_timeout");
    return { ok: false, code: "timeout", fenced: true };
  }
  // clearAllTransferCache başarıda pending’i kaldırır; fail’de yeniden yazar
  return { ...result, fenced: true };
}

/**
 * AuthGate güvenlik ağı: gerçek SIGNED_OUT veya user A→B.
 * Bootstrap null / TOKEN_REFRESHED çağırmaz (çağıran filtreler).
 */
export async function handleAuthenticatedUserTransition(
  previousUserId = "",
  nextUserId = ""
) {
  const prev = textId(previousUserId);
  const next = textId(nextUserId);

  // null→user (login bootstrap): wipe yok
  if (!prev && next) {
    return { ok: true, code: "noop_login" };
  }
  // aynı kullanıcı
  if (prev && next && prev === next) {
    return { ok: true, code: "noop_same_user" };
  }
  // user→null (SIGNED_OUT) veya A→B
  if ((prev && !next) || (prev && next && prev !== next)) {
    synchronouslyFenceAllTransfers();
    markTransferCleanupRetryPending({ type: "all" });
    return clearAllTransferCache();
  }
  return { ok: true, code: "noop" };
}

/** Bootstrap: pending cleanup retry — hydrate öncesi await edilmeli. */
export async function retryPendingTransferCleanupIfNeeded() {
  const pending = readPendingCleanup();
  if (!pending) return { ok: true, code: "noop" };
  // companyId yok → her pending fail-closed full clear
  return clearAllTransferCache();
}

/** Test helper — pending flag */
export function __getTransferCleanupPendingForTests() {
  return readPendingCleanup();
}

export function __setTransferCleanupPendingForTests(payload) {
  if (payload == null) clearPendingCleanupFlag();
  else writePendingCleanup(payload);
}

// Re-export key name for tests (pending luca must stay in clearAll path)
export { PENDING_LUCA_ROWS_STORAGE_KEY };
