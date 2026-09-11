/**
 * Transfer cache write fence — auth/company epoch.
 * Ham satır / userId / PII taşımaz; yalnız sayısal epoch.
 */

let authEpoch = 0;
/** @type {Map<string, number>} */
const companyEpochs = new Map();

function textId(value) {
  return value == null ? "" : String(value).trim();
}

export function getTransferAuthEpoch() {
  return authEpoch;
}

export function getTransferCompanyEpoch(companyId = "") {
  const id = textId(companyId);
  if (!id) return 0;
  return companyEpochs.get(id) || 0;
}

/** Logout / user transition — tüm transfer yazımlarını geçersiz kılar. */
export function fenceAllTransfers() {
  authEpoch += 1;
  for (const [companyId, value] of companyEpochs) {
    companyEpochs.set(companyId, value + 1);
  }
  return { authEpoch, scope: "all" };
}

/** Firma A→B — yalnız A yazımlarını geçersiz kılar. */
export function fenceCompanyTransfers(companyId = "") {
  const id = textId(companyId);
  if (!id) return { companyId: "", companyEpoch: 0, scope: "company" };
  const next = (companyEpochs.get(id) || 0) + 1;
  companyEpochs.set(id, next);
  return { companyId: id, companyEpoch: next, scope: "company" };
}

/**
 * Write başlangıcında yakalanan fence token.
 * @param {{ companyId?: string, authUserId?: string, source?: string, runId?: string }} scope
 */
export function captureTransferWriteFence(scope = {}) {
  const companyId = textId(scope.companyId);
  return {
    authEpoch,
    companyEpoch: getTransferCompanyEpoch(companyId),
    companyId,
    authUserId: textId(scope.authUserId),
    source: textId(scope.source),
    runId: textId(scope.runId),
  };
}

/**
 * Commit öncesi / sonrası: epoch drift varsa stale.
 * @param {ReturnType<typeof captureTransferWriteFence>} token
 */
export function isTransferWriteFenceStale(token) {
  if (!token || typeof token !== "object") return true;
  if (Number(token.authEpoch) !== authEpoch) return true;
  const companyId = textId(token.companyId);
  if (!companyId) return true;
  if (Number(token.companyEpoch) !== getTransferCompanyEpoch(companyId)) {
    return true;
  }
  return false;
}

/** Test-only */
export function __resetTransferCacheFenceForTests() {
  authEpoch = 0;
  companyEpochs.clear();
}
