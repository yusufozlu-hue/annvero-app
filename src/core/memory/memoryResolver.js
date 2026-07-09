/**
 * Company Memory — stub (Görev 2: knowledge_company_memory + learning_memory köprüsü).
 */

import { CORE_DECISION_SOURCE } from "../types/constants.js";

/**
 * @returns {Promise<{ matched: boolean, partial: object, trace: object }>}
 */
export async function resolveCompanyMemory(input, context, state = {}) {
  void context;
  void state;

  // Stub: DB sorgusu yok; ileride knowledge_company_memory / learning_memory
  return {
    matched: false,
    partial: {},
    trace: {
      stage: "company_memory",
      outcome: "skipped",
      detail: "Company memory resolver stub — DB not connected (Görev 2)",
    },
  };
}

/**
 * İleride bağlanacak: firma hafızası kayıt listesi.
 * @returns {Promise<object[]>}
 */
export async function fetchCompanyMemoryRecords(_companyId) {
  return [];
}
