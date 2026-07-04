import { normalizeParserText } from "@/src/utils/textNormalize";
import { extractDescriptionKeyword } from "@/src/utils/previewRowEdit";

export const UNRECOGNIZED_STATUS = {
  PENDING: "pending",
  LEARNED: "learned",
  DISMISSED: "dismissed",
};

export const UNRECOGNIZED_STATUS_LABEL = {
  pending: "Bekliyor",
  learned: "Öğrenildi",
  dismissed: "Yok sayıldı",
};

const NOISE_TOKENS = new Set([
  "TR",
  "TL",
  "TRY",
  "USD",
  "EUR",
  "IBAN",
  "EFT",
  "HAVALE",
  "ODEME",
  "ÖDEME",
  "TAHSILAT",
  "POS",
  "KART",
  "NO",
  "REF",
  "REFNO",
]);

export function cleanTransactionDescription(raw = "") {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/[|]+/g, " ")
    .trim();
}

export function extractTransactionKeyword(raw = "") {
  const cleaned = cleanTransactionDescription(raw);
  const base = extractDescriptionKeyword(cleaned);
  if (!base) return "";

  const tokens = normalizeParserText(base)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !NOISE_TOKENS.has(token))
    .filter((token) => !/^\d{4,}$/.test(token))
    .filter((token) => token.length > 1);

  if (!tokens.length) return base;
  return tokens.slice(0, 4).join(" ");
}

export function isUnrecognizedStandardRow(row = {}) {
  if (row?.hafizaEslesme) return false;

  const hesapKodu = String(row.hesapKodu || "").trim();
  const risk = String(row.riskDurumu || "").trim().toUpperCase();
  const note = normalizeParserText(
    `${row.kontrolNotu || ""} ${row.warning || ""} ${row.uyari || ""}`
  );

  if (!hesapKodu) return true;
  if (risk === "HESAP_EKSIK") return true;
  if (
    note.includes("BULUNAMAD") ||
    note.includes("ESLESMEDI") ||
    note.includes("TANINMAD") ||
    note.includes("HESAP EKSIK")
  ) {
    return true;
  }

  return false;
}

export function buildUnrecognizedFingerprint(item = {}) {
  return [
    item.companyId || item.company_id || "",
    item.sourceRowId || item.source_row_id || "",
    item.rawDescription || item.raw_description || "",
    item.transactionDate || item.transaction_date || "",
    String(item.amount ?? ""),
  ]
    .map((part) => normalizeParserText(part))
    .join("|");
}

export function mapStandardRowToUnrecognizedCandidate(row = {}, context = {}) {
  const rawDescription = cleanTransactionDescription(
    row.detayAciklama || row.fisAciklama || row.aciklama || row.description || ""
  );

  if (!rawDescription) return null;

  const amount =
    Number(row.borc || 0) > 0
      ? Number(row.borc)
      : Number(row.alacak || 0) > 0
        ? Number(row.alacak)
        : Number(row.tutar || row.amount || 0);

  return {
    companyId: context.companyId || row.firmaId || "",
    sourceModule: String(context.sourceModule || row.kaynakTipi || "banka").toLowerCase(),
    sourceBank: context.sourceBank || row.kaynakAdi || "",
    sourceRowId: String(row.id || row.sourceRowId || ""),
    transactionDate: row.fisTarihi || row.evrakTarihi || row.tarih || "",
    amount: Number.isFinite(amount) ? amount : 0,
    direction: Number(row.borc || 0) > 0 ? "BORC" : "ALACAK",
    rawDescription,
    cleanDescription: rawDescription,
    keyword: extractTransactionKeyword(rawDescription),
    transactionType: row.kaynakTipi || context.sourceModule || "BANKA",
    metadata: {
      belgeNo: row.belgeNo || "",
      evrakNo: row.evrakNo || "",
      riskDurumu: row.riskDurumu || "",
      kontrolNotu: row.kontrolNotu || "",
    },
  };
}

export function collectUnrecognizedFromStandardRows(rows = [], context = {}) {
  const seen = new Set();
  const items = [];

  for (const row of rows) {
    if (!isUnrecognizedStandardRow(row)) continue;

    const candidate = mapStandardRowToUnrecognizedCandidate(row, context);
    if (!candidate?.companyId || !candidate.rawDescription) continue;

    const fingerprint = buildUnrecognizedFingerprint(candidate);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    items.push(candidate);
  }

  return items;
}

function scoreKeywordMatch(keyword, haystack) {
  const key = normalizeParserText(keyword);
  const text = normalizeParserText(haystack);
  if (!key || !text) return 0;

  if (text === key) return 100;
  if (text.includes(key)) return 80 + Math.min(key.length, 15);
  if (key.includes(text) && text.length >= 4) return 70;

  const keyTokens = key.split(/\s+/).filter(Boolean);
  const textTokens = new Set(text.split(/\s+/).filter(Boolean));
  const overlap = keyTokens.filter((token) => textTokens.has(token)).length;

  if (!overlap) return 0;
  return Math.round((overlap / keyTokens.length) * 60);
}

export function findLearningSuggestion(candidate = {}, learningMemory = []) {
  const companyId = candidate.companyId || candidate.company_id;
  const keyword = candidate.keyword || extractTransactionKeyword(candidate.rawDescription);
  const description = candidate.rawDescription || candidate.cleanDescription || "";

  let best = null;
  let bestScore = 0;

  for (const record of learningMemory) {
    if (record?.is_active === false) continue;
    if (companyId && record.company_id && record.company_id !== companyId) continue;

    const score = Math.max(
      scoreKeywordMatch(record.keyword, keyword),
      scoreKeywordMatch(record.keyword, description),
      scoreKeywordMatch(record.clean_description || "", description),
      scoreKeywordMatch(record.raw_description || "", description)
    );

    if (score < 45) continue;
    if (score >= bestScore) {
      best = record;
      bestScore = score;
    }
  }

  if (!best) return null;

  return {
    memoryId: best.id,
    accountCode: best.account_code || "",
    accountName: best.account_name || "",
    documentType: best.document_type || "DK",
    cariName: best.cari_name || best.counter_account_name || "",
    score: bestScore,
    keyword: best.keyword || "",
  };
}

export function applySuggestionsToCandidates(candidates = [], learningMemory = []) {
  return candidates.map((item) => {
    const suggestion = findLearningSuggestion(item, learningMemory);
    if (!suggestion) return item;

    return {
      ...item,
      suggestedAccountCode: suggestion.accountCode,
      suggestedAccountName: suggestion.accountName,
      suggestedDocumentType: suggestion.documentType,
      suggestedCari: suggestion.cariName,
      suggestedMemoryId: suggestion.memoryId,
      suggestionScore: suggestion.score,
    };
  });
}

export function buildLearnPayloadFromQueueItem(item = {}, draft = {}) {
  const rawDescription = cleanTransactionDescription(
    draft.rawDescription ?? item.raw_description ?? item.rawDescription ?? ""
  );
  const cleanDescription = cleanTransactionDescription(
    draft.cleanDescription ?? item.clean_description ?? item.cleanDescription ?? rawDescription
  );
  const keyword = String(
    draft.keyword ?? item.keyword ?? extractTransactionKeyword(cleanDescription || rawDescription)
  ).trim();

  const accountCode = String(draft.accountCode ?? item.account_code ?? item.suggested_account_code ?? "").trim();
  const accountName = String(draft.accountName ?? item.account_name ?? item.suggested_account_name ?? "").trim();
  const documentType = String(
    draft.documentType ?? item.document_type ?? item.suggested_document_type ?? "DK"
  )
    .trim()
    .toUpperCase();
  const cariName = String(draft.cariName ?? item.cari_name ?? item.suggested_cari ?? "").trim();
  const transactionType = String(
    draft.transactionType ?? item.transaction_type ?? "BANKA"
  ).trim();

  return {
    company_id: item.company_id || item.companyId,
    source_module: item.source_module || item.sourceModule || "banka",
    keyword,
    raw_description: rawDescription,
    clean_description: cleanDescription,
    account_code: accountCode,
    account_name: accountName,
    counter_account_code: "",
    counter_account_name: cariName,
    cari_name: cariName,
    document_type: documentType || "DK",
    transaction_type: transactionType,
    description_format: cleanDescription || rawDescription,
    user_correction: String(draft.userCorrection || "").trim(),
    learned_at: new Date().toISOString(),
    usage_count: 0,
    is_active: true,
  };
}

export function mapUnrecognizedDbRow(row = {}) {
  return {
    id: row.id,
    companyId: row.company_id,
    sourceModule: row.source_module,
    sourceBank: row.source_bank,
    sourceRowId: row.source_row_id,
    transactionDate: row.transaction_date,
    amount: row.amount,
    direction: row.direction,
    rawDescription: row.raw_description,
    cleanDescription: row.clean_description,
    keyword: row.keyword,
    transactionType: row.transaction_type,
    suggestedAccountCode: row.suggested_account_code,
    suggestedAccountName: row.suggested_account_name,
    suggestedDocumentType: row.suggested_document_type,
    suggestedCari: row.suggested_cari,
    suggestedMemoryId: row.suggested_memory_id,
    suggestionScore: row.suggestion_score,
    accountCode: row.account_code,
    accountName: row.account_name,
    documentType: row.document_type,
    cariName: row.cari_name,
    status: row.status,
    userCorrection: row.user_correction,
    learnedMemoryId: row.learned_memory_id,
    learnedAt: row.learned_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toUnrecognizedInsertRow(item = {}) {
  return {
    company_id: item.companyId,
    source_module: item.sourceModule || "banka",
    source_bank: item.sourceBank || "",
    source_row_id: item.sourceRowId || "",
    transaction_date: item.transactionDate || "",
    amount: item.amount ?? null,
    direction: item.direction || "",
    raw_description: item.rawDescription || "",
    clean_description: item.cleanDescription || item.rawDescription || "",
    keyword: item.keyword || extractTransactionKeyword(item.rawDescription),
    transaction_type: item.transactionType || "BANKA",
    suggested_account_code: item.suggestedAccountCode || "",
    suggested_account_name: item.suggestedAccountName || "",
    suggested_document_type: item.suggestedDocumentType || "",
    suggested_cari: item.suggestedCari || "",
    suggested_memory_id: item.suggestedMemoryId || null,
    suggestion_score: item.suggestionScore ?? null,
    status: UNRECOGNIZED_STATUS.PENDING,
    metadata: item.metadata || {},
    updated_at: new Date().toISOString(),
  };
}
