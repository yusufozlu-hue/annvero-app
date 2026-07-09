/**
 * Muhasebe Bilgi Motoru (Knowledge Engine) — sabitler ve enum değerleri.
 * Görev 1: veritabanı omurgası; servis katmanı Görev 2'de bağlanacak.
 */

export const KNOWLEDGE_TABLES = {
  ENTITIES: "knowledge_entities",
  MATCH_PATTERNS: "knowledge_match_patterns",
  ACCOUNTING_RULES: "knowledge_accounting_rules",
  COMPANY_MEMORY: "knowledge_company_memory",
  DECISION_HISTORY: "knowledge_decision_history",
  RULE_VERSIONS: "knowledge_rule_versions",
};

export const KNOWLEDGE_ENTITY_FAMILIES = {
  TECH_ADS: "tech_ads",
  TELECOM: "telecom",
  TRAVEL_OTA: "travel_ota",
  PUBLIC_INSTITUTION: "public_institution",
  BANK: "bank",
  SUPPLIER: "supplier",
  CUSTOMER: "customer",
  OTHER: "other",
};

export const KNOWLEDGE_ENTITY_TYPES = {
  CORPORATION: "corporation",
  GOVERNMENT: "government",
  PLATFORM: "platform",
  UTILITY: "utility",
  FINANCIAL: "financial",
  OTHER: "other",
};

export const KNOWLEDGE_PATTERN_TYPES = {
  KEYWORD: "keyword",
  REGEX: "regex",
  IBAN: "iban",
  TAX_NO: "tax_no",
  SWIFT: "swift",
  DESCRIPTION_CONTAINS: "description_contains",
  BANK_NAME: "bank_name",
  TRANSACTION_TYPE: "transaction_type",
};

export const KNOWLEDGE_SOURCE_TYPES = {
  BANK: "bank",
  CREDIT_CARD: "credit_card",
  POS: "pos",
  INVOICE: "invoice",
  RECEIPT: "receipt",
  PAYROLL: "payroll",
  TAX: "tax",
  SGK: "sgk",
  OTHER: "other",
};

export const KNOWLEDGE_TRANSACTION_DIRECTIONS = {
  DEBIT: "debit",
  CREDIT: "credit",
  BOTH: "both",
};

export const KNOWLEDGE_RULE_SOURCES = {
  GLOBAL: "global",
  COMPANY: "company",
  MEMORY: "memory",
  MANUAL: "manual",
  AI_SUGGESTION: "ai_suggestion",
  KNOWLEDGE_BASE: "knowledge_base",
};

export const KNOWLEDGE_DECISION_SOURCES = {
  COMPANY_MEMORY: "company_memory",
  GLOBAL_ENTITY: "global_entity",
  PATTERN: "pattern",
  ACCOUNTING_RULE: "accounting_rule",
  AI_STUB: "ai_stub",
  MANUAL: "manual",
};

export const KNOWLEDGE_DECISION_STATUSES = {
  RECOGNIZED: "recognized",
  SUGGESTED: "suggested",
  UNKNOWN: "unknown",
  RISKY: "risky",
  DUPLICATE: "duplicate",
  REJECTED: "rejected",
};

export const KNOWLEDGE_RISK_LEVELS = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

export const KNOWLEDGE_LEARNED_FROM = {
  MANUAL: "manual",
  PREVIEW_EDIT: "preview_edit",
  BANK_PARSER: "bank_parser",
  IMPORT: "import",
  MIGRATION: "migration",
};

/** Karar motoru öncelik sırası (düşük sayı = önce) */
export const KNOWLEDGE_DECISION_PIPELINE_ORDER = [
  KNOWLEDGE_DECISION_SOURCES.COMPANY_MEMORY,
  KNOWLEDGE_DECISION_SOURCES.PATTERN,
  KNOWLEDGE_DECISION_SOURCES.GLOBAL_ENTITY,
  KNOWLEDGE_DECISION_SOURCES.ACCOUNTING_RULE,
  KNOWLEDGE_DECISION_SOURCES.AI_STUB,
  KNOWLEDGE_DECISION_SOURCES.MANUAL,
];

export const KNOWLEDGE_DEFAULT_CONFIDENCE = {
  GLOBAL_ENTITY: 0.7,
  PATTERN: 0.75,
  ACCOUNTING_RULE: 0.8,
  COMPANY_MEMORY: 1.0,
  EXAMPLE_SEED_RULE: 0.45,
};
