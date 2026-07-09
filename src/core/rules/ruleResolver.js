/**
 * Company Rules — knowledge_accounting_rules (firma kapsamlı).
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";
import { mapAccountingRuleToPartial } from "../knowledge/patternMatcher.js";

function pickBestRule(rules = [], input, entityId) {
  const filtered = rules.filter((rule) => {
    if (entityId && rule.entity_id && rule.entity_id !== entityId) return false;
    if (rule.source_type && input.source_type && rule.source_type !== input.source_type) {
      return false;
    }
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
  const rule = pickBestRule(bundle.companyRules || [], input, entityId);

  if (!rule) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "company_rules",
        outcome: "no_match",
        detail: `Checked ${bundle.companyRules?.length || 0} company rules`,
      },
    };
  }

  return {
    matched: true,
    partial: {
      decision_source: CORE_DECISION_SOURCE.COMPANY_RULE,
      ...mapAccountingRuleToPartial(rule, "company_rule"),
    },
    trace: {
      stage: "company_rules",
      outcome: "matched",
      detail: `Rule id=${rule.id}`,
    },
  };
}

export async function fetchCompanyRules(companyId, sourceType, context = {}) {
  const bundle = context.knowledgeBundle;
  if (!bundle) return [];
  return (bundle.companyRules || []).filter(
    (rule) => !sourceType || !rule.source_type || rule.source_type === sourceType
  );
}
