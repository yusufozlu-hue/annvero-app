/**
 * Confidence Engine — skor normalizasyonu ve status türetme.
 */

import {
  CORE_DECISION_SOURCE,
  CORE_DECISION_STATUS,
  CORE_MIN_CONFIDENCE_RECOGNIZED,
  CORE_MIN_CONFIDENCE_SUGGESTED,
} from "../types/constants.js";

/**
 * @param {object} state — birleştirilmiş pipeline state
 * @returns {{ matched: boolean, partial: object, trace: object }}
 */
export function applyConfidenceEngine(state = {}) {
  let score = Number(state.confidence_score) || 0;

  if (state.matched_entity?.is_stub) {
    score = Math.min(score, 0.75);
  }
  if (state.matched_rule?.is_stub) {
    score = Math.min(score, 0.7);
  }
  if (state.risk_flags?.includes("example_global_rule")) {
    score = Math.min(score, 0.55);
  }

  let status = CORE_DECISION_STATUS.UNKNOWN;
  if (score >= CORE_MIN_CONFIDENCE_RECOGNIZED && state.suggested_account_code) {
    status = CORE_DECISION_STATUS.RECOGNIZED;
  } else if (score >= CORE_MIN_CONFIDENCE_SUGGESTED) {
    status = CORE_DECISION_STATUS.SUGGESTED;
  } else if (state.matched_entity || state.matched_rule) {
    status = CORE_DECISION_STATUS.SUGGESTED;
  }

  return {
    matched: true,
    partial: {
      decision_source: CORE_DECISION_SOURCE.CONFIDENCE,
      confidence_score: Number(score.toFixed(4)),
      status,
    },
    trace: {
      stage: "confidence",
      outcome: status,
      detail: `Final confidence: ${score.toFixed(2)}`,
    },
  };
}
