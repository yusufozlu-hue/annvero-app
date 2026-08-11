/**
 * Yeniden-analiz tıklama kapısı — loading her zaman ilk senkron adım.
 * Sessiz no-op yok: kilit / busy durumları açıkça raporlanır.
 */

export const REANALYZE_CLICK_BUSY_TOAST =
  "Yeniden analiz zaten sürüyor veya başka bir banka işlemi devam ediyor.";

/**
 * @param {{
 *   lockRef: { current: boolean },
 *   isReanalyzing: boolean,
 *   isJobBusy: boolean,
 *   pipelineRunning?: boolean,
 *   setIsReanalyzing: (v: boolean) => void,
 * }} args
 * @returns {{ ok: true } | { ok: false, reason: 'in_flight' | 'job_busy', healedOrphanLock?: boolean }}
 */
export function claimReanalyzeClick({
  lockRef,
  isReanalyzing,
  isJobBusy,
  pipelineRunning = false,
  setIsReanalyzing,
}) {
  let healedOrphanLock = false;
  // Önceki turda finally kaçtıysa: idle UI + kilitli ref → self-heal
  if (
    lockRef?.current &&
    !isReanalyzing &&
    !pipelineRunning &&
    !isJobBusy
  ) {
    lockRef.current = false;
    healedOrphanLock = true;
  }

  if (lockRef?.current || isReanalyzing) {
    return { ok: false, reason: "in_flight", healedOrphanLock };
  }

  // İlk senkron işlem: kilit + loading (await / isJobBusy kontrolünden önce)
  lockRef.current = true;
  setIsReanalyzing(true);

  if (isJobBusy || pipelineRunning) {
    return { ok: false, reason: "job_busy", healedOrphanLock };
  }

  return { ok: true, healedOrphanLock };
}

export function releaseReanalyzeClick({
  lockRef,
  setIsReanalyzing,
  clearOverrides,
} = {}) {
  if (typeof setIsReanalyzing === "function") {
    setIsReanalyzing(false);
  }
  if (lockRef) {
    lockRef.current = false;
  }
  if (typeof clearOverrides === "function") {
    clearOverrides();
  }
}
