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
