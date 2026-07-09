/**
 * Manual Queue — son fallback.
 */

import { CORE_DECISION_SOURCE, CORE_DECISION_STATUS } from "../types/constants.js";

function hasMatch(state = {}) {
  return Boolean(
    state.from_company_memory ||
      state.matched_entity?.id ||
      state.matched_entity?.entity_name ||
      state.matched_rule?.rule_id ||
      state.suggested_account_code
  );
}

/**
 * @returns {{ matched: boolean, partial: object, trace: object }}
 */
export function resolveManualQueue(state = {}) {
  const hasSuggestion = Boolean(state.suggested_account_code);
  const matched = hasMatch(state);

  if (matched && hasSuggestion && !state.needs_manual_review) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "manual_queue",
        outcome: "skipped",
        detail: "Decision sufficient — manual queue not required",
      },
    };
  }

  if (!matched) {
    return {
      matched: true,
      partial: {
        status: CORE_DECISION_STATUS.UNKNOWN,
        decision_source: CORE_DECISION_SOURCE.MANUAL_QUEUE,
        confidence_score: 0,
        needs_manual_review: true,
        suggested_description:
          "Otomatik tanıma başarısız — manuel sınıflandırma kuyruğuna alınmalı.",
      },
      trace: {
        stage: "manual_queue",
        outcome: "unknown",
        detail: "No match — unknown/manual review",
      },
    };
  }

  return {
    matched: true,
    partial: {
      status: CORE_DECISION_STATUS.MANUAL_REVIEW,
      decision_source: CORE_DECISION_SOURCE.MANUAL_QUEUE,
      needs_manual_review: true,
      suggested_description:
        state.suggested_description ||
        "Düşük güven skoru — manuel inceleme önerilir.",
    },
    trace: {
      stage: "manual_queue",
      outcome: "queued",
      detail: "Routed to manual review queue",
    },
  };
}
