/**
 * AI Stub — gerçek AI çağrısı yok (Görev 5).
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";

/**
 * @returns {{ matched: boolean, partial: object, trace: object }}
 */
export function resolveAiStub(state = {}) {
  const shouldTryAi =
    !state.suggested_account_code &&
    (state.status === "unknown" || state.status === "suggested");

  if (!shouldTryAi) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "ai_stub",
        outcome: "skipped",
        detail: "AI stub skipped — sufficient prior match",
      },
    };
  }

  return {
    matched: false,
    partial: {
      decision_source: CORE_DECISION_SOURCE.AI_STUB,
    },
    trace: {
      stage: "ai_stub",
      outcome: "not_implemented",
      detail: "AI integration not implemented (Görev 5)",
    },
  };
}
