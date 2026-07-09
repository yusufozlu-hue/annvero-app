/**
 * Banka önizleme — CORE satır alanları ve özet metrikleri.
 */

export function extractCorePreviewFields(coreResult = null, movement = {}) {
  if (!coreResult) {
    return {
      core_status: movement._coreSkipped ? "not_run" : movement._coreFallback ? "legacy_fallback" : "none",
      matched_entity: null,
      matched_rule: null,
      confidence_score: null,
      suggested_account_code: null,
      suggested_cari: null,
      suggested_document_type: null,
      risk_level: null,
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

export function getCoreTeachContext(movement = {}, row = {}) {
  const preview = movement?.corePreview || (movement ? extractCorePreviewFields(null, movement) : {});
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
  const matchedRuleId = String(
    preview.matched_rule || movement?.matchedRule?.rule_id || movement?.matched_rule || ""
  ).trim();

  return {
    preview,
    decisionSource,
    coreStatus,
    confidence,
    needsReview,
    accountCode,
    matchedRuleId,
    hasMatchedRule: Boolean(matchedRuleId),
    hasCompanyMemory: decisionSource === "company_memory",
  };
}

export function hasCompanyMemoryMatch(movement = {}, row = {}) {
  return getCoreTeachContext(movement, row).hasCompanyMemory;
}

export function hasMatchedRule(movement = {}, row = {}) {
  return getCoreTeachContext(movement, row).hasMatchedRule;
}

/**
 * CORE zaten firma hafızası / global kural ile tanıdıysa öğretme modalı açılmaz.
 */
export function isCoreAlreadyRecognized(movement = {}, row = {}) {
  if (hasCompanyMemoryMatch(movement, row) || hasMatchedRule(movement, row)) {
    return true;
  }

  const { confidence, needsReview, accountCode } = getCoreTeachContext(movement, row);
  if (accountCode && confidence >= FULL_CONFIDENCE_THRESHOLD && needsReview === false) {
    return true;
  }

  return false;
}

/**
 * Öğretme modalı yalnızca gerçekten öğretme gerektiğinde açılır.
 */
export function shouldOpenCoreTeachModal(movement = {}, row = {}) {
  if (isCoreAlreadyRecognized(movement, row)) return false;

  const { decisionSource, coreStatus, confidence, needsReview, accountCode } =
    getCoreTeachContext(movement, row);

  return (
    coreStatus === "unknown" ||
    coreStatus === "legacy_fallback" ||
    coreStatus === "not_run" ||
    coreStatus === "none" ||
    decisionSource === "manual_queue" ||
    confidence === 0 ||
    (confidence > 0 && confidence < LOW_CONFIDENCE_THRESHOLD) ||
    needsReview === true ||
    !accountCode
  );
}

function normalizeTeachHaystack(...parts) {
  return parts
    .flat()
    .map((value) => String(value || "").trim().toLocaleLowerCase("tr"))
    .filter(Boolean)
    .join(" ");
}

/**
 * Satır bazlı CORE'a Öğret butonu görünürlüğü.
 * Gizle: company_memory veya matched_rule varsa.
 * Göster: manual_queue, needs_manual_review, kural/hafıza yoksa.
 */
export function shouldShowCoreTeachButton(
  row = {},
  movement = null,
  { isManagementUser = false, isCoreEnabled = false } = {}
) {
  if (!isCoreEnabled || !isManagementUser) return false;

  const movementData = movement || {};

  if (hasCompanyMemoryMatch(movementData, row)) return false;
  if (hasMatchedRule(movementData, row)) return false;

  const { decisionSource, needsReview } = getCoreTeachContext(movementData, row);

  const hasCoreMeta = Boolean(
    movementData.corePreview ||
      movementData._coreDecisionSource ||
      movementData._coreStatus ||
      movementData._coreSkipped
  );

  if (hasCoreMeta) {
    return (
      decisionSource === "manual_queue" ||
      needsReview === true ||
      !hasMatchedRule(movementData, row) ||
      !hasCompanyMemoryMatch(movementData, row)
    );
  }

  const haystack = normalizeTeachHaystack(
    row.kontrolNotu,
    row.uyari,
    row.warning,
    row.riskDurumu,
    movementData.warning
  );

  return (
    haystack.includes("kural bulunamadı") ||
    haystack.includes("cari") && haystack.includes("bulunamadı") ||
    haystack.includes("hesap planında bulunamadı") ||
    haystack.includes("hesap eşleşmesi bulunamadı") ||
    haystack.includes("hesap eksik") ||
    !String(row.karsiHesapKodu || movementData.counterAccountCode || "").trim()
  );
}

export function isMovementTeachable(movement = {}, row = {}) {
  return shouldShowCoreTeachButton({}, movement, {
    isManagementUser: true,
    isCoreEnabled: true,
  });
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

