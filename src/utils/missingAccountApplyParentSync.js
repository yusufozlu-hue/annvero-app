/**
 * Eksik Hesap Çözüm Merkezi apply → Banka Parser parent sonuç senkronu.
 * Modal içi sayaçlar parent kartına taşınır; mükerrer kart etiketi korunabilir.
 */

/**
 * @param {object|null} prev
 * @param {{
 *   pipelinePatch?: object,
 *   lucaRowCount?: number,
 *   revisionCompare?: object|null,
 *   applyGeneration?: number,
 * }} opts
 */
export function mergePipelineResultAfterMissingApply(prev = null, opts = {}) {
  const patch =
    opts.pipelinePatch && typeof opts.pipelinePatch === "object"
      ? opts.pipelinePatch
      : {};
  const base = prev && typeof prev === "object" ? prev : {};
  const missing = Number(
    patch.missingCount ?? base.missingCount ?? 0
  );
  const autoMatched = Number(
    patch.autoMatchedCount ?? base.autoMatchedCount ?? 0
  );
  const unresolved = Number(
    patch.uniqueUnresolvedMovements ??
      patch.unresolvedMovementCount ??
      base.uniqueUnresolvedMovements ??
      base.unresolvedMovementCount ??
      0
  );
  const lucaRowCount = Number(
    opts.lucaRowCount ??
      patch.lucaRowCount ??
      base.lucaRowCount ??
      0
  );
  const revisionCompare =
    opts.revisionCompare ||
    patch.revisionCompare ||
    base.revisionCompare ||
    null;

  return {
    ...base,
    ...patch,
    lucaRowCount,
    missingCount: missing,
    missingLucaRowCount:
      patch.missingLucaRowCount ?? missing,
    autoMatchedCount: autoMatched,
    uniqueUnresolvedMovements: unresolved,
    unresolvedMovementCount: unresolved,
    unrecognizedCount:
      patch.unrecognizedCount ?? unresolved,
    reviewRequired: missing > 0,
    reanalyzedWithoutReload: true,
    revisionCompare,
    missingApplySyncedAt: new Date().toISOString(),
    missingApplyGeneration:
      opts.applyGeneration ??
      patch.missingApplyGeneration ??
      base.missingApplyGeneration ??
      0,
  };
}

/**
 * Stale apply sonucu yeni generation'ı ezmesin.
 */
export function shouldAcceptMissingApplyParentSync({
  applyGeneration = 0,
  activeGeneration = 0,
} = {}) {
  const apply = Number(applyGeneration) || 0;
  const active = Number(activeGeneration) || 0;
  if (!apply || !active) return true;
  return apply === active;
}

/**
 * Apply → tek otomatik reanalyze job başlatılsın mı?
 */
export function shouldStartMissingApplyReanalyzeJob({
  companyMappingChanged = false,
  alreadyRunning = false,
  companyId = "",
} = {}) {
  if (!companyId) return false;
  if (alreadyRunning) return false;
  return Boolean(companyMappingChanged);
}

/**
 * Double-click / busy: kırmızı hata yerine bilgi veya sessiz.
 * @returns {{ level: 'info'|'error'|null, message: string }}
 */
export function resolveMissingApplyReanalyzeBusyFeedback({
  reason = "manual",
  claimReason = "",
  isLiveBusy = false,
} = {}) {
  if (claimReason === "join_in_flight" || claimReason === "in_flight") {
    if (reason === "manual" || reason === "retry") {
      return {
        level: "info",
        message: "Yeniden analiz tamamlanıyor",
      };
    }
    return { level: null, message: "" };
  }
  if (claimReason === "job_busy") {
    if (!isLiveBusy) {
      return { level: null, message: "" };
    }
    if (reason === "manual" || reason === "retry") {
      return {
        level: "info",
        message: "Yeniden analiz tamamlanıyor",
      };
    }
    return { level: null, message: "" };
  }
  return { level: null, message: "" };
}
