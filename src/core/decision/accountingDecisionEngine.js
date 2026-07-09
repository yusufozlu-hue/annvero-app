/**
 * Accounting Decision Engine — CORE üzerinde muhasebe karar katmanı.
 *
 * Öncelik: company_memory → company_rule → global_accounting_rule → (AI/manual sonraki aşamalar)
 */

import { CORE_DECISION_SOURCE, CORE_DECISION_STATUS } from "../types/constants.js";
import { mapAccountingRuleToPartial } from "../knowledge/patternMatcher.js";
import {
  pickRuleWithDiagnostics,
  resolveRuleLookupSourceTypes,
  RULE_DB_WHERE,
  traceWithRuleLookup,
} from "../knowledge/ruleLookupDebug.js";

function buildRuleMatchPartial(rule, decisionSource, entityName = "") {
  const partial = mapAccountingRuleToPartial(rule);
  const confidence = Math.max(
    Number(partial.confidence_score) || 0,
    Number(rule.confidence) || 0,
    0.75
  );

  const hasAccount = Boolean(partial.suggested_account_code);

  return {
    decision_source: decisionSource,
    ...partial,
    suggested_cari: partial.suggested_cari || entityName || null,
    confidence_score: confidence,
    risk_level: rule.risk_level || partial.risk_level || "low",
    needs_manual_review: !hasAccount,
    status: hasAccount ? CORE_DECISION_STATUS.SUGGESTED : CORE_DECISION_STATUS.UNKNOWN,
  };
}

/**
 * @returns {Promise<{ matched: boolean, partial: object, trace: object }>}
 */
export async function resolveAccountingDecisionLayer(input, context, state = {}) {
  const bundle = context.knowledgeBundle;

  if (!bundle || bundle.unavailable) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "accounting_decision",
        outcome: "db_unavailable",
        detail: "Knowledge DB unavailable",
      },
    };
  }

  if (state.from_company_memory && state.suggested_account_code) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "accounting_decision",
        outcome: "skipped",
        detail: "Priority 1: company_memory already applied",
        priority_winner: "company_memory",
        matched_entity_id: state.matched_entity?.id || null,
      },
    };
  }

  if (state.suggested_account_code && state.decision_source === CORE_DECISION_SOURCE.COMPANY_RULE) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "accounting_decision",
        outcome: "skipped",
        detail: "Company rule already applied",
        priority_winner: "company_rule",
      },
    };
  }

  const entityId = state.matched_entity?.id || null;
  const sourceTypes = resolveRuleLookupSourceTypes(input, state);
  const ruleInput = { ...input, _rule_source_types: sourceTypes };

  if (!state.suggested_account_code) {
    const companyLookup = pickRuleWithDiagnostics(
      bundle.companyRules || [],
      ruleInput,
      entityId,
      {
        dbWhere: RULE_DB_WHERE.company(input.company_id),
        sourceTypes,
        entitiesById: bundle.entitiesById,
        entityName: state.matched_entity?.entity_name,
      }
    );

    if (companyLookup.rule) {
      return {
        matched: true,
        partial: buildRuleMatchPartial(
          companyLookup.rule,
          CORE_DECISION_SOURCE.COMPANY_RULE,
          state.matched_entity?.entity_name
        ),
        trace: traceWithRuleLookup(
          {
            stage: "accounting_decision",
            outcome: "matched",
            detail: `Priority 2: company_rule id=${companyLookup.rule.id}`,
            priority_winner: "company_rule",
            resolved_source_types: sourceTypes,
          },
          companyLookup.diagnostics,
          true
        ),
      };
    }
  }

  if (!state.suggested_account_code && entityId) {
    const globalLookup = pickRuleWithDiagnostics(
      bundle.globalRules || [],
      ruleInput,
      entityId,
      {
        dbWhere: RULE_DB_WHERE.global,
        sourceTypes,
        entitiesById: bundle.entitiesById,
        entityName: state.matched_entity?.entity_name,
      }
    );

    if (globalLookup.rule) {
      return {
        matched: true,
        partial: buildRuleMatchPartial(
          globalLookup.rule,
          CORE_DECISION_SOURCE.ACCOUNTING_RULE,
          state.matched_entity?.entity_name
        ),
        trace: traceWithRuleLookup(
          {
            stage: "accounting_decision",
            outcome: "matched",
            detail: `Priority 3: global_accounting_rule id=${globalLookup.rule.id}`,
            priority_winner: "global_accounting_rule",
            resolved_source_types: sourceTypes,
          },
          globalLookup.diagnostics,
          true
        ),
      };
    }

    return {
      matched: false,
      partial: {},
      trace: traceWithRuleLookup(
        {
          stage: "accounting_decision",
          outcome: "no_rule",
          detail:
            globalLookup.diagnostics.no_match_reason ||
            globalLookup.diagnostics.google_rule_hint ||
            "No matching accounting rule for entity",
          priority_winner: null,
          matched_entity_id: entityId,
          resolved_source_types: sourceTypes,
        },
        globalLookup.diagnostics,
        false
      ),
    };
  }

  if (!entityId) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "accounting_decision",
        outcome: "no_entity",
        detail: "Entity required before global accounting rules",
        priority_winner: null,
        resolved_source_types: sourceTypes,
      },
    };
  }

  return {
    matched: false,
    partial: {},
    trace: {
      stage: "accounting_decision",
      outcome: "no_match",
      detail: "No accounting rule applied",
      priority_winner: null,
    },
  };
}
