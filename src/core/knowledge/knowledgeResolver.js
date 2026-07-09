/**
 * Global Knowledge enrichment + Accounting Rules (knowledge_accounting_rules global).
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";
import { mapAccountingRuleToPartial } from "../knowledge/patternMatcher.js";

export async function resolveGlobalKnowledge(input, context, state = {}) {
  void input;

  if (!state.matched_entity?.id) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "global_knowledge",
        outcome: "skipped",
        detail: "No matched entity",
      },
    };
  }

  const bundle = context.knowledgeBundle;
  if (!bundle || bundle.unavailable) {
    return {
      matched: false,
      partial: {},
      trace: { stage: "global_knowledge", outcome: "db_unavailable", detail: "Knowledge DB unavailable" },
    };
  }

  const entity = bundle.entitiesById?.get(state.matched_entity.id);
  if (!entity) {
    return {
      matched: false,
      partial: {},
      trace: { stage: "global_knowledge", outcome: "entity_not_found", detail: state.matched_entity.id },
    };
  }

  return {
    matched: true,
    partial: {
      decision_source: state.decision_source || CORE_DECISION_SOURCE.GLOBAL_KNOWLEDGE,
      matched_entity: {
        ...state.matched_entity,
        entity_name: entity.entity_name,
        entity_family: entity.entity_family,
        entity_type: entity.entity_type,
        risk_level: entity.risk_level,
        knowledge_enriched: true,
      },
      confidence_score: Math.max(
        Number(state.confidence_score) || 0,
        Number(entity.default_confidence) || 0.7
      ),
    },
    trace: {
      stage: "global_knowledge",
      outcome: "enriched",
      detail: `Enriched entity ${entity.entity_name}`,
    },
  };
}

function pickGlobalRule(rules = [], input, entityId) {
  const filtered = rules.filter((rule) => {
    if (entityId && rule.entity_id && rule.entity_id !== entityId) return false;
    if (rule.source_type && input.source_type && rule.source_type !== input.source_type) return false;
    return true;
  });

  if (!filtered.length) return null;

  filtered.sort(
    (a, b) =>
      Number(a.priority || 100) - Number(b.priority || 100) ||
      Number(b.confidence || 0) - Number(a.confidence || 0)
  );

  return filtered[0];
}

export async function resolveAccountingRules(input, context, state = {}) {
  if (state.from_company_memory && state.suggested_account_code) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "accounting_rules",
        outcome: "skipped",
        detail: "Company memory already provided suggestions",
      },
    };
  }

  if (state.suggested_account_code && state.decision_source === CORE_DECISION_SOURCE.COMPANY_RULE) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "accounting_rules",
        outcome: "skipped",
        detail: "Company rule already applied",
      },
    };
  }

  const bundle = context.knowledgeBundle;
  if (!bundle || bundle.unavailable) {
    return {
      matched: false,
      partial: {},
      trace: { stage: "accounting_rules", outcome: "db_unavailable", detail: "Knowledge DB unavailable" },
    };
  }

  const entityId = state.matched_entity?.id || null;
  const rule = pickGlobalRule(bundle.globalRules || [], input, entityId);

  if (!rule) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "accounting_rules",
        outcome: "no_match",
        detail: `Checked ${bundle.globalRules?.length || 0} global rules`,
      },
    };
  }

  const partial = mapAccountingRuleToPartial(rule);

  return {
    matched: true,
    partial: {
      decision_source: CORE_DECISION_SOURCE.ACCOUNTING_RULE,
      ...partial,
      confidence_score: Math.max(Number(state.confidence_score) || 0, partial.confidence_score || 0),
    },
    trace: {
      stage: "accounting_rules",
      outcome: "matched",
      detail: `Global rule id=${rule.id}`,
    },
  };
}

export async function fetchGlobalEntities(context = {}) {
  const bundle = context.knowledgeBundle;
  return bundle?.entities?.filter((e) => e.is_global) || [];
}

export async function fetchAccountingRules(entityId, companyId, context = {}) {
  const bundle = context.knowledgeBundle;
  if (!bundle) return [];
  return [...(bundle.companyRules || []), ...(bundle.globalRules || [])].filter(
    (rule) => !entityId || rule.entity_id === entityId
  );
}
