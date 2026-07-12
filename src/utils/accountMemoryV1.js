/**
 * accountMemoryV1 — V2 motoruna ince uyumluluk katmanı.
 * Eski import yolları kırılmasın; öğrenme/uygulama V2 şemasıyla çalışır.
 */

import {
  applyAccountMemoryV2RecordsToRows,
  loadAccountMemoryV2Records,
  resolveAccountMemoryV2Decision,
  saveAccountMemoryV2Decision,
  buildAccountMemoryV2Index,
  MEMORY_MATCH_TIER,
} from "@/src/utils/accountMemoryV2";
import { normalizeParserText } from "@/src/utils/textNormalize";

export function normalizeAccountMemoryDescription(row = {}) {
  return normalizeParserText(
    row.detayAciklama || row.fisAciklama || row.aciklama || ""
  );
}

export function loadAccountMemoryV1Records() {
  return loadAccountMemoryV2Records();
}

export function saveAccountMemoryFromEdit(row = {}, context = {}) {
  return saveAccountMemoryV2Decision(row, {
    ...context,
    source: context.source || "user-learn",
  });
}

export function findAccountMemoryByAnalysisKey(
  records = [],
  analysisKey = "",
  context = {},
  direction = ""
) {
  const decision = resolveAccountMemoryV2Decision(
    {
      companyId: context.firmaId || context.companyId,
      analysisKey,
      direction,
      transactionType: context.transactionType || "",
    },
    records,
    { allowAuto: true }
  );
  if (
    decision?.record &&
    (decision.tier === MEMORY_MATCH_TIER.ANALYSIS_KEY ||
      decision.mode === "auto" ||
      decision.mode === "suggest" ||
      decision.mode === "conflict")
  ) {
    if (decision.tier === MEMORY_MATCH_TIER.ANALYSIS_KEY) {
      return decision.mode === "conflict" ? null : decision.record;
    }
  }
  if (decision?.tier === MEMORY_MATCH_TIER.ANALYSIS_KEY && decision.record) {
    return decision.record;
  }
  // Doğrudan analysisKey tara
  const companyId = String(context.firmaId || context.companyId || "").trim();
  const key = String(analysisKey || "").trim();
  if (!key || !companyId) return null;
  let best = null;
  for (const record of records) {
    if (record.companyId !== companyId) continue;
    if (record.analysisKey !== key) continue;
    if (record.isActive === false) continue;
    if (direction && record.direction && record.direction !== direction) continue;
    if (
      !best ||
      new Date(record.lastUsedAt || 0) > new Date(best.lastUsedAt || 0)
    ) {
      best = record;
    }
  }
  return best;
}

export function findAccountMemoryByIban(records = [], iban = "", context = {}) {
  const decision = resolveAccountMemoryV2Decision(
    {
      companyId: context.firmaId || context.companyId,
      iban,
      direction: context.direction || "",
      transactionType: context.transactionType || "",
    },
    records,
    { allowAuto: true }
  );
  if (decision?.tier === MEMORY_MATCH_TIER.IBAN && decision.record) {
    return decision.record;
  }
  return null;
}

export function findAccountMemoryMatchInRecords(records = [], row = {}, context = {}) {
  const decision = resolveAccountMemoryV2Decision(
    {
      companyId: context.firmaId || context.companyId || row.firmaId,
      analysisKey: row.analysisKey,
      direction:
        row.direction ||
        row.yon ||
        (Number(row.borc || 0) > 0
          ? "GIRIS"
          : Number(row.alacak || 0) > 0
            ? "CIKIS"
            : ""),
      transactionType: row.transactionType || context.transactionType,
      iban: row.iban,
      taxNumber: row.taxNumber || row.vkn,
      counterpartyAlias: row.counterpartyAlias || row.alias,
      normalizedDescription:
        row.detayAciklama || row.fisAciklama || row.aciklama || "",
      amount: Math.abs(Number(row.borc || row.alacak || row.tutar || 0)),
    },
    records,
    { allowAuto: true }
  );

  if (!decision?.record || decision.mode === "none" || decision.mode === "conflict") {
    return null;
  }

  return {
    record: decision.record,
    confidence: decision.confidence,
    exactMatch: decision.confidence >= 94,
    tier: decision.tier,
    autoApply: decision.autoApply,
  };
}

export function findAccountMemoryMatch(row = {}, context = {}) {
  return findAccountMemoryMatchInRecords(loadAccountMemoryV2Records(), row, context);
}

export function applyAccountMemoryV1RecordsToRows(
  rows = [],
  records = [],
  context = {}
) {
  return applyAccountMemoryV2RecordsToRows(rows, records, context);
}

export function applyAccountMemoryV1ToRows(rows = [], context = {}) {
  return applyAccountMemoryV2RecordsToRows(
    rows,
    loadAccountMemoryV2Records(),
    context
  );
}

export { buildAccountMemoryV2Index };

export { buildExportWarningConfirmMessage } from "@/src/utils/previewExportValidation";
