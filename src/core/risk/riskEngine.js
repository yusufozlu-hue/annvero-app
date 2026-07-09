/**
 * Risk Engine — risk bayrakları ve manuel inceleme tetikleyicileri.
 */

import { CORE_DECISION_SOURCE, CORE_DECISION_STATUS, CORE_RISK_LEVEL } from "../types/constants.js";

/**
 * @param {object} state
 * @returns {{ matched: boolean, partial: object, trace: object }}
 */
export function applyRiskEngine(state = {}) {
  const flags = [...(state.risk_flags || [])];
  let riskLevel = state.risk_level || CORE_RISK_LEVEL.NONE;
  let needsManualReview = Boolean(state.needs_manual_review);

  if (state.matched_rule?.is_stub || state.matched_entity?.is_stub) {
    flags.push("stub_data");
    riskLevel = riskLevel === CORE_RISK_LEVEL.NONE ? CORE_RISK_LEVEL.LOW : riskLevel;
  }

  if (flags.includes("example_global_rule")) {
    riskLevel = CORE_RISK_LEVEL.MEDIUM;
    if (!state.matched_rule?.rule_id || !state.suggested_account_code) {
      needsManualReview = true;
    }
    flags.push("unverified_account_codes");
  }

  if (!state.suggested_account_code && state.status === CORE_DECISION_STATUS.UNKNOWN) {
    flags.push("missing_account_suggestion");
    needsManualReview = true;
    riskLevel = CORE_RISK_LEVEL.MEDIUM;
  }

  if ((state.confidence_score || 0) < 0.55) {
    flags.push("low_confidence");
    if (riskLevel === CORE_RISK_LEVEL.NONE) riskLevel = CORE_RISK_LEVEL.LOW;
  }

  let status = state.status;
  if (needsManualReview && status !== CORE_DECISION_STATUS.RECOGNIZED) {
    status = CORE_DECISION_STATUS.MANUAL_REVIEW;
  }
  if (riskLevel === CORE_RISK_LEVEL.HIGH || riskLevel === CORE_RISK_LEVEL.CRITICAL) {
    status = CORE_DECISION_STATUS.RISKY;
  }

  return {
    matched: true,
    partial: {
      decision_source: CORE_DECISION_SOURCE.RISK,
      status,
      risk_level: riskLevel,
      risk_flags: [...new Set(flags)],
      needs_manual_review: needsManualReview,
    },
    trace: {
      stage: "risk",
      outcome: riskLevel,
      detail: `Flags: ${[...new Set(flags)].join(", ") || "none"}`,
    },
  };
}
