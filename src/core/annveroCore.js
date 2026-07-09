/**
 * ANNVERO CORE — merkezi muhasebe karar giriş noktası.
 *
 * Güvenlik: yalnızca server/API katmanından çağrılmalıdır.
 * Client bundle'a export edilmemelidir.
 */

import { runDecisionPipeline } from "./decision/decisionEngine.js";
import {
  assertCompanyAccessInContext,
  validateCoreContext,
} from "./types/decisionContext.js";
import { validateCoreInput } from "./types/decisionInput.js";
import { createValidationFailureResult } from "./types/decisionResult.js";
import { CORE_DECISION_STATUS, CORE_RISK_LEVEL } from "./types/constants.js";

/**
 * Muhasebe kararı üretir.
 *
 * @param {object} input — işlem girdisi (source_type, company_id, raw_description, …)
 * @param {object} context — server context (user_id, module, company_access, …)
 * @returns {Promise<import('./types/decisionResult').CoreDecisionResult>}
 */
export async function resolveAccountingDecision(input = {}, context = {}) {
  const debugTrace = [];

  try {
    const inputCheck = validateCoreInput(input);
    if (!inputCheck.ok) {
      return createValidationFailureResult(inputCheck.error, [
        { stage: "validation", outcome: "input_failed", detail: inputCheck.error },
      ]);
    }

    const contextCheck = validateCoreContext(context);
    if (!contextCheck.ok) {
      return createValidationFailureResult(contextCheck.error, [
        { stage: "validation", outcome: "context_failed", detail: contextCheck.error },
      ]);
    }

    if (!assertCompanyAccessInContext(inputCheck.value.company_id, contextCheck.value)) {
      return createValidationFailureResult("Bu firmaya erişim yetkisi yok.", [
        { stage: "validation", outcome: "forbidden", detail: "company_access mismatch" },
      ]);
    }

    debugTrace.push({
      stage: "validation",
      outcome: "ok",
      detail: `module=${contextCheck.value.module}`,
    });

    const result = await runDecisionPipeline(inputCheck.value, {
      ...contextCheck.value,
      supabase: context.supabase || contextCheck.value.supabase || null,
      debug_trace: debugTrace,
    });

    return result;
  } catch (error) {
    console.error("[annvero-core] resolveAccountingDecision failed", error);

    return createValidationFailureResult(
      error?.message || "CORE karar motoru beklenmeyen hata.",
      [
        ...debugTrace,
        {
          stage: "core",
          outcome: "error",
          detail: error?.message || "unknown error",
        },
      ]
    );
  }
}

/**
 * CORE'un kullanılabilir olup olmadığını kontrol eder (health check).
 */
export function isAnnveroCoreAvailable() {
  return true;
}

export { CORE_DECISION_STATUS, CORE_RISK_LEVEL };
