import {
  KNOWLEDGE_ENTITY_FAMILIES,
  KNOWLEDGE_SOURCE_TYPES,
} from "@/src/lib/knowledge-engine/constants";

export const KNOWLEDGE_BUILDER_ENTITY_FAMILIES = Object.values(KNOWLEDGE_ENTITY_FAMILIES);
export const KNOWLEDGE_BUILDER_SOURCE_TYPES = [
  KNOWLEDGE_SOURCE_TYPES.BANK,
  KNOWLEDGE_SOURCE_TYPES.CREDIT_CARD,
  KNOWLEDGE_SOURCE_TYPES.POS,
];
export const KNOWLEDGE_BUILDER_DOCUMENT_TYPES = ["EA", "EF", "DK", "KR", "NM", "SMM", "FT"];
export const KNOWLEDGE_BUILDER_RISK_LEVELS = ["low", "medium", "high"];

export function buildTeachFormFromMovement(movement = {}, context = {}) {
  const preview = movement.corePreview || {};
  const rawRow = movement.rawRow || {};

  return {
    company_id: context.selectedCompanyId || "",
    company_name: context.companyName || "",
    keyword: String(movement.description || rawRow.aciklama || "").trim(),
    entity_name: String(preview.matched_entity || "").trim(),
    entity_family: "other",
    transaction_type: String(rawRow.islem_tipi || rawRow.transaction_type || "").trim(),
    source_type: context.sourceType || "bank",
    bank_name: String(movement.bankName || rawRow.banka || context.selectedBank || "").trim(),
    account_code: String(
      preview.suggested_account_code || movement.counterAccountCode || ""
    ).trim(),
    account_name: String(movement._coreSuggestedAccountName || "").trim(),
    counter_account_code: "",
    cari: String(preview.suggested_cari || "").trim(),
    document_type: String(
      preview.suggested_document_type || movement.documentType || "DK"
    ).trim(),
    vat_rate:
      movement._coreVatRate == null || movement._coreVatRate === ""
        ? ""
        : String(movement._coreVatRate),
    description_template: String(movement.description || rawRow.aciklama || "").trim(),
    risk_level: String(preview.risk_level || movement._coreRiskLevel || "low").trim() || "low",
    is_global: false,
  };
}

export function buildMovementTransactionForRerun(movement = {}, context = {}) {
  const rawRow = movement.rawRow || {};
  const amount = Math.abs(Number(rawRow.tutar ?? rawRow.amount ?? movement.amount ?? 0));
  const direction =
    rawRow.yon === "CIKIS" || rawRow.direction === "CIKIS" || movement.direction === "CIKIS"
      ? "CIKIS"
      : "GIRIS";

  return {
    source_type: context.sourceType || "bank",
    raw_description: movement.description || rawRow.aciklama || "",
    amount: direction === "CIKIS" ? -amount : amount,
    currency: "TRY",
    transaction_date: rawRow.tarih || rawRow.date || movement.date || "",
    bank_name: movement.bankName || rawRow.banka || context.selectedBank || "",
    counterparty_name: rawRow.karsiHesap || rawRow.counterparty_name || "",
    document_type: movement.documentType || rawRow.belgeTuru || "",
    raw_payload: {
      direction,
      parser_bank: context.selectedBank || "",
    },
  };
}
