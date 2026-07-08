/**
 * Dosya türü ve kaynak mimarisi — Excel dışında CSV/PDF/OCR/ZIP/e-posta eki için açık bırakılır.
 * Bugün aktif: Excel workbook. Diğerleri stub + kayıt noktaları.
 */

export const SUPPORTED_FILE_TYPES = {
  XLSX: "xlsx",
  XLS: "xls",
  CSV: "csv",
  PDF: "pdf",
  OCR_PDF: "ocr_pdf",
  ZIP: "zip",
  EMAIL_ATTACHMENT: "email_attachment",
};

export const FILE_TYPE_CAPABILITY = {
  [SUPPORTED_FILE_TYPES.XLSX]: { active: true, reader: "excelSheet" },
  [SUPPORTED_FILE_TYPES.XLS]: { active: true, reader: "excelSheet" },
  [SUPPORTED_FILE_TYPES.CSV]: { active: false, reader: "csvSheet" },
  [SUPPORTED_FILE_TYPES.PDF]: { active: false, reader: "pdfText" },
  [SUPPORTED_FILE_TYPES.OCR_PDF]: { active: false, reader: "pdfOcr" },
  [SUPPORTED_FILE_TYPES.ZIP]: { active: false, reader: "zipExtract" },
  [SUPPORTED_FILE_TYPES.EMAIL_ATTACHMENT]: { active: false, reader: "emailAttachment" },
};

export const BANK_PARSER_NAMES = {
  GARANTI: "garantiParser",
  VAKIFBANK: "vakifbankParser",
  TEB: "genericBankEkstre+tebHavale",
  KUVEYT: "genericBankEkstre",
  ZIRAAT: "genericBankEkstre",
  CREDIT_CARD_STUB: "creditCardParserStub",
  GENERIC: "genericBankEkstre",
};

export function resolveParserName(selectedBank = "", sourceType = "bank") {
  if (sourceType === "credit_card") return BANK_PARSER_NAMES.CREDIT_CARD_STUB;
  const key = String(selectedBank || "").toUpperCase();
  return BANK_PARSER_NAMES[key] || BANK_PARSER_NAMES.GENERIC;
}

export function detectSourceFileType(fileName = "", mimeType = "") {
  const name = String(fileName || "").toLowerCase();
  const mime = String(mimeType || "").toLowerCase();

  if (name.endsWith(".xlsx") || mime.includes("spreadsheetml")) return SUPPORTED_FILE_TYPES.XLSX;
  if (name.endsWith(".xls") || mime.includes("ms-excel")) return SUPPORTED_FILE_TYPES.XLS;
  if (name.endsWith(".csv") || mime.includes("text/csv")) return SUPPORTED_FILE_TYPES.CSV;
  if (name.endsWith(".pdf") || mime.includes("pdf")) return SUPPORTED_FILE_TYPES.PDF;
  if (name.endsWith(".zip") || mime.includes("zip")) return SUPPORTED_FILE_TYPES.ZIP;
  if (mime.includes("message/") || name.includes("email")) {
    return SUPPORTED_FILE_TYPES.EMAIL_ATTACHMENT;
  }
  return SUPPORTED_FILE_TYPES.XLSX;
}

export function isFileTypeActive(fileType = "") {
  return Boolean(FILE_TYPE_CAPABILITY[fileType]?.active);
}

/**
 * Kredi kartı ekstresi için mimari giriş noktası.
 * Bugün satır parser yazılmaz; boş dizi + metadata döner.
 */
export function parseCreditCardStatementStub(_rows = [], context = {}) {
  return {
    source_type: "credit_card",
    parser_name: BANK_PARSER_NAMES.CREDIT_CARD_STUB,
    bank_name: context.bankName || context.cardIssuer || "",
    card_no_masked: context.cardNoMasked || "",
    rows: [],
    note: "Kredi kartı parser altyapısı hazır; detaylı kart parserları sonraki sprintte eklenecek.",
  };
}

/**
 * Kaynak seçimine göre parse yönlendirmesi (gelecek: CSV/PDF/ZIP).
 * Mevcut bank Excel akışını değiştirmez.
 */
export async function resolveSourceReader(fileType = SUPPORTED_FILE_TYPES.XLSX) {
  const capability = FILE_TYPE_CAPABILITY[fileType];
  if (!capability?.active) {
    return {
      ok: false,
      fileType,
      error: `${fileType} henüz aktif değil; mimari kayıt noktası mevcut.`,
    };
  }
  return { ok: true, fileType, reader: capability.reader };
}
