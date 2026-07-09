/**
 * Company Rules — knowledge_accounting_rules (firma kapsamlı).
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";
import { mapAccountingRuleToPartial } from "../knowledge/patternMatcher.js";
import { pickRuleWithDiagnostics, RULE_DB_WHERE, traceWithRuleLookup } from "../knowledge/ruleLookupDebug.js";

/**
 * @returns {Promise<{ matched: boolean, partial: object, trace: object }>}
 */
export async function resolveCompanyRules(input, context, state = {}) {
  if (state.from_company_memory && state.suggested_account_code) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "company_rules",
        outcome: "skipped",
        detail: "Company memory already provided account suggestion",
      },
    };
  }

  const bundle = context.knowledgeBundle;
  if (!bundle || bundle.unavailable) {
    return {
      matched: false,
      partial: {},
      trace: { stage: "company_rules", outcome: "db_unavailable", detail: "Knowledge DB unavailable" },
    };
  }

  const entityId = state.matched_entity?.id || null;
  const { rule, diagnostics } = pickRuleWithDiagnostics(
    bundle.companyRules || [],
    input,
    entityId,
    {
      dbWhere: RULE_DB_WHERE.company(input.company_id),
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
          stage: "company_rules",
          outcome: "no_match",
          detail: diagnostics.no_match_reason || `Checked ${bundle.companyRules?.length || 0} company rules`,
        },
        diagnostics,
        false
      ),
    };
  }

  return {
    matched: true,
    partial: {
      decision_source: CORE_DECISION_SOURCE.COMPANY_RULE,
      ...mapAccountingRuleToPartial(rule, "company_rule"),
    },
    trace: traceWithRuleLookup(
      {
        stage: "company_rules",
        outcome: "matched",
        detail: `Rule id=${rule.id}`,
      },
      diagnostics,
      true
    ),
  };
}

export async function fetchCompanyRules(companyId, sourceType, context = {}) {
  const bundle = context.knowledgeBundle;
  if (!bundle) return [];
  return (bundle.companyRules || []).filter(
    (rule) => !sourceType || !rule.source_type || rule.source_type === sourceType
  );
}
