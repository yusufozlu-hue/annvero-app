/**
 * Banka önizleme — CORE satır alanları ve özet metrikleri.
 */

export function extractCorePreviewFields(coreResult = null, movement = {}) {
  if (!coreResult) {
    return {
      core_status: movement._coreSkipped
        ? "not_run"
        : movement._coreFallback
          ? movement._coreStatus || "legacy_fallback"
          : movement._coreStatus || "none",
      matched_entity: null,
      matched_rule: null,
      confidence_score:
        movement._coreConfidence == null ? null : Number(movement._coreConfidence),
      suggested_account_code: movement.counterAccountCode || null,
      suggested_cari: null,
      suggested_document_type: movement.documentType || null,
      risk_level: movement._coreRiskLevel || null,
      needs_manual_review: null,
      decision_source: movement._coreDecisionSource || null,
    };
  }

  return {
    core_status: coreResult.status || "unknown",
    matched_entity:
      coreResult.matched_entity?.entity_name ||
      coreResult.matched_entity?.name ||
      null,
    matched_rule: coreResult.matched_rule?.rule_id || null,
    confidence_score:
      coreResult.confidence_score == null ? null : Number(coreResult.confidence_score),
    suggested_account_code: coreResult.suggested_account_code || null,
    suggested_cari: coreResult.suggested_cari || null,
    suggested_document_type: coreResult.suggested_document_type || null,
    risk_level: coreResult.risk_level || null,
    needs_manual_review: coreResult.needs_manual_review ?? null,
    decision_source: coreResult.decision_source || null,
  };
}

export function computeCoreIntegrationSummary(movements = []) {
  const total = movements.length;
  let coreRecognized = 0;
  let ruleFound = 0;
  let manualReview = 0;
  let lowConfidence = 0;
  let risky = 0;
  let notRun = 0;
  let legacyFallback = 0;

  for (const movement of movements) {
    const preview = movement.corePreview || extractCorePreviewFields(null, movement);
    const status = preview.core_status || movement.core_status;
    const confidence = Number(preview.confidence_score ?? movement._coreConfidence ?? 0);
    const risk = String(preview.risk_level || movement._coreRiskLevel || "").toLowerCase();

    if (movement._coreMatched) coreRecognized += 1;
    if (preview.matched_rule || movement.matchedRule?.rule_id) ruleFound += 1;
    if (preview.needs_manual_review === true) manualReview += 1;
    if (confidence > 0 && confidence < 0.55) lowConfidence += 1;
    if (risk === "high" || risk === "critical") risky += 1;
    if (status === "not_run" || movement._coreSkipped) notRun += 1;
    if (movement._coreFallback && status !== "not_run") legacyFallback += 1;
  }

  return {
    total,
    coreRecognized,
    ruleFound,
    manualReview,
    lowConfidence,
    risky,
    notRun,
    legacyFallback,
  };
}

export function formatCorePreviewPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

export function formatCoreYesNo(value) {
  if (value === true) return "Evet";
  if (value === false) return "Hayır";
  return "—";
}

const LOW_CONFIDENCE_THRESHOLD = 0.55;
const FULL_CONFIDENCE_THRESHOLD = 1;

export function getMovementCoreStatus(movement = {}) {
  const preview =
    movement?.corePreview || extractCorePreviewFields(null, movement || {});
  return String(
    preview.core_status || movement?._coreStatus || movement?.core_status || ""
  )
    .trim()
    .toLowerCase();
}

export function isCoreStatusUnknown(movement = {}) {
  return getMovementCoreStatus(movement) === "unknown";
}

export function getCoreTeachContext(movement = {}, row = {}) {
  const preview =
    movement?.corePreview ||
    (movement ? extractCorePreviewFields(null, movement) : {});
  const decisionSource = String(
    preview.decision_source || movement?._coreDecisionSource || ""
  )
    .trim()
    .toLowerCase();
  const coreStatus = String(preview.core_status || movement?._coreStatus || "")
    .trim()
    .toLowerCase();
  const confidence = Number(preview.confidence_score ?? movement?._coreConfidence ?? 0);
  const needsReview = preview.needs_manual_review === true;
  const accountCode = String(
    preview.suggested_account_code || movement?.counterAccountCode || row?.karsiHesapKodu || ""
  ).trim();
  const coreMatchedRuleId = String(preview.matched_rule || "").trim();
  const legacyRuleId = String(movement?.matchedRule?.rule_id || movement?.matched_rule || "").trim();

  return {
    preview,
    decisionSource,
    coreStatus,
    confidence,
    needsReview,
    accountCode,
    coreMatchedRuleId,
    legacyRuleId,
    hasMatchedRule: Boolean(coreMatchedRuleId),
    hasLegacyRule: Boolean(legacyRuleId),
    hasCompanyMemory: decisionSource === "company_memory",
    hasCoreMeta: Boolean(
      movement?.corePreview ||
        movement?._coreDecisionSource ||
        movement?._coreStatus ||
        movement?._coreSkipped ||
        movement?._coreFallback
    ),
  };
}

export function hasCompanyMemoryMatch(movement = {}, row = {}) {
  return getCoreTeachContext(movement, row).hasCompanyMemory;
}

export function hasCoreMatchedRule(movement = {}, row = {}) {
  const { coreMatchedRuleId, coreStatus } = getCoreTeachContext(movement, row);
  if (!coreMatchedRuleId) return false;
  if (coreStatus === "unknown") return false;
  return Boolean(movement._coreMatched && !movement._coreFallback);
}

/**
 * Öğretme sonrası veya firma hafızasından tanınan satır.
 */
export function isMovementTaughtForDisplay(movement = {}, row = {}) {
  if (movement?._knowledgeTeachSaved) return true;

  const { decisionSource, coreStatus } = getCoreTeachContext(movement, row);
  return decisionSource === "company_memory" && coreStatus !== "unknown";
}

/**
 * CORE zaten güvenle tanıdıysa öğretme gerekmez.
 */
export function isCoreAlreadyRecognized(movement = {}, row = {}) {
  if (isMovementTaughtForDisplay(movement, row)) return true;
  if (hasCompanyMemoryMatch(movement, row)) return true;
  if (hasCoreMatchedRule(movement, row)) return true;

  const { confidence, needsReview, accountCode, coreStatus } = getCoreTeachContext(
    movement,
    row
  );

  if (coreStatus === "unknown" || coreStatus === "legacy_fallback" || coreStatus === "none") {
    return false;
  }

  if (
    movement._coreMatched &&
    !movement._coreFallback &&
    accountCode &&
    confidence >= FULL_CONFIDENCE_THRESHOLD &&
    needsReview === false
  ) {
    return true;
  }

  return false;
}

/**
 * Öğretme modalı yalnızca gerçekten öğretme gerektiğinde açılır.
 */
export function shouldOpenCoreTeachModal(movement = {}, row = {}) {
  if (isMovementTaughtForDisplay(movement, row)) return false;
  if (isCoreStatusUnknown(movement)) return true;
  if (isCoreAlreadyRecognized(movement, row)) return false;
  return movementNeedsCoreTeach(movement, row);
}

function normalizeTeachHaystack(...parts) {
  return parts
    .flat()
    .map((value) => String(value || "").trim().toLocaleLowerCase("tr"))
    .filter(Boolean)
    .join(" ");
}

/**
 * CORE önizleme / Luca satırı için öğretme gerekip gerekmediği.
 */
export function movementNeedsCoreTeach(movement = {}, row = {}) {
  if (isMovementTaughtForDisplay(movement, row)) return false;
  if (isCoreStatusUnknown(movement)) return true;
  if (isCoreAlreadyRecognized(movement, row)) return false;
  const {
    decisionSource,
    coreStatus,
    confidence,
    needsReview,
    hasCoreMeta,
    hasCompanyMemory,
  } = getCoreTeachContext(movement, row);

  if (needsReview === true) return true;
  if (confidence > 0 && confidence < LOW_CONFIDENCE_THRESHOLD) return true;
  if (confidence === 0 && hasCoreMeta) return true;

  if (movement._coreFallback && !hasCompanyMemory) return true;
  if (
    (decisionSource === "legacy" ||
      decisionSource === "legacy_fallback" ||
      decisionSource === "parser" ||
      decisionSource === "rule_engine") &&
    coreStatus === "unknown"
  ) {
    return true;
  }

  if (
    coreStatus === "legacy_fallback" ||
    coreStatus === "not_run" ||
    coreStatus === "none"
  ) {
    return true;
  }

  if (decisionSource === "manual_queue") return true;

  if (hasCoreMeta) {
    return !hasCompanyMemory;
  }

  const haystack = normalizeTeachHaystack(
    row.kontrolNotu,
    row.uyari,
    row.warning,
    row.riskDurumu,
    movement.warning
  );

  return (
    haystack.includes("kural bulunamadı") ||
    (haystack.includes("cari") && haystack.includes("bulunamadı")) ||
    haystack.includes("hesap planında bulunamadı") ||
    haystack.includes("hesap eşleşmesi bulunamadı") ||
    haystack.includes("hesap eksik") ||
    !String(row.karsiHesapKodu || movement.counterAccountCode || "").trim()
  );
}

/**
 * Satır bazlı CORE'a Öğret butonu görünürlüğü.
 */
export function shouldShowCoreTeachButton(
  row = {},
  movement = null,
  { isCoreEnabled = false } = {}
) {
  if (!isCoreEnabled) return false;
  return movementNeedsCoreTeach(movement || {}, row);
}

export function isMovementTeachable(movement = {}, row = {}) {
  return movementNeedsCoreTeach(movement, row);
}

function isCoreDecisionUsableForPreview(coreResult = {}) {
  const account = String(coreResult.suggested_account_code || "").trim();
  return Boolean(account && String(coreResult.status || "").toLowerCase() !== "unknown");
}

export function mergeCoreDecisionIntoMovement(movement = {}, coreResult = null) {
  if (!coreResult) return movement;

  const preview = extractCorePreviewFields(coreResult, movement);
  const usable = isCoreDecisionUsableForPreview(coreResult);

  return {
    ...movement,
    ...preview,
    corePreview: preview,
    _coreMatched: usable,
    _coreFallback: !usable,
    _coreSkipped: false,
    _coreStatus: coreResult.status || "unknown",
    _coreConfidence: Number(coreResult.confidence_score) || 0,
    _coreRiskLevel: coreResult.risk_level || "none",
    _coreDecisionSource: coreResult.decision_source || "unknown",
    _coreSuggestedAccountName: coreResult.suggested_account_name || "",
    _coreVatRate: coreResult.suggested_vat_rate,
    counterAccountCode: usable
      ? coreResult.suggested_account_code || movement.counterAccountCode
      : movement.counterAccountCode,
    documentType: usable
      ? coreResult.suggested_document_type || movement.documentType
      : movement.documentType,
  };
}
