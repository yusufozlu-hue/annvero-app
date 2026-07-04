import { normalizeParserText } from "@/src/utils/textNormalize";
import { finalizeStandardLucaRow, KAYNAK_TIPI } from "@/src/utils/standardLucaRow";
import { isLikelyBankGlAccount } from "@/src/utils/transactionMemoryEngine";

const KNOWN_BANK_TOKENS = new Set([
  "GARANTI",
  "VAKIFBANK",
  "VAKIF",
  "TEB",
  "KUVEYT",
  "KUVEYTTURK",
  "ZIRAAT",
  "ISBANKASI",
  "ISBANK",
  "YAPIKREDI",
  "AKBANK",
  "HALKBANK",
  "DENIZBANK",
  "QNB",
  "FINANSBANK",
]);

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
    source_module: String(originalRow.kaynakTipi || KAYNAK_TIPI.BANKA).toLowerCase(),
    keyword: aramaAnahtari,
    account_code: String(draft.accountCode || "").trim(),
    counter_account_code: String(
      draft.originalAccountCode || originalRow.hesapKodu || ""
    ).trim(),
    account_name: String(originalRow.kaynakAdi || "").trim(),
    counter_account_name: String(
      draft.fisAciklama || originalRow.fisAciklama || ""
    ).trim(),
    document_type: String(draft.documentType || "DK").trim(),
    transaction_type: String(originalRow.kaynakTipi || KAYNAK_TIPI.BANKA).trim(),
    description_format: String(
      draft.detayAciklama || originalRow.detayAciklama || ""
    ).trim(),
    usage_count: 0,
    is_active: true,
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
    isActive: record.is_active !== false,
  };
}

function normalizeKaynakTipi(value) {
  return normalizeParserText(value || "");
}

function memoryMatchesKaynakTipi(record, row, context) {
  const rowTip = normalizeKaynakTipi(
    row.kaynakTipi || context.kaynakTipi || KAYNAK_TIPI.BANKA
  );
  const recordTip = normalizeKaynakTipi(
    record.source_module || record.transaction_type || ""
  );

  if (!recordTip) return true;
  return rowTip === recordTip;
}

function memoryMatchesKaynakAdi(record, row, context) {
  const rowBank = normalizeKaynakTipi(row.kaynakAdi || context.kaynakAdi || "");
  const recordBank = normalizeKaynakTipi(record.account_name || "");

  if (!recordBank || !rowBank) return true;

  // account_name çoğu zaman hesap adı (Reklam Giderleri); yalnızca banka adı ise filtrele
  const recordTokens = recordBank.split(/\s+/).filter(Boolean);
  const looksLikeBank = recordTokens.some((token) => KNOWN_BANK_TOKENS.has(token));
  if (!looksLikeBank) return true;

  return rowBank === recordBank || rowBank.includes(recordBank) || recordBank.includes(rowBank);
}

function scoreMemorySearchKey(record, row) {
  const keyword = normalizeKaynakTipi(record.keyword);
  const cleanDescription = normalizeKaynakTipi(record.clean_description || "");
  const rawDescription = normalizeKaynakTipi(record.raw_description || "");
  const rowKey = normalizeKaynakTipi(buildBankLucaLearningMemorySearchKey(row));

  if (!rowKey) return 0;

  const candidates = [keyword, cleanDescription, rawDescription].filter(Boolean);
  let best = 0;

  for (const candidate of candidates) {
    if (rowKey === candidate) {
      best = Math.max(best, 100);
      continue;
    }
    if (rowKey.includes(candidate)) {
      best = Math.max(best, 85 + Math.min(candidate.length, 10));
      continue;
    }
    if (candidate.includes(rowKey) && rowKey.length >= 3) {
      best = Math.max(best, 70);
      continue;
    }

    const candidateTokens = candidate.split(/\s+/).filter((token) => token.length >= 2);
    if (!candidateTokens.length) continue;

    if (candidateTokens.length === 1) {
      const token = candidateTokens[0];
      if (rowKey.includes(token)) best = Math.max(best, 85);
      continue;
    }

    const overlap = candidateTokens.filter((token) => rowKey.includes(token)).length;
    if (overlap > 0) {
      best = Math.max(best, Math.round((overlap / candidateTokens.length) * 80));
    }
  }

  return best;
}

export function findBankLucaLearningMemoryMatch(row, learningMemory = [], context = {}) {
  const firmaId = context.firmaId || context.companyId || row.firmaId || "";

  if (!firmaId) return null;

  let best = null;
  let bestScore = 0;

  for (const record of learningMemory) {
    if (record?.is_active === false) continue;
    if (record.company_id !== firmaId) continue;
    if (!memoryMatchesKaynakTipi(record, row, context)) continue;
    if (!memoryMatchesKaynakAdi(record, row, context)) continue;

    const score = scoreMemorySearchKey(record, row);
    if (score < 45) continue;

    if (!best || score >= bestScore) {
      best = record;
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
      detayAciklama: learnedDescription,
      fisAciklama: learnedCari || row.fisAciklama,
      cariUnvan: learnedCari || row.cariUnvan,
      aciklama: learnedDescription || row.detayAciklama || row.fisAciklama,
      kontrolNotu: appendLearningMemoryNote(row.kontrolNotu),
      hafizaEslesme: true,
      matchedMemoryId: match.id,
      suggestedAccountCode: learnedAccount,
      suggestedAccountName: match.account_name || "",
      suggestedDocumentType: learnedDocument,
      suggestedCari: learnedCari,
    });

    return matchedRow;
  });
}
