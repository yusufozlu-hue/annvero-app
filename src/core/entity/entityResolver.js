/**
 * Entity Recognition — stub (Görev 2: Knowledge Engine DB bağlantısı).
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";

/**
 * @param {object} input
 * @param {object} context
 * @param {object} [state]
 * @returns {Promise<{ matched: boolean, partial: object, trace: object }>}
 */
export async function resolveEntity(input, context, state = {}) {
  void context;
  void state;

  const haystack = [
    input.raw_description,
    input.counterparty_name,
    input.bank_name,
    input.tax_no,
  ]
    .join(" ")
    .toLocaleUpperCase("tr");

  // Stub: basit keyword eşleşmesi (DB yok)
  const stubEntities = [
    { name: "Google", keywords: ["GOOGLE", "GOOGLE ADS"], family: "tech_ads" },
    { name: "SGK", keywords: ["SGK", "SOSYAL GUVENLIK", "SOSYAL GÜVENLİK"], family: "public_institution" },
    { name: "GİB", keywords: ["GIB", "GİB", "GELIR IDARESI"], family: "public_institution" },
  ];

  for (const entity of stubEntities) {
    if (entity.keywords.some((kw) => haystack.includes(kw))) {
      return {
        matched: true,
        partial: {
          decision_source: CORE_DECISION_SOURCE.ENTITY,
          confidence_score: 0.65,
          matched_entity: {
            entity_name: entity.name,
            entity_family: entity.family,
            match_type: "stub_keyword",
            is_stub: true,
          },
        },
        trace: {
          stage: "entity",
          outcome: "matched",
          detail: `Stub entity: ${entity.name}`,
        },
      };
    }
  }

  return {
    matched: false,
    partial: {},
    trace: { stage: "entity", outcome: "no_match", detail: "No entity matched (stub)" },
  };
}
