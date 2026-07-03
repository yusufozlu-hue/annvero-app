import { normalizeParserText } from "@/src/utils/textNormalize";

const STORAGE_KEY = "annvero-mutabakat-match-memory-v1";

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
  return `mm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeMutabakatDescription(value = "") {
  return normalizeParserText(value);
}

export function saveMutabakatManualMatch(bankRow = {}, muavinRow = {}, context = {}) {
  const companyId = String(context.firmaId || context.companyId || "").trim();
  const bankId = String(context.bankId || bankRow.banka || "").trim();
  const bankDescription = normalizeMutabakatDescription(bankRow.aciklama);
  const muavinDescription = normalizeMutabakatDescription(muavinRow.aciklama);
  const amount = Number(bankRow.tutar || bankRow.borc || bankRow.alacak || 0);

  if (!companyId || !bankDescription || !muavinDescription || amount <= 0) {
    return null;
  }

  const records = readAllRecords();
  const existingIndex = records.findIndex(
    (record) =>
      record.companyId === companyId &&
      record.bankId === bankId &&
      record.bankDescription === bankDescription &&
      record.muavinDescription === muavinDescription &&
      Math.abs(Number(record.amount || 0) - amount) <= 0.01
  );

  const payload = {
    id: existingIndex >= 0 ? records[existingIndex].id : buildRecordId(),
    companyId,
    bankId,
    bankDescription,
    muavinDescription,
    amount,
    direction: bankRow.yon || "",
    counterAccountCode: String(muavinRow.hesapKodu || "").trim(),
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

  if (typeof window !== "undefined") {
    import("@/src/utils/bankaMutabakatV2")
      .then(({ persistLearnedBankRule }) =>
        persistLearnedBankRule({
          companyId,
          bankId,
          bankDescriptionPattern: bankDescription,
          ledgerAccountCode: String(muavinRow.hesapKodu || "").trim(),
          ledgerAccountName: String(muavinRow.hesapAdi || "").trim(),
          transactionType: bankRow.yon || "",
          documentType: "manual_match",
        })
      )
      .catch(() => {});
  }

  return payload;
}

export function getMutabakatMatchMemoryBoost(bankRow = {}, muavinRow = {}, context = {}) {
  const companyId = String(context.firmaId || context.companyId || "").trim();
  if (!companyId) return 0;

  const bankDescription = normalizeMutabakatDescription(bankRow.aciklama);
  const muavinDescription = normalizeMutabakatDescription(muavinRow.aciklama);
  const bankAmount = Number(bankRow.tutar || bankRow.borc || bankRow.alacak || 0);
  const muavinAmount = Number(muavinRow.tutar || muavinRow.borc || muavinRow.alacak || 0);

  if (!bankDescription || !muavinDescription) return 0;

  let bestBoost = 0;

  for (const record of readAllRecords()) {
    if (record.companyId !== companyId) continue;

    const bankId = String(context.bankId || "").trim();
    if (record.bankId && bankId && record.bankId !== bankId) continue;

    const bankMatch =
      record.bankDescription === bankDescription ||
      bankDescription.includes(record.bankDescription) ||
      record.bankDescription.includes(bankDescription);
    const muavinMatch =
      record.muavinDescription === muavinDescription ||
      muavinDescription.includes(record.muavinDescription) ||
      record.muavinDescription.includes(muavinDescription);
    const amountMatch =
      Math.abs(Number(record.amount || 0) - bankAmount) <= 0.01 &&
      Math.abs(Number(record.amount || 0) - muavinAmount) <= 0.01;

    if (bankMatch && muavinMatch && amountMatch) {
      const usageBoost = Math.min(5, Number(record.usageCount || 0));
      bestBoost = Math.max(bestBoost, 12 + usageBoost);
    } else if (bankMatch && muavinMatch) {
      bestBoost = Math.max(bestBoost, 8);
    } else if (bankMatch || muavinMatch) {
      bestBoost = Math.max(bestBoost, 4);
    }
  }

  return Math.min(15, bestBoost);
}
