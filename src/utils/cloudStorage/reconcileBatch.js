/**
 * Reconcile zaman bütçesi — Vercel 60s altında güvenli batch.
 */

export const RECONCILE_TIME_BUDGET_MS = 45_000;
export const RECONCILE_MAX_COMPANIES_PER_RUN = 8;

export function sortCompanyIds(ids = []) {
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "tr"));
}

/**
 * @param {string[]} allIds
 * @param {{ cursor?: string, limit?: number }} opts
 */
export function sliceReconcileBatch(allIds, { cursor = "", limit } = {}) {
  const sorted = sortCompanyIds(allIds);
  const max = Math.max(1, Number(limit) || RECONCILE_MAX_COMPANIES_PER_RUN);
  let start = 0;
  if (cursor) {
    const idx = sorted.indexOf(String(cursor));
    start = idx >= 0 ? idx + 1 : 0;
  }
  const batch = sorted.slice(start, start + max);
  const nextCursor =
    start + batch.length < sorted.length && batch.length
      ? batch[batch.length - 1]
      : "";
  return {
    batch,
    nextCursor,
    total: sorted.length,
    done: start + batch.length >= sorted.length,
  };
}

export function reconcileTimeRemaining(startMs, budgetMs = RECONCILE_TIME_BUDGET_MS) {
  return Math.max(0, budgetMs - (Date.now() - startMs));
}
