/**
 * Knowledge Engine tablo şeması özeti — API/servis katmanı için (Görev 2).
 */

import { KNOWLEDGE_TABLES } from "./constants";

export { KNOWLEDGE_TABLES };

/** audit_events entity_type değerleri (Görev 2+ yazım) */
export const KNOWLEDGE_AUDIT_ENTITY_TYPES = {
  ENTITY: "knowledge_entity",
  PATTERN: "knowledge_pattern",
  RULE: "knowledge_rule",
  MEMORY: "knowledge_memory",
  DECISION: "knowledge_decision",
};

/** Firma izolasyonu olan tablolar */
export const KNOWLEDGE_COMPANY_SCOPED_TABLES = [
  KNOWLEDGE_TABLES.ENTITIES,
  KNOWLEDGE_TABLES.MATCH_PATTERNS,
  KNOWLEDGE_TABLES.ACCOUNTING_RULES,
  KNOWLEDGE_TABLES.COMPANY_MEMORY,
  KNOWLEDGE_TABLES.DECISION_HISTORY,
];

/** Soft delete destekleyen tablolar */
export const KNOWLEDGE_SOFT_DELETE_TABLES = [
  KNOWLEDGE_TABLES.ENTITIES,
  KNOWLEDGE_TABLES.MATCH_PATTERNS,
  KNOWLEDGE_TABLES.ACCOUNTING_RULES,
  KNOWLEDGE_TABLES.COMPANY_MEMORY,
];
