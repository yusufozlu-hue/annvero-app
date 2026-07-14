import { normalizeParserText } from "@/src/utils/textNormalize";
import { finalizeStandardLucaRow, KAYNAK_TIPI } from "@/src/utils/standardLucaRow";
import { isLikelyBankGlAccount } from "@/src/utils/transactionMemoryEngine";

export const LEARNING_MEMORY_APPLIED_LABEL = "Öğrenen hafızadan eşleşti";

export function buildBankLucaLearningMemorySearchKey(row = {}) {
  return String(
    row.detayAciklama || row.fisAciklama || row.evrakNo || ""
  ).trim();
}

export function buildBankStandardLucaLearningMemoryPayload(
  originalRow,
  draft,
  companyId
) {
  const aramaAnahtari = buildBankLucaLearningMemorySearchKey({
    detayAciklama: draft.detayAciklama,
    fisAciklama: draft.fisAciklama,
    evrakNo: draft.evrakNo,
  });

  return {
    company_id: companyId,
    bank_name: String(originalRow.kaynakAdi || "").trim(),
    keyword: aramaAnahtari,
    account_code: String(draft.accountCode || "").trim(),
    account_name: String(draft.accountName || originalRow.hesapAdi || "").trim(),
    cari_name: String(draft.fisAciklama || originalRow.cariUnvan || "").trim(),
    document_type: String(draft.documentType || "DK").trim(),
    transaction_type: String(originalRow.kaynakTipi || KAYNAK_TIPI.BANKA).trim(),
    clean_description: String(
      draft.detayAciklama || originalRow.detayAciklama || ""
    ).trim(),
    raw_description: String(originalRow.detayAciklama || originalRow.fisAciklama || "").trim(),
    learned_at: new Date().toISOString(),
    status: "active",
  };
}

export function mapLearningMemoryRecordToItem(record, draft = {}, originalRow = {}) {
  return {
    id: record.id,
    firmaId: record.company_id,
    kaynakTipi:
      originalRow.kaynakTipi || record.transaction_type || record.source_module,
    kaynakAdi: originalRow.kaynakAdi || record.account_name,
    aramaAnahtari: record.keyword,
    eskiHesapKodu: record.counter_account_code,
    yeniHesapKodu: record.account_code,
    belgeTuru: record.document_type,
    fisAciklama:
      draft.fisAciklama || record.counter_account_name || originalRow.fisAciklama,
    detayAciklama:
      draft.detayAciklama || record.description_format || originalRow.detayAciklama,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    isActive:
      ["passive", "deleted"].includes(String(record.status || "").toLowerCase())
        ? false
        : record.is_active !== false,
  };
}

function normalizeKaynakTipi(value) {
  return normalizeParserText(value || "")
    .replace(/\bTR\d{2}[A-Z0-9]{10,30}\b/g, " ")
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{6,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value = "") {
  return new Set(
    normalizeKaynakTipi(value)
      .split(/\s+/)
      .filter((token) => token.length >= 2)
  );
}

function tokenOverlapScore(left = "", right = "") {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function levenshteinSimilarity(left = "", right = "") {
  const a = normalizeKaynakTipi(left);
  const b = normalizeKaynakTipi(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  const distance = previous[b.length];
  return 1 - distance / Math.max(a.length, b.length);
}

function getContextScores(record, row, context) {
  const rowTip = normalizeKaynakTipi(
    row.kaynakTipi || context.kaynakTipi || KAYNAK_TIPI.BANKA
  );
  const recordTip = normalizeKaynakTipi(
    record.transaction_type || record.source_module || ""
  );
  const rowBank = normalizeKaynakTipi(row.kaynakAdi || context.kaynakAdi || "");
  const recordBank = normalizeKaynakTipi(record.bank_name || "");
  const companyId = context.firmaId || context.companyId || row.firmaId || "";
  const recordCompany = record.company_id || "";

  const companyBoost = !recordCompany ? 8 : recordCompany === companyId ? 15 : -10;
  const bankBoost = !recordBank ? 6 : rowBank && recordBank === rowBank ? 15 : -8;
  const typeBoost = !recordTip ? 4 : rowTip && recordTip === rowTip ? 8 : -4;

  return { companyBoost, bankBoost, typeBoost };
}

function scoreMemorySearchKey(record, row) {
  const keyword = normalizeKaynakTipi(record.keyword);
  const cleanDescription = normalizeKaynakTipi(record.clean_description || "");
  const rawDescription = normalizeKaynakTipi(record.raw_description || "");
  const bankName = normalizeKaynakTipi(record.bank_name || "");
  const transactionType = normalizeKaynakTipi(record.transaction_type || "");
  const accountName = normalizeKaynakTipi(record.account_name || "");
  const cariName = normalizeKaynakTipi(
    record.cari_name || record.counter_account_name || ""
  );
  const rowKey = normalizeKaynakTipi(buildBankLucaLearningMemorySearchKey(row));

  if (!rowKey) return 0;

  const candidates = [keyword, cleanDescription, rawDescription].filter(Boolean);
  let best = 0;
  let bestDebug = {
    memoryKeyword: keyword,
    memoryCleanDescription: cleanDescription,
    normalizedMemory: "",
    score: 0,
  };

  for (const candidate of candidates) {
    let score = 0;
    if (rowKey === candidate) {
      score = 100;
    } else if (rowKey.includes(candidate) || candidate.includes(rowKey)) {
      score = 92;
    } else if (keyword && (rowKey.includes(keyword) || keyword.includes(rowKey))) {
      score = 88;
    } else {
      const overlap = tokenOverlapScore(rowKey, candidate);
      const fuzzy = levenshteinSimilarity(rowKey, candidate);
      score = Math.round(Math.max(overlap, fuzzy) * 100);
    }

    if (score > best) {
      best = score;
      bestDebug = {
        memoryKeyword: keyword,
        memoryCleanDescription: cleanDescription,
        normalizedMemory: candidate,
        score,
      };
    }
  }

  // Context fields are not primary descriptions; they only help confidence.
  if (bankName && rowKey.includes(bankName)) best += 5;
  if (transactionType && rowKey.includes(transactionType)) best += 3;
  if (accountName && rowKey.includes(accountName)) best += 3;
  if (cariName && rowKey.includes(cariName)) best += 5;

  return {
    score: Math.min(100, best),
    rowKey,
    ...bestDebug,
  };
}

export function findBankLucaLearningMemoryMatch(row, learningMemory = [], context = {}) {
  const firmaId = context.firmaId || context.companyId || row.firmaId || "";

  if (!firmaId) return null;

  let best = null;
  let bestScore = 0;

  for (const record of learningMemory) {
    if (record?.is_active === false) continue;
    if (["passive", "deleted"].includes(String(record?.status || "active").toLowerCase())) {
      continue;
    }

    const baseScore = scoreMemorySearchKey(record, row);
    const contextScores = getContextScores(record, row, context);
    const score = Math.max(
      0,
      Math.min(
        100,
        baseScore.score +
          contextScores.companyBoost +
          contextScores.bankBoost +
          contextScores.typeBoost
      )
    );

    if (baseScore.score < 65 && score < 65) continue;

    if (!best || score >= bestScore) {
      best = { ...record, _matchScore: score };
      bestScore = score;
    }
  }

  return best;
}

export function appendLearningMemoryNote(existingNote) {
  const current = String(existingNote || "").trim();

  if (current.includes(LEARNING_MEMORY_APPLIED_LABEL)) {
    return current;
  }

  if (!current) return LEARNING_MEMORY_APPLIED_LABEL;
  return `${current} | ${LEARNING_MEMORY_APPLIED_LABEL}`;
}

export function applyLearningMemoryToStandardLucaRows(
  rows = [],
  learningMemory = [],
  context = {}
) {
  if (!rows.length || !learningMemory.length) return rows;

  return rows.map((row) => {
    const match = findBankLucaLearningMemoryMatch(row, learningMemory, context);
    if (!match) return row;

    const existingAccount = String(row.hesapKodu || "").trim();
    // Banka GL satırını (102/103) öğrenilen gider hesabıyla ezme
    if (existingAccount && isLikelyBankGlAccount(existingAccount)) {
      return row;
    }

    const learnedAccount = String(match.account_code || "").trim();
    const learnedDocument = String(match.document_type || row.belgeTuru || "DK")
      .trim()
      .toUpperCase();
    const learnedCari = String(
      match.cari_name || match.counter_account_name || ""
    ).trim();
    const learnedDescription =
      String(match.clean_description || match.description_format || "").trim() ||
      row.detayAciklama;

    const matchedRow = finalizeStandardLucaRow({
      ...row,
      hesapKodu: learnedAccount || existingAccount,
      hesapAdi: String(match.account_name || row.hesapAdi || "").trim(),
      belgeTuru: learnedDocument,
      account_code: learnedAccount || existingAccount,
      account_name: String(match.account_name || row.hesapAdi || "").trim(),
      document_type: learnedDocument,
      cari_name: learnedCari,
      transaction_type: match.transaction_type || row.kaynakTipi || "",
      detayAciklama: learnedDescription,
      fisAciklama: learnedCari || row.fisAciklama,
      cariUnvan: learnedCari || row.cariUnvan,
      aciklama: learnedDescription || row.detayAciklama || row.fisAciklama,
      kontrolNotu: appendLearningMemoryNote(row.kontrolNotu),
      hafizaEslesme: true,
      memory_match: true,
      match_source: "learning_memory",
      confidence_score: match._matchScore || 100,
      matchedMemoryId: match.id,
      suggestedAccountCode: learnedAccount,
      suggestedAccountName: match.account_name || "",
      suggestedDocumentType: learnedDocument,
      suggestedCari: learnedCari,
      suggestedTransactionType: match.transaction_type || row.kaynakTipi || "",
      suggestionScore: match._matchScore || 100,
      suggestionConfidence:
        (match._matchScore || 100) >= 85
          ? "yüksek"
          : (match._matchScore || 0) >= 65
            ? "orta"
            : "düşük",
    });

    return matchedRow;
  });
}
