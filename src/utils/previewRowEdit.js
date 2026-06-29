import { normalizeParserText } from "@/src/utils/textNormalize";

export const DOCUMENT_TYPE_OPTIONS = [
  "EA",
  "EF",
  "DK",
  "KR",
  "NM",
  "SMM",
  "FT",
];

export const MEMORY_MATCH_LABEL = "Hafızadan eşleşti";

export function extractDescriptionKeyword(text) {
  const normalized = normalizeParserText(text);
  if (!normalized) return "";

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return normalized;

  return words.slice(0, 4).join(" ");
}

export function extractSeriesPrefix(text, documentSeriesRules = []) {
  const normalized = normalizeParserText(text);

  for (const rule of documentSeriesRules || []) {
    const prefix = normalizeParserText(rule.prefix);
    if (prefix && normalized.includes(prefix)) {
      return rule.prefix;
    }
  }

  return "";
}

export function buildMovementEditDraft(row) {
  const amount = Math.abs(Number(row.amount || 0));
  const isIncoming = row.direction === "GIRIS";

  return {
    accountCode: row.accountCode || "",
    counterAccountCode: row.counterAccountCode || "",
    documentType: row.documentType || "DK",
    description: row.lucaDescription || row.description || "",
    borc: isIncoming ? amount : "",
    alacak: isIncoming ? "" : amount,
    cariAccountCode: row.counterAccountCode || "",
    controlNote: row.controlNote || "",
    saveToMemory: false,
  };
}

export function applyMovementEditDraft(row, draft) {
  const borc = parsePreviewAmount(draft.borc);
  const alacak = parsePreviewAmount(draft.alacak);
  const amount = Math.max(borc, alacak);
  const direction = borc >= alacak && borc > 0 ? "GIRIS" : "CIKIS";

  const counterAccountCode =
    draft.cariAccountCode?.trim() || draft.counterAccountCode?.trim() || "";

  const controlNote = String(draft.controlNote || "").trim();
  let warning = String(row.warning || "");

  warning = warning
    .split(" | ")
    .filter((part) => !part.startsWith("Kontrol notu:"))
    .join(" | ");

  if (controlNote) {
    warning = warning
      ? `${warning} | Kontrol notu: ${controlNote}`
      : `Kontrol notu: ${controlNote}`;
  }

  return {
    ...row,
    accountCode: String(draft.accountCode || "").trim(),
    counterAccountCode,
    documentType: String(draft.documentType || "DK").trim(),
    lucaDescription: String(draft.description || "").trim(),
    amount,
    direction,
    controlNote,
    warning,
    manuallyEdited: true,
  };
}

export function buildFisLineEditDraft(fis, lineIndex) {
  const line = fis.satirlar[lineIndex] || {};

  return {
    accountCode: line.hesapKodu || "",
    documentType: fis.belgeTuru || "DK",
    description: line.aciklama || fis.aciklama || "",
    borc: line.borc ?? "",
    alacak: line.alacak ?? "",
    cariAccountCode: "",
    controlNote: fis.controlNote || "",
    saveToMemory: false,
  };
}

export function applyFisLineEditDraft(fis, lineIndex, draft) {
  const satirlar = fis.satirlar.map((line, index) => {
    if (index !== lineIndex) return line;

    return {
      ...line,
      hesapKodu: String(draft.accountCode || "").trim(),
      aciklama: String(draft.description || "").trim(),
      borc: draft.borc === "" ? "" : parsePreviewAmount(draft.borc),
      alacak: draft.alacak === "" ? "" : parsePreviewAmount(draft.alacak),
    };
  });

  const controlNote = String(draft.controlNote || "").trim();

  return {
    ...fis,
    belgeTuru: String(draft.documentType || fis.belgeTuru || "DK").trim(),
    aciklama:
      lineIndex === 0
        ? String(draft.description || "").trim()
        : fis.aciklama,
    controlNote,
    uyari: controlNote ? `Kontrol notu: ${controlNote}` : fis.uyari,
    satirlar,
    manuallyEdited: true,
  };
}

export function buildElektrawebEditDraft(row) {
  return {
    accountCode: row.hesapKodu || "",
    documentType: row.belgeTuru || "",
    description:
      row.detayAciklama || row.fisAciklama || row.aciklama || "",
    borc: row.borc ?? "",
    alacak: row.alacak ?? "",
    cariAccountCode: "",
    controlNote: row.kontrolNotu || row.risk || "",
    saveToMemory: false,
  };
}

export function applyElektrawebEditDraft(row, draft) {
  const controlNote = String(draft.controlNote || "").trim();
  const description = String(draft.description || "").trim();

  return {
    ...row,
    belgeTuru: String(draft.documentType || "").trim(),
    aciklama: description,
    detayAciklama: description,
    fisAciklama: row.fisAciklama || description,
    borc: draft.borc === "" ? "" : parsePreviewAmount(draft.borc),
    alacak: draft.alacak === "" ? "" : parsePreviewAmount(draft.alacak),
    hesapKodu: String(draft.accountCode || "").trim(),
    riskDurumu: String(draft.accountCode || "").trim() ? "" : "HESAP_EKSIK",
    kontrolNotu: controlNote || row.kontrolNotu || "",
    risk: controlNote || row.risk,
    hesapEslesmeNotlari: String(draft.accountCode || "").trim()
      ? []
      : row.hesapEslesmeNotlari || [],
    eslesmeYontemi: String(draft.accountCode || "").trim()
      ? row.eslesmeYontemi || "manuel"
      : "",
    manuallyEdited: true,
  };
}

export function buildLearningMemoryPayload({
  companyId,
  sourceModule,
  bankName = "",
  description = "",
  documentSeriesRules = [],
  counterpartyName = "",
  accountCode = "",
  counterAccountCode = "",
  documentType = "DK",
  standardDescription = "",
  transactionType = "",
}) {
  const keyword = extractDescriptionKeyword(description);
  const seriesPrefix = extractSeriesPrefix(description, documentSeriesRules);

  return {
    company_id: companyId,
    source_module: sourceModule,
    keyword,
    account_code: accountCode,
    account_name: bankName || "",
    counter_account_code: counterAccountCode,
    counter_account_name: counterpartyName || seriesPrefix || "",
    document_type: documentType,
    transaction_type: transactionType || bankName || sourceModule,
    description_format: standardDescription || description,
    usage_count: 0,
    is_active: true,
  };
}

export function buildLearningMemoryFromMovementRow(
  row,
  draft,
  { companyId, sourceModule = "banka", documentSeriesRules = [] }
) {
  const isIncoming = row.direction === "GIRIS";

  return buildLearningMemoryPayload({
    companyId,
    sourceModule,
    bankName: row.bankName || "",
    description: row.description || draft.description,
    documentSeriesRules,
    counterpartyName: draft.cariAccountCode || row.counterAccountCode || "",
    accountCode: isIncoming
      ? draft.counterAccountCode || draft.cariAccountCode
      : draft.accountCode,
    counterAccountCode: isIncoming
      ? draft.accountCode
      : draft.counterAccountCode || draft.cariAccountCode,
    documentType: draft.documentType,
    standardDescription: draft.description,
    transactionType: row.bankName || sourceModule,
  });
}

function parsePreviewAmount(value) {
  if (typeof value === "number") return Math.abs(value);

  const text = String(value || "")
    .replaceAll("TL", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const number = Number(text);
  return Number.isNaN(number) ? 0 : Math.abs(number);
}
