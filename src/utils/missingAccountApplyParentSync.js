/**
 * Eksik Hesap apply → parent sonuç senkronu + kapanış yarışı güvenliği.
 *
 * Kök neden (production):
 * - Apply sonrası missing_apply full pipeline VALIDATION ("Son kontroller") başlatıyordu.
 * - Modal Kapat hibrit sayaç patch'i uygularken pipeline yarışıyor / hata kartı basıyordu.
 * - BANK_PRODUCT_CURRENCY ortak kuralı kaydedilse bile legacy cari hafıza fail mesajı başarıyı bozuyordu.
 */

export const MISSING_APPLY_FINAL_PHASE = "READY_FOR_EXPORT";

/**
 * @param {object|null} prev
 * @param {{
 *   pipelinePatch?: object,
 *   lucaRowCount?: number,
 *   revisionCompare?: object|null,
 *   applyGeneration?: number,
 *   movementCount?: number,
 * }} opts
 */
export function mergePipelineResultAfterMissingApply(prev = null, opts = {}) {
  const patch =
    opts.pipelinePatch && typeof opts.pipelinePatch === "object"
      ? opts.pipelinePatch
      : {};
  const base = prev && typeof prev === "object" ? prev : {};
  const missing = Number(patch.missingCount ?? base.missingCount ?? 0);
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
    opts.lucaRowCount ?? patch.lucaRowCount ?? base.lucaRowCount ?? 0
  );
  const movementCount = Number(
    opts.movementCount ??
      patch.movementCount ??
      base.movementCount ??
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
    // Contract alanlarını koru / tamamla — yalnız sayaç hibriti üretme
    movementCount: movementCount || Number(base.movementCount || 0),
    lucaRowCount,
    missingCount: missing,
    missingLucaRowCount: patch.missingLucaRowCount ?? missing,
    autoMatchedCount: autoMatched,
    uniqueUnresolvedMovements: unresolved,
    unresolvedMovementCount: unresolved,
    unrecognizedCount: patch.unrecognizedCount ?? unresolved,
    reviewRequired: missing > 0,
    reanalyzeFailed: false,
    reanalyzedWithoutReload: true,
    revisionCompare,
    // Final export readiness — validator / indirme butonları
    canAutoApprove:
      missing === 0
        ? true
        : Boolean(patch.canAutoApprove ?? base.canAutoApprove),
    terminalStatus:
      missing === 0
        ? patch.terminalStatus || base.terminalStatus || "completed"
        : patch.terminalStatus || base.terminalStatus || "review_required",
    missingApplySyncedAt: new Date().toISOString(),
    missingApplyGeneration:
      opts.applyGeneration ??
      patch.missingApplyGeneration ??
      base.missingApplyGeneration ??
      0,
  };
}

/**
 * Apply tamam + eksik 0 → parent'a atomik READY sonucu.
 * Full pipeline VALIDATION yarışını önlemek için kullanılır.
 */
export function buildFinalPipelineResultAfterMissingApply(prev = null, opts = {}) {
  const merged = mergePipelineResultAfterMissingApply(prev, opts);
  const missing = Number(merged.missingCount || 0);
  return {
    ...merged,
    reviewRequired: missing > 0,
    reanalyzeFailed: false,
    canAutoApprove: missing === 0 ? true : Boolean(merged.canAutoApprove),
    terminalStatus:
      missing === 0 ? "completed" : merged.terminalStatus || "review_required",
    missingApplyFinalized: missing === 0,
  };
}

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
 * Close sırasında parent patch uygulanmasın — canlı missing_apply / pipeline varken.
 */
export function shouldSkipCloseParentPatch({
  pipelineRunning = false,
  isReanalyzing = false,
  missingApplyOwnerActive = false,
} = {}) {
  return Boolean(
    pipelineRunning || isReanalyzing || missingApplyOwnerActive
  );
}

/**
 * Full missing_apply reanalyze yalnız hâlâ eksik varken ve kural değiştiyse.
 * Eksik 0 ise atomik finalize yeter; Son kontroller yarışını başlatma.
 */
export function shouldStartMissingApplyReanalyzeJob({
  companyMappingChanged = false,
  alreadyRunning = false,
  companyId = "",
  remainingMissingCount = 0,
} = {}) {
  if (!companyId) return false;
  if (alreadyRunning) return false;
  if (Number(remainingMissingCount) > 0 && companyMappingChanged) {
    return true;
  }
  return false;
}

/**
 * BANK_PRODUCT_CURRENCY STATEMENT_102 için legacy per-tx hafıza zorunlu değil.
 */
export function shouldPersistLegacyCariMemoryForGroup(group = {}) {
  const step = String(group?.vadeliOnboardingStep || "");
  const scope = String(group?.mappingScopeDefault || "");
  if (step === "STATEMENT_102" && scope === "BANK_PRODUCT_CURRENCY") {
    return false;
  }
  if (step === "STATEMENT_102" && !scope) {
    // Varsayılan ürün kuralı
    return false;
  }
  return true;
}

/**
 * @returns {{
 *   tone: 'success'|'warning'|'error',
 *   message: string,
 * }}
 */
export function buildMissingApplyUserMessage({
  updatedCount = 0,
  accountCode = "",
  beforeMissing = 0,
  afterMissing = 0,
  isBankProductCurrency = false,
  productMappingSaved = false,
  productMappingFailed = false,
  productMappingAlready = false,
  documentPersistOk = false,
  legacyLearnFailed = false,
} = {}) {
  const code = String(accountCode || "").trim();
  const n = Math.max(0, Number(updatedCount) || 0);
  const before = Number(beforeMissing) || 0;
  const after = Number(afterMissing) || 0;

  if (isBankProductCurrency) {
    if (productMappingSaved || productMappingAlready) {
      return {
        tone: "success",
        message: `${n} işlem ${code} hesabıyla eşleştirildi. Eksik ${before} → ${after}. VakıfBank TL vadeli ortak 102 kuralı firma için kaydedildi.`,
      };
    }
    if (productMappingFailed) {
      return {
        tone: "warning",
        message: `İşlemler bu belge için eşleştirildi ancak ortak hesap tercihi kaydedilemedi. Sonraki yüklemede yeniden sorulacak.`,
      };
    }
    return {
      tone: "success",
      message: `${n} işlem ${code} hesabıyla eşleştirildi. Eksik ${before} → ${after}.`,
    };
  }

  // Legacy / cari akış
  let suffix = "";
  if (documentPersistOk) suffix += " Belge kararı kaydedildi.";
  if (legacyLearnFailed) {
    return {
      tone: "warning",
      message: `${n} işlem ${code} hesabıyla eşleştirildi. Eksik ${before} → ${after}.${suffix} Firma hafızası kaydı başarısız.`,
    };
  }
  return {
    tone: "success",
    message: `${n} işlem ${code} hesabıyla eşleştirildi. Eksik ${before} → ${after}.${suffix}`,
  };
}

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

/**
 * missing_apply pipeline hatasında son iyi apply sonucuna dön.
 */
export function shouldRestoreLastGoodMissingApplyResult({
  reason = "",
  hasLastGood = false,
} = {}) {
  return reason === "missing_apply" && Boolean(hasLastGood);
}
