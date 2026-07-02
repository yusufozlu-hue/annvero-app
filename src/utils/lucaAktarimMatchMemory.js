import { normalizeParserText } from "@/src/utils/textNormalize";

const STORAGE_KEY = "annvero-luca-aktarim-match-memory-v1";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
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
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 5000)));
}

function buildRecordId() {
  return `lam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDescription(value = "") {
  return normalizeParserText(value);
}

function normalizeAccount(value = "") {
  return normalizeParserText(value).replace(/\./g, "");
}

export function saveLucaAktarimManualMatch(annveroRow = {}, lucaRow = {}, context = {}) {
  const companyId = String(context.firmaId || context.companyId || "").trim();
  const annveroDescription = normalizeDescription(
    annveroRow.detayAciklama || annveroRow.fisAciklama || annveroRow.aciklama
  );
  const lucaDescription = normalizeDescription(
    lucaRow.detayAciklama || lucaRow.fisAciklama || lucaRow.aciklama
  );
  const amount = Number(annveroRow.tutar || annveroRow.borc || annveroRow.alacak || 0);
  const hesapKodu = normalizeAccount(annveroRow.hesapKodu || lucaRow.hesapKodu);

  if (!companyId || !annveroDescription || !lucaDescription || !hesapKodu || amount <= 0) {
    return null;
  }

  const records = readAllRecords();
  const existingIndex = records.findIndex(
    (record) =>
      record.companyId === companyId &&
      record.hesapKodu === hesapKodu &&
      record.annveroDescription === annveroDescription &&
      record.lucaDescription === lucaDescription &&
      Math.abs(Number(record.amount || 0) - amount) <= 0.01
  );

  const payload = {
    id: existingIndex >= 0 ? records[existingIndex].id : buildRecordId(),
    companyId,
    fisNo: String(annveroRow.fisNo || lucaRow.fisNo || "").trim(),
    hesapKodu,
    belgeTuru: String(annveroRow.belgeTuru || lucaRow.belgeTuru || "").trim(),
    annveroDescription,
    lucaDescription,
    amount,
    usageCount:
      existingIndex >= 0 ? Number(records[existingIndex].usageCount || 0) + 1 : 1,
    lastUsedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    records[existingIndex] = payload;
  } else {
    records.unshift(payload);
  }

  writeAllRecords(records);
  return payload;
}

export function getLucaAktarimMatchMemoryBoost(annveroRow = {}, lucaRow = {}, context = {}) {
  const companyId = String(context.firmaId || context.companyId || "").trim();
  if (!companyId) return 0;

  const annveroDescription = normalizeDescription(
    annveroRow.detayAciklama || annveroRow.fisAciklama || annveroRow.aciklama
  );
  const lucaDescription = normalizeDescription(
    lucaRow.detayAciklama || lucaRow.fisAciklama || lucaRow.aciklama
  );
  const hesapKodu = normalizeAccount(annveroRow.hesapKodu || lucaRow.hesapKodu);
  const amount = Number(annveroRow.tutar || annveroRow.borc || annveroRow.alacak || 0);

  if (!annveroDescription || !lucaDescription || !hesapKodu) return 0;

  let bestBoost = 0;

  for (const record of readAllRecords()) {
    if (record.companyId !== companyId) continue;

    const descMatch =
      record.annveroDescription === annveroDescription &&
      record.lucaDescription === lucaDescription;
    const accountMatch = record.hesapKodu === hesapKodu;
    const amountMatch = Math.abs(Number(record.amount || 0) - amount) <= 0.01;

    if (descMatch && accountMatch && amountMatch) {
      bestBoost = Math.max(bestBoost, 12 + Math.min(5, Number(record.usageCount || 0)));
    } else if (accountMatch && (descMatch || amountMatch)) {
      bestBoost = Math.max(bestBoost, 8);
    } else if (accountMatch || descMatch) {
      bestBoost = Math.max(bestBoost, 4);
    }
  }

  return Math.min(15, bestBoost);
}
