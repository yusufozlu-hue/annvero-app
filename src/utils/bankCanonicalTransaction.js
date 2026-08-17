/**
 * Banka ekstresi kanonik hareket modeli.
 * Excel ve PDF aynı normalize şemaya düşer; UI/Luca ham kolonlara bağlanmaz.
 */

export const BANK_PARSER_VERSION = "bank-canon-v1";

/** Browser + Node uyumlu deterministik kısa hash (kripto değil — idempotency anahtarı). */
function fingerprint(text = "") {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let h2 = 0x811c9dc5;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    h2 ^= s.charCodeAt(i);
    h2 = Math.imul(h2, 16777619);
  }
  return (
    (h >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}

export const BANK_STATEMENT_SOURCE = Object.freeze({
  XLSX: "xlsx",
  XLS: "xls",
  PDF: "pdf",
  PDF_OCR: "pdf_ocr",
});

export const BANK_PARSE_STATUS = Object.freeze({
  OK: "ok",
  WARNING: "warning",
  REVIEW_REQUIRED: "review_required",
  OCR_REQUIRED: "OCR_REQUIRED",
  ERROR: "error",
});

function empty(value) {
  return value == null ? "" : String(value).trim();
}

function toNumber(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function directionFromAmounts({ debit = 0, credit = 0, amount = 0, direction = "" } = {}) {
  const d = empty(direction).toUpperCase();
  // Explicit UNKNOWN must never be inferred as GIRIS/CIKIS from amount sign.
  if (d === "UNKNOWN" || d === "BILINMIYOR" || d === "UNRESOLVED") return "UNKNOWN";
  if (d === "CIKIS" || d === "OUT" || d === "DEBIT") return "CIKIS";
  if (d === "GIRIS" || d === "IN" || d === "CREDIT") return "GIRIS";
  if (toNumber(debit) > 0 && toNumber(credit) <= 0) return "GIRIS";
  if (toNumber(credit) > 0 && toNumber(debit) <= 0) return "CIKIS";
  if (toNumber(amount) < 0) return "CIKIS";
  if (toNumber(amount) > 0) return "GIRIS";
  return "GIRIS";
}

/**
 * Idempotency anahtarı — PDF/Excel çapraz dedup için dosya hash'ten bağımsız.
 */
export function buildMovementIdentityKey({
  companyId = "",
  bank = "",
  accountIdentity = "",
  transactionDate = "",
  amount = 0,
  direction = "",
  description = "",
  documentNo = "",
} = {}) {
  const payload = [
    empty(companyId).toLowerCase(),
    empty(bank).toUpperCase(),
    empty(accountIdentity).toLowerCase(),
    empty(transactionDate),
    Number(amount).toFixed(2),
    empty(direction).toUpperCase(),
    empty(description).toLocaleLowerCase("tr-TR").replace(/\s+/g, " "),
    empty(documentNo).toLowerCase(),
  ].join("|");
  return fingerprint(payload);
}

export function buildSourceFileHash(bytesOrText = "") {
  let s = "";
  if (typeof bytesOrText === "string") s = bytesOrText;
  else if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(bytesOrText)) {
    s = bytesOrText.toString("binary");
  } else if (bytesOrText instanceof Uint8Array) {
    s = Array.from(bytesOrText)
      .map((b) => String.fromCharCode(b))
      .join("");
  } else {
    s = String(bytesOrText || "");
  }
  return fingerprint(s);
}

/**
 * @returns {object} kanonik hareket
 */
export function createCanonicalBankTransaction(partial = {}) {
  const debit = toNumber(partial.debit_amount ?? partial.borc);
  const credit = toNumber(partial.credit_amount ?? partial.alacak);
  const signed =
    partial.amount != null && partial.amount !== ""
      ? toNumber(partial.amount)
      : debit > 0
        ? debit
        : credit > 0
          ? -credit
          : 0;
  const direction = directionFromAmounts({
    debit,
    credit,
    amount: signed,
    direction: partial.direction || partial.yon,
  });
  const description = empty(partial.description || partial.aciklama || partial.description_raw);
  const transactionDate = empty(
    partial.transactionDate || partial.transaction_date || partial.tarih
  );
  const companyId = empty(partial.companyId || partial.company_id);
  const bank = empty(partial.bank || partial.banka || partial.bank_name).toUpperCase();
  const accountIdentity = empty(
    partial.accountIdentity || partial.account_no || partial.hesapNo || partial.iban
  );
  const documentNo = empty(partial.documentNo || partial.dekontNo || partial.document_no);
  const amountAbs = Math.abs(signed || debit || credit);
  const signedForId =
    direction === "CIKIS" ? -amountAbs : direction === "UNKNOWN" ? amountAbs : amountAbs;
  const transactionId =
    empty(partial.transactionId || partial.id) ||
    buildMovementIdentityKey({
      companyId,
      bank,
      accountIdentity,
      transactionDate,
      amount: signedForId,
      direction,
      description,
      documentNo,
    });

  const reviewReason = empty(partial.reviewReason || partial.review_reason);

  return Object.freeze({
    transactionId,
    companyId,
    bank,
    accountIdentity,
    transactionDate,
    valueDate: empty(partial.valueDate || partial.value_date) || transactionDate,
    description,
    // UNKNOWN: unsigned absolute — direction not invented from sign
    amount: direction === "CIKIS" ? -amountAbs : amountAbs,
    direction,
    balance:
      partial.balance === "" || partial.balance == null
        ? partial.bakiye === "" || partial.bakiye == null
          ? null
          : toNumber(partial.bakiye)
        : toNumber(partial.balance),
    currency: empty(partial.currency || "TRY").toUpperCase() || "TRY",
    sourceRow: Number(partial.sourceRow || partial.excelRowNumber || partial.source_row) || 0,
    sourceSheet: empty(partial.sourceSheet || partial.sheetName || partial.source_sheet),
    sourcePage: Number(partial.sourcePage || partial.page || 0) || 0,
    sourceFileHash: empty(partial.sourceFileHash || partial.source_file_hash),
    parserVersion: empty(partial.parserVersion) || BANK_PARSER_VERSION,
    parseWarnings: Array.isArray(partial.parseWarnings)
      ? [...partial.parseWarnings]
      : [],
    documentNo,
    sourceType: empty(partial.sourceType || partial.source_file_type) || BANK_STATEMENT_SOURCE.XLSX,
    status: empty(partial.status) || BANK_PARSE_STATUS.OK,
    ocrConfidence:
      partial.ocrConfidence == null || partial.ocrConfidence === ""
        ? null
        : toNumber(partial.ocrConfidence, null),
    lowOcrConfidence: Boolean(partial.lowOcrConfidence),
    reviewRequired: Boolean(partial.reviewRequired) || direction === "UNKNOWN" || Boolean(reviewReason),
    reviewReason,
    sourceBoundingBox: partial.sourceBoundingBox || null,
  });
}

/**
 * Legacy parser satırı → kanonik.
 */
export function legacyBankRowToCanonical(row = {}, context = {}) {
  const debit = Number(row.borc || 0) || 0;
  const credit = Number(row.alacak || 0) || 0;
  const tutar = Number(row.tutar ?? 0);
  return createCanonicalBankTransaction({
    companyId: context.companyId || context.selectedCompanyId,
    bank: row.banka || context.selectedBank,
    accountIdentity: row.hesapNo || row.iban || context.accountNo,
    transactionDate: row.tarih,
    valueDate: row.valor || row.valueDate || row.tarih,
    description: row.aciklama,
    amount: tutar || (debit ? debit : credit ? -credit : 0),
    direction: row.yon,
    debit_amount: debit,
    credit_amount: credit,
    balance: row.bakiye,
    currency: context.currency || "TRY",
    sourceRow: row.excelRowNumber,
    sourceSheet: row.sheetName,
    sourcePage: row.sourcePage || row.page,
    sourceFileHash: context.sourceFileHash,
    documentNo: row.dekontNo,
    sourceType: context.sourceFileType || context.sourceType,
    parseWarnings: row.parseWarnings,
    parserVersion: context.parserVersion,
  });
}

export function legacyBankRowsToCanonical(rows = [], context = {}) {
  return (rows || []).map((row) => legacyBankRowToCanonical(row, context));
}

/**
 * Hareket bazlı dedup — aynı kimlik ikinci kez gelirse atlanır.
 * @returns {{ unique: object[], duplicates: object[] }}
 */
export function dedupeCanonicalTransactions(transactions = [], existingKeys = new Set()) {
  const seen = new Set(existingKeys);
  const unique = [];
  const duplicates = [];
  for (const tx of transactions || []) {
    const key = tx.transactionId || buildMovementIdentityKey(tx);
    if (seen.has(key)) {
      duplicates.push(tx);
      continue;
    }
    seen.add(key);
    unique.push(tx);
  }
  return { unique, duplicates, seenKeys: seen };
}

/**
 * Kanonik → legacy parser satırı (mevcut mapper/Luca uyumu).
 */
export function canonicalToLegacyBankRow(tx = {}) {
  const amount = Math.abs(Number(tx.amount) || 0);
  const isIn = tx.direction !== "CIKIS";
  return {
    banka: tx.bank,
    tarih: tx.transactionDate,
    aciklama: tx.description,
    dekontNo: tx.documentNo,
    borc: isIn ? amount : 0,
    alacak: isIn ? 0 : amount,
    bakiye: tx.balance,
    tutar: isIn ? amount : -amount,
    yon: tx.direction,
    hesapNo: tx.accountIdentity,
    iban: tx.accountIdentity,
    excelRowNumber: tx.sourceRow,
    sheetName: tx.sourceSheet,
    sourcePage: tx.sourcePage,
    sourceFileHash: tx.sourceFileHash,
    transactionId: tx.transactionId,
    currency: tx.currency,
    parseWarnings: tx.parseWarnings,
  };
}
