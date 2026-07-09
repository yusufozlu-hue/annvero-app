/**
 * Ortak CORE karar sonucu formatı.
 */

import {
  CORE_DECISION_SOURCE,
  CORE_DECISION_STATUS,
  CORE_RISK_LEVEL,
} from "./constants.js";

function empty(value) {
  return value == null ? "" : String(value).trim();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Boş / varsayılan karar sonucu.
 */
export function createCoreDecisionResult(partial = {}) {
  return {
    status: empty(partial.status) || CORE_DECISION_STATUS.UNKNOWN,
    decision_source: empty(partial.decision_source || partial.decisionSource) || CORE_DECISION_SOURCE.UNKNOWN,
    confidence_score: num(partial.confidence_score ?? partial.confidenceScore, 0),
    matched_entity: partial.matched_entity ?? partial.matchedEntity ?? null,
    matched_rule: partial.matched_rule ?? partial.matchedRule ?? null,
    suggested_account_code: empty(partial.suggested_account_code || partial.suggestedAccountCode) || null,
    suggested_account_name: empty(partial.suggested_account_name || partial.suggestedAccountName) || null,
    suggested_counter_account_code:
      empty(partial.suggested_counter_account_code || partial.suggestedCounterAccountCode) || null,
    suggested_cari: empty(partial.suggested_cari || partial.suggestedCari) || null,
    suggested_document_type: empty(partial.suggested_document_type || partial.suggestedDocumentType) || null,
    suggested_vat_rate:
      partial.suggested_vat_rate == null && partial.suggestedVatRate == null
        ? null
        : num(partial.suggested_vat_rate ?? partial.suggestedVatRate, null),
    suggested_description: empty(partial.suggested_description || partial.suggestedDescription) || "",
    risk_level: empty(partial.risk_level || partial.riskLevel) || CORE_RISK_LEVEL.NONE,
    risk_flags: Array.isArray(partial.risk_flags || partial.riskFlags)
      ? partial.risk_flags || partial.riskFlags
      : [],
    needs_manual_review: Boolean(partial.needs_manual_review ?? partial.needsManualReview),
    debug_trace: Array.isArray(partial.debug_trace || partial.debugTrace)
      ? partial.debug_trace || partial.debugTrace
      : [],
  };
}

/**
 * Pipeline ara sonucunu ana sonuca birleştirir (dolu alanlar kazanır).
 */
export function mergeCoreDecisionResult(base = {}, partial = {}) {
  const next = createCoreDecisionResult(base);

  if (partial.status) next.status = partial.status;
  if (partial.decision_source) next.decision_source = partial.decision_source;
  if (partial.confidence_score > 0) next.confidence_score = partial.confidence_score;
  if (partial.matched_entity) next.matched_entity = partial.matched_entity;
  if (partial.matched_rule) next.matched_rule = partial.matched_rule;
  if (partial.suggested_account_code) next.suggested_account_code = partial.suggested_account_code;
  if (partial.suggested_account_name) next.suggested_account_name = partial.suggested_account_name;
  if (partial.suggested_counter_account_code) {
    next.suggested_counter_account_code = partial.suggested_counter_account_code;
  }
  if (partial.suggested_cari) next.suggested_cari = partial.suggested_cari;
  if (partial.suggested_document_type) next.suggested_document_type = partial.suggested_document_type;
  if (partial.suggested_vat_rate != null) next.suggested_vat_rate = partial.suggested_vat_rate;
  if (partial.suggested_description) next.suggested_description = partial.suggested_description;
  if (partial.risk_level) next.risk_level = partial.risk_level;
  if (partial.risk_flags?.length) next.risk_flags = [...new Set([...next.risk_flags, ...partial.risk_flags])];
  if (partial.needs_manual_review) next.needs_manual_review = true;
  if (partial.debug_trace?.length) next.debug_trace = [...next.debug_trace, ...partial.debug_trace];

  return next;
}

export function createValidationFailureResult(errorMessage, debugTrace = []) {
  return createCoreDecisionResult({
    status: CORE_DECISION_STATUS.MANUAL_REVIEW,
    decision_source: CORE_DECISION_SOURCE.UNKNOWN,
    confidence_score: 0,
    needs_manual_review: true,
    suggested_description: errorMessage,
    risk_level: CORE_RISK_LEVEL.MEDIUM,
    risk_flags: ["validation_failed"],
    debug_trace: debugTrace,
  });
}
