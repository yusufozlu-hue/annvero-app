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

/** Tanınmama nedenleri (UI badge / istatistik) */
export const ISSUE_TYPE = {
  MISSING_CARI: "missing_cari",
  MISSING_ACCOUNT: "missing_account",
  UNCLEAR_DOCUMENT: "unclear_document",
  FIRST_SEEN: "first_seen",
};

export const ISSUE_TYPE_META = {
  [ISSUE_TYPE.MISSING_CARI]: {
    id: ISSUE_TYPE.MISSING_CARI,
    label: "Cari bulunamadı",
    className: "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/40",
  },
  [ISSUE_TYPE.MISSING_ACCOUNT]: {
    id: ISSUE_TYPE.MISSING_ACCOUNT,
    label: "Hesap bulunamadı",
    className: "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/40",
  },
  [ISSUE_TYPE.UNCLEAR_DOCUMENT]: {
    id: ISSUE_TYPE.UNCLEAR_DOCUMENT,
    label: "Belge tipi belirsiz",
    className: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/40",
  },
  [ISSUE_TYPE.FIRST_SEEN]: {
    id: ISSUE_TYPE.FIRST_SEEN,
    label: "İlk kez görülen",
    className: "bg-red-500/15 text-red-200 ring-1 ring-red-500/40",
  },
};

export function resolveRowIssues(row = {}) {
  const account =
    String(row.accountCode || row.suggestedAccountCode || "").trim();
  const cari = String(row.cariName || row.suggestedCari || "").trim();
  const documentType = String(
    row.documentType || row.suggestedDocumentType || ""
  )
    .trim()
    .toUpperCase();
  const risk = String(row.metadata?.riskDurumu || "").trim().toUpperCase();
  const hasMemoryHint = Boolean(
    row.suggestedMemoryId || (Number(row.suggestionScore) || 0) >= 45
  );

  const issues = [];

  if (!hasMemoryHint) {
    issues.push(ISSUE_TYPE.FIRST_SEEN);
  }

  if (!account || risk === "HESAP_EKSIK") {
    issues.push(ISSUE_TYPE.MISSING_ACCOUNT);
  }

  if (!cari) {
    issues.push(ISSUE_TYPE.MISSING_CARI);
  }

  if (!documentType || documentType === "DK") {
    // Öneri yoksa ve yalnızca varsayılan DK ise belge tipi belirsiz sayılır
    if (!row.suggestedDocumentType && !row.documentType) {
      issues.push(ISSUE_TYPE.UNCLEAR_DOCUMENT);
    } else if (!row.suggestedDocumentType && !hasMemoryHint) {
      issues.push(ISSUE_TYPE.UNCLEAR_DOCUMENT);
    }
  }

  if (!issues.length) {
    issues.push(ISSUE_TYPE.FIRST_SEEN);
  }

  return issues;
}

export function getPrimaryIssue(row = {}) {
  const issues = resolveRowIssues(row);
  const priority = [
    ISSUE_TYPE.FIRST_SEEN,
    ISSUE_TYPE.MISSING_ACCOUNT,
    ISSUE_TYPE.MISSING_CARI,
    ISSUE_TYPE.UNCLEAR_DOCUMENT,
  ];

  for (const key of priority) {
    if (issues.includes(key)) return key;
  }

  return issues[0] || ISSUE_TYPE.FIRST_SEEN;
}

export function buildUnrecognizedStats(rows = []) {
  const pending = rows.filter((row) => row.status === UNRECOGNIZED_STATUS.PENDING);

  return {
    total: pending.length,
    missingCari: pending.filter((row) =>
      resolveRowIssues(row).includes(ISSUE_TYPE.MISSING_CARI)
    ).length,
    missingAccount: pending.filter((row) =>
      resolveRowIssues(row).includes(ISSUE_TYPE.MISSING_ACCOUNT)
    ).length,
    unclearDocument: pending.filter((row) =>
      resolveRowIssues(row).includes(ISSUE_TYPE.UNCLEAR_DOCUMENT)
    ).length,
    firstSeen: pending.filter((row) =>
      resolveRowIssues(row).includes(ISSUE_TYPE.FIRST_SEEN)
    ).length,
  };
}

export function parseTransactionDateValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (tr) {
    return new Date(Number(tr[3]), Number(tr[2]) - 1, Number(tr[1]));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function filterUnrecognizedRows(rows = [], filters = {}) {
  const {
    search = "",
    status = "pending",
    bank = "",
    transactionType = "",
    issueType = "",
    dateFrom = "",
    dateTo = "",
  } = filters;

  const query = String(search || "").trim().toLocaleLowerCase("tr-TR");
  const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
  const toDate = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

  return rows.filter((row) => {
    if (status && status !== "all" && row.status !== status) return false;

    if (bank && String(row.sourceBank || "") !== bank) return false;

    if (
      transactionType &&
      String(row.transactionType || "").toUpperCase() !==
        String(transactionType).toUpperCase()
    ) {
      return false;
    }

    if (issueType) {
      const issues = resolveRowIssues(row);
      if (!issues.includes(issueType)) return false;
    }

    if (fromDate || toDate) {
      const rowDate = parseTransactionDateValue(row.transactionDate);
      if (!rowDate) return false;
      if (fromDate && rowDate < fromDate) return false;
      if (toDate && rowDate > toDate) return false;
    }

    if (!query) return true;

    const haystack = [
      row.rawDescription,
      row.cleanDescription,
      row.keyword,
      row.suggestedAccountCode,
      row.suggestedAccountName,
      row.suggestedCari,
      row.sourceBank,
      row.transactionType,
    ]
      .join(" ")
      .toLocaleLowerCase("tr-TR");

    return haystack.includes(query);
  });
}

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
