/**
 * Company Rules — stub (Görev 2: learned_bank_rules + rule engine köprüsü).
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";

/**
 * @returns {Promise<{ matched: boolean, partial: object, trace: object }>}
 */
export async function resolveCompanyRules(input, context, state = {}) {
  void context;

  if (state?.matched_entity?.entity_name === "SGK") {
    return {
      matched: true,
      partial: {
        decision_source: CORE_DECISION_SOURCE.COMPANY_RULE,
        confidence_score: 0.72,
        matched_rule: {
          rule_id: "stub-sgk-company",
          rule_source: "stub",
          description: "SGK stub company rule",
        },
        suggested_account_code: "361",
        suggested_counter_account_code: "102",
        suggested_document_type: "DK",
        suggested_description: "SGK ödemesi (stub kural — doğrulanmalı)",
      },
      trace: {
        stage: "company_rules",
        outcome: "matched",
        detail: "Stub SGK company rule",
      },
    };
  }

  return {
    matched: false,
    partial: {},
    trace: {
      stage: "company_rules",
      outcome: "no_match",
      detail: "Company rules resolver stub — DB not connected (Görev 2)",
    },
  };
}

/**
 * İleride bağlanacak: firma kural listesi.
 */
export async function fetchCompanyRules(_companyId, _sourceType) {
  return [];
}
