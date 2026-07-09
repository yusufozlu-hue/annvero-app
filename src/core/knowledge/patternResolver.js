/**
 * Pattern matching — company önce, global sonra (company memory sonrası).
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";
import {
  findBestPatternMatch,
  mapEntityToMatched,
} from "../knowledge/patternMatcher.js";

/**
 * @returns {Promise<{ matched: boolean, partial: object, trace: object }>}
 */
export async function resolvePatterns(input, context, state = {}) {
  if (state.from_company_memory) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "pattern_matching",
        outcome: "skipped",
        detail: "Company memory already matched",
      },
    };
  }

  const bundle = context.knowledgeBundle;
  if (!bundle || bundle.unavailable) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "pattern_matching",
        outcome: "db_unavailable",
        detail: "Knowledge DB unavailable",
      },
    };
  }

  if (state.matched_entity?.id && state.matched_pattern_id) {
    return {
      matched: false,
      partial: {},
      trace: { stage: "pattern_matching", outcome: "already_set", detail: "Pattern already matched" },
    };
  }

  const globalMatch = findBestPatternMatch(
    input,
    bundle.globalPatterns || [],
    bundle.entitiesById
  );

  if (!globalMatch?.entity) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "pattern_matching",
        outcome: "no_match",
        detail: `Checked ${bundle.globalPatterns?.length || 0} global patterns`,
      },
    };
  }

  return {
    matched: true,
    partial: {
      decision_source: CORE_DECISION_SOURCE.GLOBAL_KNOWLEDGE,
      confidence_score: Math.max(
        Number(globalMatch.pattern.confidence) || 0,
        Number(globalMatch.entity.default_confidence) || 0.7
      ),
      matched_entity: mapEntityToMatched(globalMatch.entity, globalMatch.pattern),
      matched_pattern_id: globalMatch.pattern.id,
      scope: "global",
    },
    trace: {
      stage: "pattern_matching",
      outcome: "matched",
      detail: `Global pattern ${globalMatch.pattern.pattern_type}:${globalMatch.pattern.pattern_value}`,
    },
  };
}
