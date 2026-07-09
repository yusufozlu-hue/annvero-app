/**
 * Entity Recognition — Knowledge Engine DB + alias fallback.
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";
import {
  findBestEntityMatch,
  findBestPatternMatch,
  mapEntityToMatched,
} from "../knowledge/patternMatcher.js";

function getBundle(context) {
  return context.knowledgeBundle || null;
}

/**
 * @returns {Promise<{ matched: boolean, partial: object, trace: object }>}
 */
export async function resolveEntity(input, context, state = {}) {
  if (state.from_company_memory) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "entity",
        outcome: "skipped",
        detail: "Company memory match already applied",
      },
    };
  }

  const bundle = getBundle(context);

  if (!bundle || bundle.unavailable) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "entity",
        outcome: "db_unavailable",
        detail: "Knowledge DB unavailable — entity recognition skipped",
      },
    };
  }

  const companyMatch = findBestPatternMatch(
    input,
    bundle.companyPatterns || [],
    bundle.entitiesById
  );

  if (companyMatch?.entity) {
    return {
      matched: true,
      partial: {
        decision_source: CORE_DECISION_SOURCE.ENTITY,
        confidence_score: Math.max(
          Number(companyMatch.pattern.confidence) || 0,
          Number(companyMatch.entity.default_confidence) || 0.7
        ),
        matched_entity: mapEntityToMatched(companyMatch.entity, companyMatch.pattern),
        matched_pattern_id: companyMatch.pattern.id,
        scope: "company",
      },
      trace: {
        stage: "entity",
        outcome: "matched",
        detail: `Company pattern ${companyMatch.pattern.pattern_type}:${companyMatch.pattern.pattern_value}`,
      },
    };
  }

  const directEntity = findBestEntityMatch(input, bundle.entities.filter((e) => e.company_id));
  if (directEntity) {
    return {
      matched: true,
      partial: {
        decision_source: CORE_DECISION_SOURCE.ENTITY,
        confidence_score: Number(directEntity.default_confidence) || 0.72,
        matched_entity: mapEntityToMatched(directEntity),
        scope: "company",
      },
      trace: {
        stage: "entity",
        outcome: "matched",
        detail: `Company entity alias: ${directEntity.entity_name}`,
      },
    };
  }

  if (state.matched_entity?.id) {
    return {
      matched: false,
      partial: {},
      trace: { stage: "entity", outcome: "already_set", detail: "Entity set by prior stage" },
    };
  }

  return {
    matched: false,
    partial: {},
    trace: { stage: "entity", outcome: "no_match", detail: "No company entity matched" },
  };
}
