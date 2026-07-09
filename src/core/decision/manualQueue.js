/**
 * Manual Queue — son fallback.
 */

import { CORE_DECISION_SOURCE, CORE_DECISION_STATUS } from "../types/constants.js";

/**
 * @returns {{ matched: boolean, partial: object, trace: object }}
 */
export function resolveManualQueue(state = {}) {
  const hasSuggestion = Boolean(state.suggested_account_code);

  if (hasSuggestion && !state.needs_manual_review) {
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

  return {
    matched: true,
    partial: {
      status: CORE_DECISION_STATUS.MANUAL_REVIEW,
      decision_source: CORE_DECISION_SOURCE.MANUAL_QUEUE,
      needs_manual_review: true,
      suggested_description:
        state.suggested_description ||
        "Otomatik tanıma başarısız — manuel sınıflandırma kuyruğuna alınmalı.",
    },
    trace: {
      stage: "manual_queue",
      outcome: "queued",
      detail: "Routed to manual review queue (stub)",
    },
  };
}
