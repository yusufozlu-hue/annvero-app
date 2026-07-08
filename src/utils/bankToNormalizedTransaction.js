/**
 * Mevcut banka parser satırları → normalizedFinancialTransaction.
 * Legacy satır şeklini değiştirmez.
 */

import { normalizeParserText } from "@/src/utils/textNormalize";
import { formatParserDate } from "@/src/utils/bankMovementMapper";
import {
  createNormalizedFinancialTransaction,
  FINANCIAL_SOURCE_TYPES,
} from "@/src/models/normalizedFinancialTransaction";
import {
  detectSourceFileType,
  resolveParserName,
} from "@/src/utils/financialSourceArchitecture";

function balanceValue(row) {
  const raw = row.bakiye ?? row.Bakiye ?? row.balance;
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tek banka satırını (normalizeBankParsedRow çıktısı) ortak modele çevirir.
 */
export function bankParsedRowToNormalizedTransaction(row = {}, context = {}) {
  const bankName = row.banka || context.selectedBank || "";
  const sourceType = context.sourceType || FINANCIAL_SOURCE_TYPES.BANK;
  const descriptionRaw = String(row.aciklama || row.description || "").trim();

  return createNormalizedFinancialTransaction({
    id: context.id || undefined,
    company_id: context.companyId || context.selectedCompanyId || "",
    source_type: sourceType,
    source_name: context.sourceName || bankName,
    bank_name: bankName,
    account_no: row.hesapNo || row.account_no || context.accountNo || "",
    card_no_masked: context.cardNoMasked || row.card_no_masked || "",
    currency: context.currency || "TRY",
    transaction_date: formatParserDate(row.tarih || row.date || ""),
    description_raw: descriptionRaw,
    description_normalized: normalizeParserText(descriptionRaw),
    debit_amount: Number(row.borc || 0) || 0,
    credit_amount: Number(row.alacak || 0) || 0,
    balance: balanceValue(row),
    transaction_type: row.islemTipi || row.transaction_type || "DIGER",
    counterparty_name: row.unvan || row.counterparty_name || "",
    iban: row.iban || "",
    document_no: row.dekontNo || row.document_no || "",
    source_file_name: context.sourceFileName || "",
    source_file_type:
      context.sourceFileType ||
      detectSourceFileType(context.sourceFileName || "", context.mimeType || ""),
    parser_name:
      context.parserName ||
      resolveParserName(bankName, sourceType),
    recognition_status: context.recognition_status,
    suggested_account_code: context.suggested_account_code,
    suggested_counter_account_code: context.suggested_counter_account_code,
    suggested_cari: context.suggested_cari,
    suggested_document_type: context.suggested_document_type,
    confidence_score: context.confidence_score,
    risk_flags: context.risk_flags,
    _legacy_row: row,
  });
}

export function bankParsedRowsToNormalizedTransactions(rows = [], context = {}) {
  return (rows || []).map((row, index) =>
    bankParsedRowToNormalizedTransaction(row, {
      ...context,
      id: `nft-${context.selectedBank || "bank"}-${index + 1}-${Date.now().toString(36)}`,
    })
  );
}

/**
 * Standard movement satırından öneri alanlarını NFT üzerine yazar (bridge).
 */
export function applyMovementSuggestionsToTransaction(tx, movement = {}) {
  if (!tx || !movement) return tx;

  const accountCode = movement?.accountCode || "";
  const counterAccountCode = movement?.counterAccountCode || "";
  const mappingFailed =
    Boolean(movement?.mappingError) ||
    (!accountCode && !counterAccountCode) ||
    String(movement?.warning || "").includes("Hesap eşleşmesi bulunamadı");

  return {
    ...tx,
    suggested_account_code: tx.suggested_account_code || accountCode || null,
    suggested_counter_account_code:
      tx.suggested_counter_account_code || counterAccountCode || null,
    suggested_document_type:
      tx.suggested_document_type || movement?.documentType || "DK",
    suggested_cari:
      tx.suggested_cari ||
      movement?.cariSuggestions?.[0]?.title ||
      movement?.cariSuggestions?.[0]?.name ||
      "",
    counterparty_name: tx.counterparty_name || "",
    _movement_id: movement?.id || tx._movement_id || "",
    _mapping_failed: mappingFailed,
    risk_flags: mappingFailed
      ? [...new Set([...(tx.risk_flags || []), "missing_account"])]
      : tx.risk_flags || [],
  };
}
