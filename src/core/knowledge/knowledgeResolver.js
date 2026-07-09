/**
 * Global Knowledge enrichment + Accounting Rules (knowledge_accounting_rules global).
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";
import { mapAccountingRuleToPartial } from "../knowledge/patternMatcher.js";
import {
  pickRuleWithDiagnostics,
  RULE_DB_WHERE,
  traceWithRuleLookup,
} from "../knowledge/ruleLookupDebug.js";

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
      matched_entity_id: state.matched_entity.id,
      matched_entity_name: entity.entity_name,
    },
  };
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
  const { rule, diagnostics } = pickRuleWithDiagnostics(
    bundle.globalRules || [],
    input,
    entityId,
    {
      dbWhere: RULE_DB_WHERE.global,
      entitiesById: bundle.entitiesById,
      entityName: state.matched_entity?.entity_name,
    }
  );

  if (!rule) {
    return {
      matched: false,
      partial: {},
      trace: traceWithRuleLookup(
        {
          stage: "accounting_rules",
          outcome: "no_match",
          detail:
            diagnostics.no_match_reason ||
            diagnostics.google_rule_hint ||
            `Checked ${bundle.globalRules?.length || 0} global rules`,
        },
        diagnostics,
        false
      ),
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
    trace: traceWithRuleLookup(
      {
        stage: "accounting_rules",
        outcome: "matched",
        detail: `Global rule id=${rule.id}`,
      },
      diagnostics,
      true
    ),
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
