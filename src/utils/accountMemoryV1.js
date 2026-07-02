import { normalizeParserText } from "@/src/utils/textNormalize";
import { finalizeStandardLucaRow } from "@/src/utils/standardLucaRow";

const STORAGE_KEY = "annvero-account-memory-v1";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function normalizeAccountMemoryDescription(row = {}) {
  return normalizeParserText(
    row.detayAciklama || row.fisAciklama || row.aciklama || ""
  );
}

function readAllRecords() {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAllRecords(records) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function resolveCompanyId(row, context = {}) {
  return String(context.firmaId || context.companyId || row.firmaId || "").trim();
}

function resolveBankName(row, context = {}) {
  return String(context.kaynakAdi || context.bankName || row.kaynakAdi || "").trim();
}

function getRowDescription(row = {}) {
  return String(row.detayAciklama || row.fisAciklama || row.aciklama || "").trim();
}

function tokenize(text) {
  return normalizeParserText(text)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function computeSimilarityScore(rowDescription, recordDescription) {
  const left = normalizeParserText(rowDescription);
  const right = normalizeParserText(recordDescription);

  if (!left || !right) return 0;
  if (left === right) return 100;

  if (left.includes(right) || right.includes(left)) {
    const shorter = Math.min(left.length, right.length);
    const longer = Math.max(left.length, right.length);
    const ratio = shorter / longer;
    return Math.min(90, Math.max(70, Math.round(70 + ratio * 20)));
  }

  const leftTokens = new Set(tokenize(left));
  const rightTokens = tokenize(right);

  if (!leftTokens.size || !rightTokens.length) return 0;

  let overlap = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) overlap += 1;
  }

  if (overlap === 0) return 0;

  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = overlap / unionSize;
  const score = Math.round(70 + jaccard * 20);

  return Math.min(89, Math.max(70, score));
}

function recordMatchesContext(record, row, context) {
  const companyId = resolveCompanyId(row, context);
  if (!companyId || record.companyId !== companyId) return false;

  const bankName = normalizeParserText(resolveBankName(row, context));
  const recordBank = normalizeParserText(record.bankName || "");

  if (recordBank && bankName && recordBank !== bankName) return false;

  return true;
}

function buildRecordId() {
  return `am-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveAccountMemoryFromEdit(row = {}, context = {}) {
  const companyId = resolveCompanyId(row, context);
  const normalizedDescription = normalizeAccountMemoryDescription(row);
  const accountCode = String(row.hesapKodu || "").trim();
  const accountName = String(row.hesapAdi || "").trim();

  if (!companyId || !normalizedDescription || !accountCode) {
    return null;
  }

  const bankName = resolveBankName(row, context);
  const records = readAllRecords();
  const existingIndex = records.findIndex(
    (record) =>
      record.companyId === companyId &&
      normalizeParserText(record.bankName || "") === normalizeParserText(bankName) &&
      record.normalizedDescription === normalizedDescription &&
      record.accountCode === accountCode
  );

  const payload = {
    id: existingIndex >= 0 ? records[existingIndex].id : buildRecordId(),
    companyId,
    bankName,
    normalizedDescription,
    accountCode,
    accountName,
    counterAccountCode: String(row.karsiHesapKodu || "").trim(),
    documentType: String(row.belgeTuru || "").trim().toUpperCase(),
    lastUsedAt: new Date().toISOString(),
    usageCount:
      existingIndex >= 0 ? Number(records[existingIndex].usageCount || 0) + 1 : 1,
  };

  if (existingIndex >= 0) {
    records[existingIndex] = payload;
  } else {
    records.unshift(payload);
  }

  writeAllRecords(records.slice(0, 5000));
  return payload;
}

export function findAccountMemoryMatch(row = {}, context = {}) {
  const companyId = resolveCompanyId(row, context);
  const rowDescription = getRowDescription(row);

  if (!companyId || !rowDescription) return null;

  const records = readAllRecords();
  let best = null;
  let bestScore = 0;

  for (const record of records) {
    if (!recordMatchesContext(record, row, context)) continue;

    const score = computeSimilarityScore(
      rowDescription,
      record.normalizedDescription || record.description || ""
    );

    if (score < 70) continue;

    const usageBoost = Math.min(5, Number(record.usageCount || 0));
    const adjustedScore = Math.min(100, score + (score < 100 ? usageBoost : 0));

    if (!best || adjustedScore > bestScore) {
      best = record;
      bestScore = adjustedScore;
    } else if (adjustedScore === bestScore) {
      const bestUsed = new Date(best.lastUsedAt || 0).getTime();
      const recordUsed = new Date(record.lastUsedAt || 0).getTime();
      if (recordUsed > bestUsed) {
        best = record;
      }
    }
  }

  if (!best) return null;

  return {
    record: best,
    confidence: bestScore,
    exactMatch: bestScore === 100,
  };
}

export function applyAccountMemoryV1ToRows(rows = [], context = {}) {
  if (!rows.length || !resolveCompanyId(rows[0], context)) return rows;

  return rows.map((row) => {
    const match = findAccountMemoryMatch(row, context);
    if (!match) return row;

    const { record, confidence } = match;
    const shouldFillAccount = !String(row.hesapKodu || "").trim();

    return finalizeStandardLucaRow({
      ...row,
      ...(shouldFillAccount
        ? {
            hesapKodu: record.accountCode || row.hesapKodu,
            hesapAdi: record.accountName || row.hesapAdi,
            karsiHesapKodu: record.counterAccountCode || row.karsiHesapKodu,
            belgeTuru: record.documentType || row.belgeTuru,
            accountMemoryAutoFilled: true,
          }
        : {}),
      hafizaGuvenSkoru: confidence,
      accountMemoryId: record.id,
    });
  });
}

export { buildExportWarningConfirmMessage } from "@/src/utils/previewExportValidation";
