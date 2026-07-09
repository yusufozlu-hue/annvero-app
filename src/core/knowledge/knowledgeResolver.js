/**
 * Global Knowledge + Accounting Rules — stub (Görev 2: Knowledge Engine DB).
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";

/**
 * Global entity/pattern eşleşmesi (knowledge_entities, knowledge_match_patterns).
 */
export async function resolveGlobalKnowledge(input, context, state = {}) {
  void context;

  const entityName = state?.matched_entity?.entity_name;
  if (!entityName) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "global_knowledge",
        outcome: "skipped",
        detail: "No entity to enrich",
      },
    };
  }

  return {
    matched: true,
    partial: {
      decision_source: CORE_DECISION_SOURCE.GLOBAL_KNOWLEDGE,
      confidence_score: Math.max(0.68, state.confidence_score || 0),
      matched_entity: {
        ...state.matched_entity,
        knowledge_enriched: true,
        is_stub: true,
      },
    },
    trace: {
      stage: "global_knowledge",
      outcome: "enriched",
      detail: `Stub global knowledge for ${entityName}`,
    },
  };
}

/**
 * Muhasebe öneri kuralları (knowledge_accounting_rules).
 */
export async function resolveAccountingRules(input, context, state = {}) {
  void context;

  const entityName = state?.matched_entity?.entity_name;
  if (entityName === "Google") {
    return {
      matched: true,
      partial: {
        decision_source: CORE_DECISION_SOURCE.ACCOUNTING_RULE,
        confidence_score: 0.55,
        matched_rule: {
          rule_id: "stub-google-ads-rule",
          rule_source: "global",
          description: "örnek global kural — Google Ads",
          is_stub: true,
        },
        suggested_account_code: "770",
        suggested_account_name: "Genel Yönetim Giderleri",
        suggested_counter_account_code: "320",
        suggested_cari: "GOOGLE",
        suggested_document_type: "EA",
        suggested_description: "Google Ads reklam gideri (stub — doğrulanmalı)",
        risk_flags: ["example_global_rule"],
      },
      trace: {
        stage: "accounting_rules",
        outcome: "matched",
        detail: "Stub accounting rule for Google",
      },
    };
  }

  return {
    matched: false,
    partial: {},
    trace: {
      stage: "accounting_rules",
      outcome: "no_match",
      detail: "Accounting rules resolver stub — DB not connected (Görev 2)",
    },
  };
}

/**
 * İleride bağlanacak DB metodları.
 */
export async function fetchGlobalEntities(_filters) {
  return [];
}

export async function fetchAccountingRules(_entityId, _companyId) {
  return [];
}
