/**
 * Ortak Luca / ANNVERO belge türü sözleşmesi.
 * Kaynak kodlar aynen korunur (remap yok): KR→KR, MF→MF.
 */

/** Fiş Kontrol allowlist — Luca import + Elektra Dok Tipi kanıtlı kodlar dahil. */
export const LUCA_DOCUMENT_TYPE_CODES = Object.freeze([
  "EA",
  "EF",
  "NM",
  "DK",
  "KR",
  "MF",
  "SM",
  "SMM",
  "MS",
  "DF",
  "HS",
  "DM",
  "KD",
  "FT",
  "PO",
]);

export const VALID_LUCA_DOCUMENT_TYPES = new Set(LUCA_DOCUMENT_TYPE_CODES);

/**
 * UI / manuel düzenleme seçenekleri.
 * Allowlist’in alt kümesi; MF dahil (KR zaten vardı).
 */
export const DOCUMENT_TYPE_OPTIONS = Object.freeze([
  "EA",
  "EF",
  "DK",
  "KR",
  "MF",
  "NM",
  "SMM",
  "FT",
]);

export function normalizeLucaDocumentType(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function isValidLucaDocumentType(value) {
  const code = normalizeLucaDocumentType(value);
  return Boolean(code) && VALID_LUCA_DOCUMENT_TYPES.has(code);
}
