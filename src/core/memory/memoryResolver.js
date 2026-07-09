/**
 * Company Memory — knowledge_company_memory (öncelikli).
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";
import { mapCompanyMemoryToPartial, matchCompanyMemoryRecord } from "../knowledge/patternMatcher.js";

/**
 * @returns {Promise<{ matched: boolean, partial: object, trace: object }>}
 */
export async function resolveCompanyMemory(input, context) {
  const bundle = context.knowledgeBundle;

  if (!bundle || bundle.unavailable) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "company_memory",
        outcome: "db_unavailable",
        detail: "Knowledge DB unavailable — memory lookup skipped",
      },
    };
  }

  const memory = matchCompanyMemoryRecord(input, bundle.companyMemory || []);

  if (!memory) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "company_memory",
        outcome: "no_match",
        detail: `Checked ${bundle.companyMemory?.length || 0} memory rows`,
      },
    };
  }

  const entity =
    memory.entity_id && bundle.entitiesById?.get(memory.entity_id)
      ? {
          id: memory.entity_id,
          entity_name: bundle.entitiesById.get(memory.entity_id).entity_name,
        }
      : memory.entity_id
        ? { id: memory.entity_id }
        : null;

  return {
    matched: true,
    partial: {
      decision_source: CORE_DECISION_SOURCE.COMPANY_MEMORY,
      ...mapCompanyMemoryToPartial(memory),
      matched_entity: entity || mapCompanyMemoryToPartial(memory).matched_entity,
    },
    trace: {
      stage: "company_memory",
      outcome: "matched",
      detail: `Memory id=${memory.id} confidence=${memory.confidence}`,
    },
  };
}

export async function fetchCompanyMemoryRecords(companyId, context = {}) {
  const bundle = context.knowledgeBundle;
  if (bundle?.companyMemory) return bundle.companyMemory;
  return [];
}
