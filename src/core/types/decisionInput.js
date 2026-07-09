/**
 * CORE karar girişi — normalizasyon ve doğrulama.
 */

function empty(value) {
  return value == null ? "" : String(value).trim();
}

export function normalizeCoreInput(raw = {}) {
  return {
    source_type: empty(raw.source_type || raw.sourceType),
    company_id: empty(raw.company_id || raw.companyId),
    raw_description: empty(raw.raw_description || raw.rawDescription || raw.description),
    amount: raw.amount == null || raw.amount === "" ? null : Number(raw.amount),
    currency: empty(raw.currency) || "TRY",
    transaction_date: empty(raw.transaction_date || raw.transactionDate),
    bank_name: empty(raw.bank_name || raw.bankName),
    counterparty_name: empty(raw.counterparty_name || raw.counterpartyName),
    iban: empty(raw.iban),
    tax_no: empty(raw.tax_no || raw.taxNo),
    document_type: empty(raw.document_type || raw.documentType),
    raw_payload: raw.raw_payload || raw.rawPayload || {},
  };
}

/**
 * @returns {{ ok: boolean, value?: object, error?: string }}
 */
export function validateCoreInput(raw = {}) {
  const value = normalizeCoreInput(raw);

  if (!value.company_id) {
    return { ok: false, error: "company_id zorunludur." };
  }

  if (!value.source_type) {
    return { ok: false, error: "source_type zorunludur." };
  }

  if (!value.raw_description && !value.counterparty_name && !value.iban && !value.tax_no) {
    return {
      ok: false,
      error: "En az bir tanımlayıcı alan gerekli (raw_description, counterparty_name, iban veya tax_no).",
    };
  }

  if (value.amount != null && !Number.isFinite(value.amount)) {
    return { ok: false, error: "amount geçerli bir sayı olmalıdır." };
  }

  return { ok: true, value };
}
