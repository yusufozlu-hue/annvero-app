/**
 * Muhasebe Karar Motoru — karar kaydı modeli.
 * Parser satırlarını bozmaz; NFT üzerine karar alanları yazar.
 */

export const DECISION_SOURCE = {
  MEMORY: "Memory",
  RULE: "Rule",
  AI: "AI",
  MANUAL: "Manual",
};

export const DECISION_SOURCE_LABELS = {
  [DECISION_SOURCE.MEMORY]: "Hafıza",
  [DECISION_SOURCE.RULE]: "Kural",
  [DECISION_SOURCE.AI]: "AI",
  [DECISION_SOURCE.MANUAL]: "Manuel",
};

export const RISK_LEVEL = {
  NONE: "none",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

export const RISK_LEVEL_LABELS = {
  [RISK_LEVEL.NONE]: "yok",
  [RISK_LEVEL.LOW]: "düşük",
  [RISK_LEVEL.MEDIUM]: "orta",
  [RISK_LEVEL.HIGH]: "yüksek",
  [RISK_LEVEL.CRITICAL]: "kritik",
};

/** Pipeline sırası — AI şimdilik stub */
export const ACCOUNTING_DECISION_PIPELINE = [
  DECISION_SOURCE.MEMORY,
  DECISION_SOURCE.RULE,
  DECISION_SOURCE.AI,
  DECISION_SOURCE.MANUAL,
];

function empty(value) {
  return value == null ? "" : String(value).trim();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Tek banka hareketi için muhasebe kararı.
 */
export function createAccountingDecision(partial = {}) {
  return {
    recognition_status: empty(partial.recognition_status) || "unknown",
    confidence_score: num(partial.confidence_score, 0),
    suggested_account_code: empty(partial.suggested_account_code) || null,
    suggested_account_name: empty(partial.suggested_account_name) || null,
    suggested_counter_account: empty(partial.suggested_counter_account) || null,
    suggested_cari: empty(partial.suggested_cari) || null,
    suggested_document_type: empty(partial.suggested_document_type) || "DK",
    suggested_vat_rate: partial.suggested_vat_rate == null || partial.suggested_vat_rate === ""
      ? null
      : num(partial.suggested_vat_rate, null),
    suggested_vat_amount: partial.suggested_vat_amount == null || partial.suggested_vat_amount === ""
      ? null
      : num(partial.suggested_vat_amount, null),
    suggested_description: empty(partial.suggested_description) || "",
    suggested_voucher_type: empty(partial.suggested_voucher_type) || "DK",
    suggested_rule: empty(partial.suggested_rule) || null,
    risk_level: empty(partial.risk_level) || RISK_LEVEL.NONE,
    decision_source: empty(partial.decision_source) || DECISION_SOURCE.MANUAL,
    pipeline_stage: empty(partial.pipeline_stage) || DECISION_SOURCE.MANUAL,
    message: empty(partial.message) || "",
    ai_ready: Boolean(partial.ai_ready),
    ai_invoked: Boolean(partial.ai_invoked),
  };
}

export function summarizeDecisionSources(transactions = []) {
  const counts = {
    total: transactions.length,
    recognized: 0,
    from_memory: 0,
    from_rule: 0,
    from_ai: 0,
    unknown: 0,
    risky: 0,
    duplicate: 0,
  };

  for (const tx of transactions) {
    const source = tx?.decision_source || tx?.accounting_decision?.decision_source || "";
    const status = tx?.recognition_status || "";

    if (status === "recognized" || status === "ready_for_voucher" || status === "suggested") {
      counts.recognized += 1;
    }
    if (status === "unknown") counts.unknown += 1;
    if (status === "risky") counts.risky += 1;
    if (status === "duplicate") counts.duplicate += 1;

    if (source === DECISION_SOURCE.MEMORY) counts.from_memory += 1;
    else if (source === DECISION_SOURCE.RULE) counts.from_rule += 1;
    else if (source === DECISION_SOURCE.AI) counts.from_ai += 1;
  }

  return counts;
}
