/**
 * Banka & Kart Operasyon Merkezi — ortak finansal hareket modeli.
 * Mevcut bank parser satırlarını bozmaz; yan çıktı / kalıcı depolama şemasıdır.
 */

export const FINANCIAL_SOURCE_TYPES = {
  BANK: "bank",
  CREDIT_CARD: "credit_card",
  POS: "pos",
  CASH: "cash",
  OTHER: "other",
};

export const RECOGNITION_STATUS = {
  RECOGNIZED: "recognized",
  SUGGESTED: "suggested",
  UNKNOWN: "unknown",
  RISKY: "risky",
  DUPLICATE: "duplicate",
  READY_FOR_VOUCHER: "ready_for_voucher",
};

/** Türkçe etiketler (dashboard / UI) */
export const RECOGNITION_STATUS_LABELS = {
  [RECOGNITION_STATUS.RECOGNIZED]: "tanındı",
  [RECOGNITION_STATUS.SUGGESTED]: "önerildi",
  [RECOGNITION_STATUS.UNKNOWN]: "tanınmadı",
  [RECOGNITION_STATUS.RISKY]: "riskli",
  [RECOGNITION_STATUS.DUPLICATE]: "mükerrer şüpheli",
  [RECOGNITION_STATUS.READY_FOR_VOUCHER]: "fişe hazır",
};

export const TRANSACTION_TYPES = {
  EFT: "EFT",
  HAVALE: "HAVALE",
  FAST: "FAST",
  POS: "POS",
  Nakit: "NAKIT",
  KOMISYON: "KOMISYON",
  BSMV: "BSMV",
  FAIZ: "FAIZ",
  KREDI_KARTI: "KREDI_KARTI",
  DIGER: "DIGER",
};

function nowIso() {
  return new Date().toISOString();
}

function emptyString(value) {
  return value == null ? "" : String(value).trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Ortak normalizedFinancialTransaction kaydı oluşturur.
 * Eksik alanlar güvenli varsayılanlarla doldurulur.
 */
export function createNormalizedFinancialTransaction(partial = {}) {
  const createdAt = emptyString(partial.created_at) || nowIso();
  return {
    id: emptyString(partial.id) || `nft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    company_id: emptyString(partial.company_id),
    source_type: emptyString(partial.source_type) || FINANCIAL_SOURCE_TYPES.BANK,
    source_name: emptyString(partial.source_name),
    bank_name: emptyString(partial.bank_name),
    account_no: emptyString(partial.account_no),
    card_no_masked: emptyString(partial.card_no_masked),
    currency: emptyString(partial.currency) || "TRY",
    transaction_date: emptyString(partial.transaction_date),
    description_raw: emptyString(partial.description_raw),
    description_normalized: emptyString(partial.description_normalized),
    debit_amount: toNumber(partial.debit_amount),
    credit_amount: toNumber(partial.credit_amount),
    balance: partial.balance === "" || partial.balance == null ? null : toNumber(partial.balance),
    transaction_type: emptyString(partial.transaction_type) || TRANSACTION_TYPES.DIGER,
    counterparty_name: emptyString(partial.counterparty_name),
    iban: emptyString(partial.iban),
    document_no: emptyString(partial.document_no),
    source_file_name: emptyString(partial.source_file_name),
    source_file_type: emptyString(partial.source_file_type) || "xlsx",
    parser_name: emptyString(partial.parser_name),
    recognition_status:
      emptyString(partial.recognition_status) || RECOGNITION_STATUS.UNKNOWN,
    suggested_account_code: emptyString(partial.suggested_account_code) || null,
    suggested_account_name: emptyString(partial.suggested_account_name) || null,
    suggested_counter_account_code:
      emptyString(partial.suggested_counter_account_code) ||
      emptyString(partial.suggested_counter_account) ||
      null,
    suggested_counter_account:
      emptyString(partial.suggested_counter_account) ||
      emptyString(partial.suggested_counter_account_code) ||
      null,
    suggested_cari: emptyString(partial.suggested_cari) || null,
    suggested_document_type: emptyString(partial.suggested_document_type) || "DK",
    suggested_vat_rate:
      partial.suggested_vat_rate == null || partial.suggested_vat_rate === ""
        ? null
        : toNumber(partial.suggested_vat_rate, null),
    suggested_vat_amount:
      partial.suggested_vat_amount == null || partial.suggested_vat_amount === ""
        ? null
        : toNumber(partial.suggested_vat_amount, null),
    suggested_description: emptyString(partial.suggested_description),
    suggested_voucher_type: emptyString(partial.suggested_voucher_type) || "DK",
    suggested_rule: emptyString(partial.suggested_rule) || null,
    confidence_score: toNumber(partial.confidence_score, 0),
    risk_flags: toArray(partial.risk_flags),
    risk_level: emptyString(partial.risk_level) || "none",
    decision_source: emptyString(partial.decision_source) || "",
    pipeline_stage: emptyString(partial.pipeline_stage) || "",
    message: emptyString(partial.message),
    accounting_decision: partial.accounting_decision || null,
    created_at: createdAt,
    updated_at: emptyString(partial.updated_at) || createdAt,
    // İç bağlantılar (kalıcı schema dışı, pipeline için)
    _legacy_row: partial._legacy_row || null,
    _movement_id: emptyString(partial._movement_id),
    _match_source: emptyString(partial._match_source),
  };
}

export function isReadyForVoucher(tx = {}) {
  return (
    tx.recognition_status === RECOGNITION_STATUS.READY_FOR_VOUCHER ||
    (tx.recognition_status === RECOGNITION_STATUS.RECOGNIZED &&
      Boolean(tx.suggested_account_code) &&
      Boolean(tx.suggested_counter_account_code) &&
      !(tx.risk_flags || []).includes("duplicate"))
  );
}

export function summarizeRecognitionStatuses(transactions = []) {
  const counts = {
    total: transactions.length,
    recognized: 0,
    suggested: 0,
    unknown: 0,
    risky: 0,
    duplicate: 0,
    ready_for_voucher: 0,
  };

  for (const tx of transactions) {
    const status = tx?.recognition_status;
    if (status === RECOGNITION_STATUS.RECOGNIZED) counts.recognized += 1;
    else if (status === RECOGNITION_STATUS.SUGGESTED) counts.suggested += 1;
    else if (status === RECOGNITION_STATUS.UNKNOWN) counts.unknown += 1;
    else if (status === RECOGNITION_STATUS.RISKY) counts.risky += 1;
    else if (status === RECOGNITION_STATUS.DUPLICATE) counts.duplicate += 1;
    else if (status === RECOGNITION_STATUS.READY_FOR_VOUCHER) counts.ready_for_voucher += 1;

    // ready_for_voucher metrik: status veya fiş kriteri (çift sayım yok)
    if (
      status !== RECOGNITION_STATUS.READY_FOR_VOUCHER &&
      isReadyForVoucher(tx)
    ) {
      counts.ready_for_voucher += 1;
    }
  }

  return counts;
}

/** Supabase / API için düz kayıt (iç alanlar çıkarılır) */
export function toPersistedFinancialTransaction(tx = {}) {
  const full = createNormalizedFinancialTransaction(tx);
  const {
    _legacy_row: _l,
    _movement_id: _m,
    _match_source: _s,
    ...persisted
  } = full;
  // accounting_decision JSON olarak kalabilir (ops UI için)
  return persisted;
}
