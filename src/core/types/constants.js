/**
 * ANNVERO CORE — sabitler ve pipeline aşamaları.
 */

export const CORE_DECISION_STATUS = {
  RECOGNIZED: "recognized",
  SUGGESTED: "suggested",
  UNKNOWN: "unknown",
  RISKY: "risky",
  MANUAL_REVIEW: "manual_review",
  REJECTED: "rejected",
};

export const CORE_DECISION_SOURCE = {
  ENTITY: "entity",
  COMPANY_MEMORY: "company_memory",
  COMPANY_RULE: "company_rule",
  GLOBAL_KNOWLEDGE: "global_knowledge",
  ACCOUNTING_RULE: "accounting_rule",
  CONFIDENCE: "confidence",
  RISK: "risk",
  AI_STUB: "ai_stub",
  MANUAL_QUEUE: "manual_queue",
  UNKNOWN: "unknown",
};

/** Karar pipeline sırası */
export const CORE_PIPELINE_STAGES = [
  { key: "entity", label: "Entity Recognition", source: CORE_DECISION_SOURCE.ENTITY },
  { key: "company_memory", label: "Company Memory", source: CORE_DECISION_SOURCE.COMPANY_MEMORY },
  { key: "company_rules", label: "Company Rules", source: CORE_DECISION_SOURCE.COMPANY_RULE },
  { key: "global_knowledge", label: "Global Knowledge", source: CORE_DECISION_SOURCE.GLOBAL_KNOWLEDGE },
  { key: "accounting_rules", label: "Accounting Rules", source: CORE_DECISION_SOURCE.ACCOUNTING_RULE },
  { key: "confidence", label: "Confidence Engine", source: CORE_DECISION_SOURCE.CONFIDENCE },
  { key: "risk", label: "Risk Engine", source: CORE_DECISION_SOURCE.RISK },
  { key: "ai_stub", label: "AI Stub", source: CORE_DECISION_SOURCE.AI_STUB },
  { key: "manual_queue", label: "Manual Queue", source: CORE_DECISION_SOURCE.MANUAL_QUEUE },
];

export const CORE_RISK_LEVEL = {
  NONE: "none",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

export const CORE_MIN_CONFIDENCE_RECOGNIZED = 0.85;
export const CORE_MIN_CONFIDENCE_SUGGESTED = 0.55;
