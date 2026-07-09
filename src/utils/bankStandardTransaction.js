/**
 * Banka parser satırı → ANNVERO CORE standart işlem girdisi.
 * Mevcut bankParsedRowToNormalizedTransaction üzerinden türetilir (kod tekrarı yok).
 */

import { bankParsedRowToNormalizedTransaction } from "@/src/utils/bankToNormalizedTransaction";

function signedAmountFromRow(row = {}) {
  const amountRaw = Number(row.tutar ?? row.amount ?? 0);
  const direction = row.yon === "CIKIS" || row.direction === "CIKIS" ? "CIKIS" : "GIRIS";
  if (amountRaw !== 0) return amountRaw;
  return direction === "CIKIS"
    ? -Math.abs(Number(row.alacak || 0))
    : Math.abs(Number(row.borc || 0));
}

export function bankRowToStandardTransaction(row = {}, context = {}) {
  const nft = bankParsedRowToNormalizedTransaction(row, context);
  const direction = row.yon === "CIKIS" || row.direction === "CIKIS" ? "CIKIS" : "GIRIS";

  return {
    company_id: nft.company_id,
    source_type: nft.source_type || "bank",
    bank_name: nft.bank_name,
    raw_description: nft.description_raw,
    amount: signedAmountFromRow(row) || null,
    currency: nft.currency || "TRY",
    transaction_date: nft.transaction_date,
    iban: nft.iban || "",
    counterparty_name: nft.counterparty_name || "",
    tax_no: String(row.tax_no || row.taxNo || row.vergiNo || "").trim(),
    document_type: String(row.belgeTuru || row.document_type || "").trim(),
    raw_payload: {
      dekont_no: nft.document_no || "",
      islem_tipi: nft.transaction_type || "",
      direction,
      hesap_no: nft.account_no || "",
      bakiye: nft.balance ?? null,
      parser_bank: context.selectedBank || nft.bank_name,
      source_file_name: nft.source_file_name || context.sourceFileName || "",
    },
  };
}

export function bankRowsToStandardTransactions(rows = [], context = {}) {
  return (rows || [])
    .filter((row) => Math.abs(Number(row?.tutar ?? row?.amount ?? 0)) > 0)
    .map((row) => bankRowToStandardTransaction(row, context));
}
