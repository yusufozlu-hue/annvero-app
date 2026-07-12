/**
 * Öğrenen Hafıza V2 — firma bazlı muhasebe karar motoru.
 * analysisKey / parser / Luca üretimini değiştirmez; yalnızca karar uygular.
 */

import { normalizeParserText } from "@/src/utils/textNormalize";
import { finalizeStandardLucaRow } from "@/src/utils/standardLucaRow";
import {
  BANK_TRANSACTION_TYPE,
  CARI_REQUIRED_TYPES,
  CEK_TYPES,
  FINANCE_TYPES,
  isCariForbiddenForType,
  KASA_TYPES,
  PERSONEL_REQUIRED_TYPES,
  POS_TYPES,
  VERGI_SGK_TYPES,
  VIRMAN_TYPES,
} from "@/src/utils/bankTransactionType";

function isLikelyCariGlAccount(code = "") {
  return /^(120|320)(\.|$)/.test(String(code || "").trim());
}

export const ACCOUNT_MEMORY_V2_STORAGE_KEY = "annvero-account-memory-v2";
const V1_STORAGE_KEY = "annvero-account-memory-v1";
const MAX_RECORDS = 8000;

export const MEMORY_DECISION_TYPE = {
  CARI: "CARI",
  PERSONEL: "PERSONEL",
  POS_ACCOUNT: "POS_ACCOUNT",
  TAX_SGK_ACCOUNT: "TAX_SGK_ACCOUNT",
  FINANCE_ACCOUNT: "FINANCE_ACCOUNT",
  DIRECT_ACCOUNT: "DIRECT_ACCOUNT",
  REVIEW: "REVIEW",
};

export const MEMORY_MATCH_TIER = {
  ANALYSIS_KEY: "ANALYSIS_KEY",
  IBAN: "IBAN",
  TAX_NUMBER: "TAX_NUMBER",
  ALIAS: "ALIAS",
  NORMALIZED_DESCRIPTION: "NORMALIZED_DESCRIPTION",
  TYPE_TOKEN: "TYPE_TOKEN",
  FUZZY: "FUZZY",
  CONFLICT: "CONFLICT",
  NONE: "NONE",
};

/** Exact/güçlü otomatik uygulama eşiği */
export const MEMORY_AUTO_APPLY_MIN_CONFIDENCE = 90;
/** Fuzzy yalnızca öneri */
export const MEMORY_SUGGEST_MIN_CONFIDENCE = 70;
/** Düzeltme oranı yüksekse otomatik uygulama kapanır */
export const MEMORY_AUTO_DISABLE_CORRECTION_RATIO = 0.35;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function nowIso() {
  return new Date().toISOString();
}

function buildRecordId() {
  return `amv2-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeMemoryIban(value = "") {
  const match = String(value || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .match(/TR\d{24}/);
  return match ? match[0] : "";
}

export function normalizeMemoryTaxNumber(value = "") {
  return String(value || "").replace(/\D/g, "").trim();
}

function tokenize(text) {
  return normalizeParserText(text)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function readJsonArray(key) {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray(key, records) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(records.slice(0, MAX_RECORDS)));
}

export function inferMemoryDecisionType({
  transactionType = "",
  accountCode = "",
  cariId = "",
  personelId = "",
  decisionType = "",
} = {}) {
  const explicit = String(decisionType || "").trim().toUpperCase();
  if (Object.values(MEMORY_DECISION_TYPE).includes(explicit)) return explicit;

  const tt = String(transactionType || "").trim().toUpperCase();
  if (personelId || PERSONEL_REQUIRED_TYPES.has(tt)) {
    return MEMORY_DECISION_TYPE.PERSONEL;
  }
  if (POS_TYPES.has(tt)) return MEMORY_DECISION_TYPE.POS_ACCOUNT;
  if (CEK_TYPES.has(tt) || KASA_TYPES.has(tt) || VIRMAN_TYPES.has(tt)) {
    return MEMORY_DECISION_TYPE.DIRECT_ACCOUNT;
  }
  if (VERGI_SGK_TYPES.has(tt)) return MEMORY_DECISION_TYPE.TAX_SGK_ACCOUNT;
  if (FINANCE_TYPES.has(tt)) return MEMORY_DECISION_TYPE.FINANCE_ACCOUNT;
  if (
    cariId ||
    CARI_REQUIRED_TYPES.has(tt) ||
    isLikelyCariGlAccount(accountCode)
  ) {
    return MEMORY_DECISION_TYPE.CARI;
  }
  if (String(accountCode || "").trim()) return MEMORY_DECISION_TYPE.DIRECT_ACCOUNT;
  return MEMORY_DECISION_TYPE.REVIEW;
}

function migrateV1Record(record = {}) {
  const accountCode = String(record.accountCode || "").trim();
  const transactionType = String(record.transactionType || "").trim();
  const decisionType = inferMemoryDecisionType({
    transactionType,
    accountCode,
    cariId: record.cariId,
    personelId: record.personelId,
  });
  const createdAt = record.createdAt || record.lastUsedAt || nowIso();
  return {
    id: record.id || buildRecordId(),
    companyId: String(record.companyId || "").trim(),
    bankId: String(record.bankId || record.bankName || "").trim(),
    bankName: String(record.bankName || "").trim(),
    analysisKey: String(record.analysisKey || "").trim(),
    normalizedDescription: String(
      record.normalizedDescription || record.description || ""
    ).trim(),
    direction: String(record.direction || "").trim().toUpperCase(),
    transactionType,
    accountingScenario: String(record.accountingScenario || "").trim(),
    iban: normalizeMemoryIban(record.iban || ""),
    taxNumber: normalizeMemoryTaxNumber(record.taxNumber || record.vkn || ""),
    counterpartyName: String(
      record.counterpartyName || record.cariName || record.accountName || ""
    ).trim(),
    counterpartyAlias: String(record.counterpartyAlias || "").trim(),
    decisionType,
    accountCode,
    accountName: String(record.accountName || record.cariName || "").trim(),
    cariId: String(record.cariId || "").trim(),
    personelId: String(record.personelId || "").trim(),
    documentType: String(
      record.documentType || record.belgeTuru || ""
    )
      .trim()
      .toUpperCase(),
    finalDescriptionTemplate: String(
      record.finalDescriptionTemplate ||
        record.descriptionTemplate ||
        record.normalizedDescription ||
        ""
    ).trim(),
    confidence: Number(record.confidence || 100),
    amountMin:
      record.amountMin == null || record.amountMin === ""
        ? null
        : Number(record.amountMin),
    amountMax:
      record.amountMax == null || record.amountMax === ""
        ? null
        : Number(record.amountMax),
    source: String(record.source || "v1-migrate").trim(),
    usageCount: Number(record.usageCount || 0),
    successCount: Number(record.successCount || record.usageCount || 0),
    correctionCount: Number(record.correctionCount || 0),
    lastUsedAt: record.lastUsedAt || createdAt,
    createdAt,
    updatedAt: record.updatedAt || createdAt,
    isActive: record.isActive !== false,
    schemaVersion: 2,
  };
}

export function normalizeAccountMemoryV2Record(record = {}) {
  return migrateV1Record(record);
}

function mergeUniqueById(primary = [], secondary = []) {
  const map = new Map();
  for (const item of [...secondary, ...primary]) {
    const normalized = normalizeAccountMemoryV2Record(item);
    if (!normalized.companyId || !normalized.accountCode) continue;
    map.set(normalized.id, normalized);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0)
  );
}

export function loadAccountMemoryV2Records() {
  const v2 = readJsonArray(ACCOUNT_MEMORY_V2_STORAGE_KEY).map(
    normalizeAccountMemoryV2Record
  );
  const v1 = readJsonArray(V1_STORAGE_KEY).map(migrateV1Record);
  const merged = v1.length ? mergeUniqueById(v2, v1) : v2;
  const migration = migrateAccountMemoryV2InvertedDirections(merged);
  // migrate zaten direction fix'te yazar; yalnız V1 taşıması kaldıysa yaz
  if (v1.length && migration.migratedCount === 0) {
    persistAccountMemoryV2Records(migration.records);
  }
  return migration.records;
}

export function persistAccountMemoryV2Records(records = []) {
  writeJsonArray(
    ACCOUNT_MEMORY_V2_STORAGE_KEY,
    records.map(normalizeAccountMemoryV2Record)
  );
}

export function createEmptyMemoryTelemetry() {
  return {
    totalAnalysisGroups: 0,
    exactAnalysisKeyHit: 0,
    ibanHit: 0,
    taxNumberHit: 0,
    aliasHit: 0,
    normalizedDescriptionHit: 0,
    typeTokenHit: 0,
    fuzzySuggestion: 0,
    autoResolved: 0,
    pendingReview: 0,
    corrections: 0,
    conflicts: 0,
    memoryApplyMs: 0,
  };
}

/** analysisKey son bileşeni: `metin|GIRIS` / `metin|CIKIS` */
export function extractDirectionFromAnalysisKey(analysisKey = "") {
  const parts = String(analysisKey || "").split("|");
  const last = String(parts[parts.length - 1] || "")
    .trim()
    .toUpperCase();
  return last === "GIRIS" || last === "CIKIS" ? last : "";
}

export function normalizeMemoryDirection(value = "") {
  const text = String(value || "")
    .trim()
    .toUpperCase();
  if (text === "CIKIS" || text === "ÇIKIŞ" || text === "OUT") return "CIKIS";
  if (text === "GIRIS" || text === "GİRİŞ" || text === "IN") return "GIRIS";
  return "";
}

/**
 * Karşı Luca bacağı borc/alacak yüzünden ters yazılmış direction kayıtlarını
 * analysisKey içindeki gerçek hareket yönüne çeker. Çakışmada birleştirmez.
 */
export function migrateAccountMemoryV2InvertedDirections(existingRecords = null) {
  const source = Array.isArray(existingRecords)
    ? existingRecords.map(normalizeAccountMemoryV2Record)
    : readJsonArray(ACCOUNT_MEMORY_V2_STORAGE_KEY)
        .map(normalizeAccountMemoryV2Record)
        .concat(readJsonArray(V1_STORAGE_KEY).map(migrateV1Record));

  const byId = new Map();
  for (const record of source) {
    if (!record.companyId || !record.accountCode) continue;
    byId.set(record.id, record);
  }
  let records = Array.from(byId.values());

  let migratedCount = 0;
  records = records.map((record) => {
    const keyDirection = extractDirectionFromAnalysisKey(record.analysisKey);
    if (!keyDirection) return record;
    const current = normalizeMemoryDirection(record.direction);
    if (current === keyDirection) return record;
    migratedCount += 1;
    return normalizeAccountMemoryV2Record({
      ...record,
      direction: keyDirection,
      updatedAt: nowIso(),
      source: String(record.source || "")
        .split("|")
        .filter((part) => part && part !== "dir-fix")
        .concat(["dir-fix"])
        .join("|"),
    });
  });

  const groups = new Map();
  for (const record of records) {
    if (record.isActive === false) continue;
    const key = [
      record.companyId,
      record.analysisKey,
      record.direction,
      record.transactionType || "",
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const conflicts = [];
  for (const [key, items] of groups.entries()) {
    const codes = new Set(
      items.map((item) => String(item.accountCode || "").trim()).filter(Boolean)
    );
    if (codes.size > 1) {
      conflicts.push({
        key,
        accountCodes: Array.from(codes),
        recordIds: items.map((item) => item.id),
        count: items.length,
      });
    }
  }

  if (migratedCount > 0) {
    persistAccountMemoryV2Records(records);
  }

  return {
    migratedCount,
    conflictCount: conflicts.length,
    conflicts,
    records,
  };
}

export function buildAccountMemoryV2Index(records = [], companyId = "") {
  const company = String(companyId || "").trim();
  const scoped = (records || []).filter(
    (record) =>
      record.isActive !== false &&
      (!company || record.companyId === company)
  );

  const byAnalysisKey = new Map();
  const byIban = new Map();
  const byTax = new Map();
  const byAlias = new Map();
  const byNormalized = new Map();

  const push = (map, key, record) => {
    const k = String(key || "").trim();
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(record);
  };

  for (const record of scoped) {
    push(byAnalysisKey, `${record.analysisKey}|${record.direction}|${record.transactionType}`, record);
    push(byAnalysisKey, `${record.analysisKey}|${record.direction}|`, record);
    push(byIban, record.iban, record);
    push(byTax, record.taxNumber, record);
    push(
      byAlias,
      normalizeParserText(record.counterpartyAlias || ""),
      record
    );
    push(
      byNormalized,
      `${normalizeParserText(record.normalizedDescription)}|${record.direction}`,
      record
    );
  }

  return { scoped, byAnalysisKey, byIban, byTax, byAlias, byNormalized };
}

function directionCompatible(recordDirection, rowDirection) {
  const left = String(recordDirection || "").trim().toUpperCase();
  const right = String(rowDirection || "").trim().toUpperCase();
  if (!left || !right) return true;
  return left === right;
}

function transactionTypeCompatible(recordType, rowType, { strict = true } = {}) {
  const left = String(recordType || "").trim().toUpperCase();
  const right = String(rowType || "").trim().toUpperCase();
  if (!left || !right) return !strict;
  if (left === right) return true;
  // POS tahsilat ↔ komisyon asla karışmasın
  if (POS_TYPES.has(left) || POS_TYPES.has(right)) return false;
  // SGK ↔ vergi karışmasın
  if (
    (left.includes("SGK") || right.includes("SGK")) &&
    (left.includes("VERGI") ||
      right.includes("VERGI") ||
      left === BANK_TRANSACTION_TYPE.KDV ||
      right === BANK_TRANSACTION_TYPE.KDV)
  ) {
    return false;
  }
  if (VERGI_SGK_TYPES.has(left) && VERGI_SGK_TYPES.has(right)) {
    if (left.includes("SGK") !== right.includes("SGK")) return false;
  }
  // Gelen / giden havale
  if (
    (left === BANK_TRANSACTION_TYPE.GELEN_HAVALE &&
      right === BANK_TRANSACTION_TYPE.GIDEN_HAVALE) ||
    (left === BANK_TRANSACTION_TYPE.GIDEN_HAVALE &&
      right === BANK_TRANSACTION_TYPE.GELEN_HAVALE)
  ) {
    return false;
  }
  return !strict;
}

function amountInRange(record, amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return true;
  if (record.amountMin != null && Number.isFinite(record.amountMin) && value < record.amountMin) {
    return false;
  }
  if (record.amountMax != null && Number.isFinite(record.amountMax) && value > record.amountMax) {
    return false;
  }
  return true;
}

function correctionRatio(record) {
  const usage = Math.max(1, Number(record.usageCount || 0));
  return Number(record.correctionCount || 0) / usage;
}

export function isMemoryRecordAutoEligible(record) {
  if (!record || record.isActive === false) return false;
  if (record.decisionType === MEMORY_DECISION_TYPE.REVIEW) return false;
  if (!String(record.accountCode || "").trim()) return false;
  if (correctionRatio(record) >= MEMORY_AUTO_DISABLE_CORRECTION_RATIO) return false;
  if (Number(record.confidence || 0) < MEMORY_AUTO_APPLY_MIN_CONFIDENCE) return false;
  return true;
}

function detectConflict(candidates = []) {
  if (candidates.length < 2) return null;
  const codes = new Set(
    candidates.map((item) => String(item.accountCode || "").trim()).filter(Boolean)
  );
  if (codes.size <= 1) return null;
  return {
    tier: MEMORY_MATCH_TIER.CONFLICT,
    candidates,
    accountCodes: Array.from(codes),
  };
}

function pickBestRecord(candidates = []) {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => {
    const conf = Number(b.confidence || 0) - Number(a.confidence || 0);
    if (conf) return conf;
    const usage = Number(b.usageCount || 0) - Number(a.usageCount || 0);
    if (usage) return usage;
    return new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0);
  })[0];
}

function filterSafeCandidates(candidates, query, { requireType = true } = {}) {
  return (candidates || []).filter((record) => {
    if (record.isActive === false) return false;
    if (query.companyId && record.companyId !== query.companyId) return false;
    if (!directionCompatible(record.direction, query.direction)) return false;
    if (
      !transactionTypeCompatible(record.transactionType, query.transactionType, {
        strict: requireType,
      })
    ) {
      return false;
    }
    if (!amountInRange(record, query.amount)) return false;
    return true;
  });
}

function computeFuzzyScore(leftText, rightText) {
  const left = normalizeParserText(leftText);
  const right = normalizeParserText(rightText);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) {
    const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    return Math.min(89, Math.max(72, Math.round(72 + ratio * 17)));
  }
  const leftTokens = new Set(tokenize(left));
  const rightTokens = tokenize(right);
  if (!leftTokens.size || !rightTokens.length) return 0;
  let overlap = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) overlap += 1;
  }
  if (overlap === 0) return 0;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return Math.min(88, Math.max(70, Math.round(70 + (overlap / union) * 18)));
}

/**
 * Karar önceliği:
 * 1 analysisKey 2 IBAN 3 VKN 4 alias 5 normalize+yön
 * 6 type+token 7+ üst katmanlar (kural/cari) bu modül dışında
 */
export function resolveAccountMemoryV2Decision(query = {}, indexOrRecords, options = {}) {
  const started = Date.now();
  const telemetry = options.telemetry || null;
  const companyId = String(query.companyId || query.firmaId || "").trim();
  const index =
    indexOrRecords && indexOrRecords.byAnalysisKey
      ? indexOrRecords
      : buildAccountMemoryV2Index(
          Array.isArray(indexOrRecords) ? indexOrRecords : [],
          companyId
        );

  const analysisKey = String(query.analysisKey || "").trim();
  const direction = String(query.direction || "").trim().toUpperCase();
  const transactionType = String(query.transactionType || "").trim().toUpperCase();
  const iban = normalizeMemoryIban(query.iban || "");
  const taxNumber = normalizeMemoryTaxNumber(query.taxNumber || query.vkn || "");
  const alias = normalizeParserText(query.counterpartyAlias || query.alias || "");
  const normalizedDescription = normalizeParserText(
    query.normalizedDescription || query.description || query.aciklama || ""
  );

  const baseQuery = {
    companyId,
    direction,
    transactionType,
    amount: query.amount,
  };

  const finish = (payload) => {
    if (telemetry) {
      telemetry.memoryApplyMs = (telemetry.memoryApplyMs || 0) + (Date.now() - started);
    }
    return payload;
  };

  const tryTier = (tier, candidates, confidence) => {
    const safe = filterSafeCandidates(candidates, baseQuery, {
      requireType: tier !== MEMORY_MATCH_TIER.ANALYSIS_KEY,
    });
    // analysisKey için de yön/type zorunlu
    const strictSafe =
      tier === MEMORY_MATCH_TIER.ANALYSIS_KEY
        ? filterSafeCandidates(candidates, baseQuery, { requireType: true })
        : safe;
    const list = strictSafe.length ? strictSafe : [];
    if (!list.length) return null;

    const conflict = detectConflict(list);
    if (conflict) {
      if (telemetry) telemetry.conflicts = (telemetry.conflicts || 0) + 1;
      return finish({
        mode: "conflict",
        tier: MEMORY_MATCH_TIER.CONFLICT,
        confidence: 0,
        autoApply: false,
        record: null,
        candidates: conflict.candidates,
        accountCodes: conflict.accountCodes,
        message:
          "Aynı analiz anahtarı için birden fazla aktif hafıza kararı var. Otomatik uygulanmadı.",
      });
    }

    const record = pickBestRecord(list);
    // CARI hafıza kaydı, cari gerektirmeyen tipte otomatik uygulanmaz
    if (
      record?.decisionType === MEMORY_DECISION_TYPE.CARI &&
      transactionType &&
      isCariForbiddenForType(transactionType)
    ) {
      if (telemetry) {
        telemetry.cariQuarantine = (telemetry.cariQuarantine || 0) + 1;
      }
      return finish({
        mode: "suggest",
        tier: MEMORY_MATCH_TIER.CONFLICT,
        confidence: Math.min(confidence, 69),
        autoApply: false,
        record,
        candidates: list,
        message:
          "Hafızadaki cari kararı bu işlem türü için otomatik uygulanmadı (çek/kasa/POS/finans).",
      });
    }

    const autoApply =
      options.allowAuto !== false &&
      confidence >= MEMORY_AUTO_APPLY_MIN_CONFIDENCE &&
      isMemoryRecordAutoEligible(record);

    if (telemetry) {
      const key =
        tier === MEMORY_MATCH_TIER.ANALYSIS_KEY
          ? "exactAnalysisKeyHit"
          : tier === MEMORY_MATCH_TIER.IBAN
            ? "ibanHit"
            : tier === MEMORY_MATCH_TIER.TAX_NUMBER
              ? "taxNumberHit"
              : tier === MEMORY_MATCH_TIER.ALIAS
                ? "aliasHit"
                : tier === MEMORY_MATCH_TIER.NORMALIZED_DESCRIPTION
                  ? "normalizedDescriptionHit"
                  : tier === MEMORY_MATCH_TIER.TYPE_TOKEN
                    ? "typeTokenHit"
                    : "fuzzySuggestion";
      telemetry[key] = (telemetry[key] || 0) + 1;
      if (autoApply) telemetry.autoResolved = (telemetry.autoResolved || 0) + 1;
      else if (confidence >= MEMORY_SUGGEST_MIN_CONFIDENCE) {
        telemetry.fuzzySuggestion = (telemetry.fuzzySuggestion || 0) + 1;
      }
    }

    return finish({
      mode: autoApply ? "auto" : "suggest",
      tier,
      confidence,
      autoApply,
      record,
      candidates: list,
    });
  };

  if (analysisKey) {
    const exact =
      index.byAnalysisKey.get(`${analysisKey}|${direction}|${transactionType}`) ||
      [];
    const loose = index.byAnalysisKey.get(`${analysisKey}|${direction}|`) || [];
    const hit = tryTier(
      MEMORY_MATCH_TIER.ANALYSIS_KEY,
      exact.length ? exact : loose,
      100
    );
    if (hit) return hit;
  }

  if (iban) {
    const hit = tryTier(MEMORY_MATCH_TIER.IBAN, index.byIban.get(iban) || [], 98);
    if (hit) return hit;
  }

  if (taxNumber && taxNumber.length >= 10) {
    const hit = tryTier(
      MEMORY_MATCH_TIER.TAX_NUMBER,
      index.byTax.get(taxNumber) || [],
      97
    );
    if (hit) return hit;
  }

  if (alias) {
    const hit = tryTier(MEMORY_MATCH_TIER.ALIAS, index.byAlias.get(alias) || [], 95);
    if (hit) return hit;
  }

  if (normalizedDescription && direction) {
    const hit = tryTier(
      MEMORY_MATCH_TIER.NORMALIZED_DESCRIPTION,
      index.byNormalized.get(`${normalizedDescription}|${direction}`) || [],
      94
    );
    if (hit) return hit;
  }

  // type + güçlü token (otomatik değil; yüksek skorlu öneri)
  if (transactionType && normalizedDescription) {
    const tokens = new Set(tokenize(normalizedDescription));
    const typeCandidates = index.scoped.filter((record) => {
      if (record.transactionType !== transactionType) return false;
      if (!directionCompatible(record.direction, direction)) return false;
      const recTokens = tokenize(record.normalizedDescription || record.counterpartyAlias);
      return recTokens.some((token) => tokens.has(token) && token.length >= 5);
    });
    if (typeCandidates.length) {
      const hit = tryTier(MEMORY_MATCH_TIER.TYPE_TOKEN, typeCandidates, 88);
      if (hit) {
        // type+token asla kör auto (eşik 90 altı)
        return finish({ ...hit, autoApply: false, mode: "suggest" });
      }
    }
  }

  // Fuzzy — yalnız öneri
  let best = null;
  let bestScore = 0;
  for (const record of index.scoped) {
    if (!directionCompatible(record.direction, direction)) continue;
    if (
      !transactionTypeCompatible(record.transactionType, transactionType, {
        strict: true,
      })
    ) {
      continue;
    }
    if (!amountInRange(record, query.amount)) continue;
    const score = computeFuzzyScore(
      normalizedDescription,
      record.normalizedDescription || record.finalDescriptionTemplate || ""
    );
    if (score < MEMORY_SUGGEST_MIN_CONFIDENCE) continue;
    if (score > bestScore) {
      best = record;
      bestScore = score;
    }
  }

  if (best) {
    if (telemetry) telemetry.fuzzySuggestion = (telemetry.fuzzySuggestion || 0) + 1;
    return finish({
      mode: "suggest",
      tier: MEMORY_MATCH_TIER.FUZZY,
      confidence: bestScore,
      autoApply: false,
      record: best,
      candidates: [best],
    });
  }

  if (telemetry) telemetry.pendingReview = (telemetry.pendingReview || 0) + 1;
  return finish({
    mode: "none",
    tier: MEMORY_MATCH_TIER.NONE,
    confidence: 0,
    autoApply: false,
    record: null,
    candidates: [],
  });
}

export function touchAccountMemoryV2Record(
  records = [],
  recordId,
  { success = true, correction = false } = {}
) {
  const id = String(recordId || "").trim();
  if (!id) return records;
  const next = records.map((record) => {
    if (record.id !== id) return record;
    return {
      ...record,
      usageCount: Number(record.usageCount || 0) + 1,
      successCount: Number(record.successCount || 0) + (success && !correction ? 1 : 0),
      correctionCount: Number(record.correctionCount || 0) + (correction ? 1 : 0),
      confidence: correction
        ? Math.max(50, Number(record.confidence || 100) - 8)
        : Math.min(100, Number(record.confidence || 100) + 1),
      lastUsedAt: nowIso(),
      updatedAt: nowIso(),
    };
  });
  return next;
}

export function saveAccountMemoryV2Decision(input = {}, context = {}) {
  const companyId = String(
    context.firmaId || context.companyId || input.companyId || ""
  ).trim();
  const accountCode = String(input.accountCode || input.hesapKodu || "").trim();
  const analysisKey = String(input.analysisKey || "").trim();
  const normalizedDescription = normalizeParserText(
    input.normalizedDescription ||
      input.detayAciklama ||
      input.fisAciklama ||
      input.aciklama ||
      ""
  );

  if (!companyId || !accountCode || (!analysisKey && !normalizedDescription)) {
    return null;
  }

  const direction = String(
    input.direction ||
      input.yon ||
      (Number(input.borc || 0) > 0
        ? "GIRIS"
        : Number(input.alacak || 0) > 0
          ? "CIKIS"
          : "") ||
      context.direction ||
      ""
  )
    .trim()
    .toUpperCase();
  const transactionType = String(
    input.transactionType || context.transactionType || ""
  )
    .trim()
    .toUpperCase();
  const bankName = String(
    context.kaynakAdi || context.bankName || input.bankName || ""
  ).trim();
  const bankId = String(input.bankId || context.bankId || bankName).trim();
  const decisionType = inferMemoryDecisionType({
    transactionType,
    accountCode,
    cariId: input.cariId,
    personelId: input.personelId,
    decisionType: input.decisionType,
  });

  const records = loadAccountMemoryV2Records();
  const existingIndex = records.findIndex((record) => {
    if (record.companyId !== companyId) return false;
    if (record.isActive === false) return false;
    if (analysisKey && record.analysisKey === analysisKey) {
      return (
        directionCompatible(record.direction, direction) &&
        transactionTypeCompatible(record.transactionType, transactionType, {
          strict: Boolean(transactionType && record.transactionType),
        })
      );
    }
    return (
      normalizeParserText(record.normalizedDescription) === normalizedDescription &&
      directionCompatible(record.direction, direction) &&
      record.transactionType === transactionType
    );
  });

  const previous = existingIndex >= 0 ? records[existingIndex] : null;
  const accountChanged =
    previous && String(previous.accountCode || "") !== accountCode;
  const createdAt = previous?.createdAt || nowIso();

  const payload = normalizeAccountMemoryV2Record({
    id: previous?.id || buildRecordId(),
    companyId,
    bankId,
    bankName,
    analysisKey,
    normalizedDescription,
    direction,
    transactionType,
    accountingScenario: String(
      input.accountingScenario || previous?.accountingScenario || ""
    ).trim(),
    iban:
      normalizeMemoryIban(input.iban || context.iban || "") ||
      normalizeMemoryIban(normalizedDescription),
    taxNumber: normalizeMemoryTaxNumber(input.taxNumber || input.vkn || ""),
    counterpartyName: String(
      input.counterpartyName || input.cariName || input.hesapAdi || ""
    ).trim(),
    counterpartyAlias: String(input.counterpartyAlias || input.alias || "").trim(),
    decisionType,
    accountCode,
    accountName: String(input.accountName || input.hesapAdi || "").trim(),
    cariId: String(input.cariId || (decisionType === MEMORY_DECISION_TYPE.CARI ? accountCode : "")).trim(),
    personelId: String(input.personelId || "").trim(),
    documentType: String(input.documentType || input.belgeTuru || "")
      .trim()
      .toUpperCase(),
    finalDescriptionTemplate: String(
      input.finalDescriptionTemplate ||
        input.descriptionTemplate ||
        input.fisAciklama ||
        input.detayAciklama ||
        normalizedDescription
    ).trim(),
    confidence: accountChanged
      ? 92
      : Math.max(90, Number(previous?.confidence || 100)),
    amountMin: input.amountMin ?? previous?.amountMin ?? null,
    amountMax: input.amountMax ?? previous?.amountMax ?? null,
    source: String(input.source || context.source || "user-learn").trim(),
    usageCount: Number(previous?.usageCount || 0) + 1,
    successCount: Number(previous?.successCount || 0) + (accountChanged ? 0 : 1),
    correctionCount: Number(previous?.correctionCount || 0) + (accountChanged ? 1 : 0),
    lastUsedAt: nowIso(),
    createdAt,
    updatedAt: nowIso(),
    isActive: true,
  });

  if (existingIndex >= 0) records[existingIndex] = payload;
  else records.unshift(payload);

  persistAccountMemoryV2Records(records);
  // V1 aynası — eski okuyucular için
  writeJsonArray(
    V1_STORAGE_KEY,
    records.map((record) => ({
      id: record.id,
      companyId: record.companyId,
      bankName: record.bankName,
      normalizedDescription: record.normalizedDescription,
      accountCode: record.accountCode,
      accountName: record.accountName,
      cariId: record.cariId,
      cariName: record.counterpartyName,
      counterAccountCode: "",
      documentType: record.documentType,
      belgeTuru: record.documentType,
      analysisKey: record.analysisKey,
      direction: record.direction,
      transactionType: record.transactionType,
      descriptionTemplate: record.finalDescriptionTemplate,
      iban: record.iban,
      lastUsedAt: record.lastUsedAt,
      usageCount: record.usageCount,
    }))
  );

  return payload;
}

export function applyAccountMemoryV2DecisionToMovement(movement, decision) {
  if (!decision?.record || !decision.autoApply) return movement;
  const record = decision.record;
  return {
    ...movement,
    counterAccountCode: record.accountCode || movement.counterAccountCode,
    counterAccountName: record.accountName || movement.counterAccountName,
    documentType: record.documentType || movement.documentType,
    matchedMemoryId: record.id,
    accountMemoryId: record.id,
    accountMemoryAutoFilled: true,
    memoryDecisionType: record.decisionType,
    memoryMatchTier: decision.tier,
    memoryMatchConfidence: decision.confidence,
    cariId: record.cariId || movement.cariId,
    personelId: record.personelId || movement.personelId,
    warning: [
      String(movement.warning || "")
        .replace(/Cari hesap bulunamadı[^.|]*/gi, "")
        .replace(/Hesap eşleşmesi bulunamadı/gi, "")
        .replace(/Kural bulunamadı/gi, "")
        .replace(/\s+\|\s+/g, " | ")
        .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
        .trim(),
      `Firma hafızası (${decision.tier})`,
    ]
      .filter(Boolean)
      .join(" | "),
  };
}

export function applyAccountMemoryV2RecordsToRows(
  rows = [],
  records = [],
  context = {},
  telemetry = null
) {
  if (!rows.length) return rows;
  const companyId = String(context.firmaId || context.companyId || "").trim();
  if (!companyId) return rows;

  const index = buildAccountMemoryV2Index(records, companyId);
  const touched = new Set();

  const nextRows = rows.map((row) => {
    if (String(row.hesapKodu || "").trim()) return row;

    const decision = resolveAccountMemoryV2Decision(
      {
        companyId,
        analysisKey: row.analysisKey,
        direction:
          row.direction ||
          (Number(row.borc || 0) > 0
            ? "GIRIS"
            : Number(row.alacak || 0) > 0
              ? "CIKIS"
              : ""),
        transactionType: row.transactionType,
        iban: row.iban,
        taxNumber: row.taxNumber || row.vkn,
        counterpartyAlias: row.counterpartyAlias || row.cariName,
        normalizedDescription:
          row.detayAciklama || row.fisAciklama || row.aciklama || "",
        amount: Math.abs(Number(row.borc || row.alacak || row.tutar || 0)),
      },
      index,
      { telemetry, allowAuto: true }
    );

    if (decision.mode === "conflict") {
      return finalizeStandardLucaRow({
        ...row,
        kontrolNotu: [
          String(row.kontrolNotu || "").trim(),
          decision.message,
        ]
          .filter(Boolean)
          .join(" | "),
        memoryConflict: true,
        memoryConflictCodes: decision.accountCodes,
      });
    }

    if (!decision.autoApply || !decision.record) {
      if (decision.mode === "suggest" && decision.record) {
        return finalizeStandardLucaRow({
          ...row,
          accountMemorySuggestion: {
            accountCode: decision.record.accountCode,
            confidence: decision.confidence,
            tier: decision.tier,
            recordId: decision.record.id,
          },
          hafizaGuvenSkoru: decision.confidence,
        });
      }
      return row;
    }

    touched.add(decision.record.id);
    const record = decision.record;
    return finalizeStandardLucaRow({
      ...row,
      hesapKodu: record.accountCode,
      hesapAdi: record.accountName || row.hesapAdi,
      belgeTuru: record.documentType || row.belgeTuru,
      accountMemoryAutoFilled: true,
      accountMemoryId: record.id,
      memoryDecisionType: record.decisionType,
      memoryMatchTier: decision.tier,
      hafizaGuvenSkoru: decision.confidence,
      transactionType: row.transactionType || record.transactionType || "",
      kontrolNotu: [
        String(row.kontrolNotu || "")
          .replace(/Hesap eşleşmesi bulunamadı/gi, "")
          .replace(/Kural bulunamadı/gi, "")
          .replace(/Cari hesap bulunamadı[^.|]*/gi, "")
          .replace(/\s+\|\s+/g, " | ")
          .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
          .trim(),
        `Firma hafızası (${decision.tier})`,
      ]
        .filter(Boolean)
        .join(" | "),
    });
  });

  if (touched.size) {
    let nextRecords = records;
    for (const id of touched) {
      nextRecords = touchAccountMemoryV2Record(nextRecords, id, { success: true });
    }
    persistAccountMemoryV2Records(nextRecords);
  }

  return nextRows;
}

export function findSimilarMemoryTargets(records = [], seedRow = {}, context = {}) {
  const companyId = String(context.firmaId || context.companyId || "").trim();
  const direction = String(
    seedRow.direction ||
      (Number(seedRow.borc || 0) > 0
        ? "GIRIS"
        : Number(seedRow.alacak || 0) > 0
          ? "CIKIS"
          : "")
  )
    .trim()
    .toUpperCase();
  const transactionType = String(seedRow.transactionType || "").trim().toUpperCase();
  const seedText = normalizeParserText(
    seedRow.detayAciklama || seedRow.fisAciklama || seedRow.aciklama || ""
  );

  return (records || []).filter((record) => {
    if (record.companyId !== companyId) return false;
    if (record.isActive === false) return false;
    if (!directionCompatible(record.direction, direction)) return false;
    if (
      !transactionTypeCompatible(record.transactionType, transactionType, {
        strict: true,
      })
    ) {
      return false;
    }
    const score = computeFuzzyScore(
      seedText,
      record.normalizedDescription || record.finalDescriptionTemplate || ""
    );
    return score >= 80;
  });
}

export function updateAccountMemoryV2Record(recordId, patch = {}) {
  const records = loadAccountMemoryV2Records();
  const index = records.findIndex((item) => item.id === recordId);
  if (index < 0) return null;
  const next = normalizeAccountMemoryV2Record({
    ...records[index],
    ...patch,
    id: records[index].id,
    updatedAt: nowIso(),
  });
  records[index] = next;
  persistAccountMemoryV2Records(records);
  return next;
}

export function deleteAccountMemoryV2Record(recordId, { soft = true } = {}) {
  const records = loadAccountMemoryV2Records();
  if (soft) {
    const next = records.map((record) =>
      record.id === recordId
        ? { ...record, isActive: false, updatedAt: nowIso() }
        : record
    );
    persistAccountMemoryV2Records(next);
    return true;
  }
  persistAccountMemoryV2Records(records.filter((record) => record.id !== recordId));
  return true;
}

export function mergeAccountMemoryV2Records(keepId, dropId) {
  const records = loadAccountMemoryV2Records();
  const keep = records.find((item) => item.id === keepId);
  const drop = records.find((item) => item.id === dropId);
  if (!keep || !drop) return null;

  const merged = normalizeAccountMemoryV2Record({
    ...keep,
    usageCount: Number(keep.usageCount || 0) + Number(drop.usageCount || 0),
    successCount: Number(keep.successCount || 0) + Number(drop.successCount || 0),
    correctionCount:
      Number(keep.correctionCount || 0) + Number(drop.correctionCount || 0),
    iban: keep.iban || drop.iban,
    taxNumber: keep.taxNumber || drop.taxNumber,
    counterpartyAlias: keep.counterpartyAlias || drop.counterpartyAlias,
    confidence: Math.max(Number(keep.confidence || 0), Number(drop.confidence || 0)),
    updatedAt: nowIso(),
    isActive: true,
  });

  const next = records
    .filter((item) => item.id !== dropId)
    .map((item) => (item.id === keepId ? merged : item));
  persistAccountMemoryV2Records(next);
  return merged;
}

export function filterAccountMemoryV2Rows(records = [], filters = {}) {
  const search = normalizeParserText(filters.search || "");
  return records.filter((record) => {
    if (filters.companyId && record.companyId !== filters.companyId) return false;
    if (filters.bankId) {
      const bank = normalizeParserText(filters.bankId);
      if (
        normalizeParserText(record.bankId) !== bank &&
        normalizeParserText(record.bankName) !== bank
      ) {
        return false;
      }
    }
    if (
      filters.transactionType &&
      filters.transactionType !== "TUMU" &&
      record.transactionType !== filters.transactionType
    ) {
      return false;
    }
    if (
      filters.decisionType &&
      filters.decisionType !== "TUMU" &&
      record.decisionType !== filters.decisionType
    ) {
      return false;
    }
    if (filters.activeOnly && record.isActive === false) return false;
    if (filters.inactiveOnly && record.isActive !== false) return false;
    if (!search) return true;
    const hay = normalizeParserText(
      [
        record.normalizedDescription,
        record.analysisKey,
        record.accountCode,
        record.counterpartyName,
        record.counterpartyAlias,
        record.iban,
        record.taxNumber,
      ].join(" ")
    );
    return hay.includes(search);
  });
}

export function formatMemoryDecisionReportText(report = {}) {
  if (!report) return "";
  return [
    `Analiz grubu: ${report.totalAnalysisGroups ?? "—"}`,
    `Exact analysisKey: ${report.exactAnalysisKeyHit || 0}`,
    `IBAN: ${report.ibanHit || 0}`,
    `VKN: ${report.taxNumberHit || 0}`,
    `Alias: ${report.aliasHit || 0}`,
    `Normalize açıklama: ${report.normalizedDescriptionHit || 0}`,
    `Type+token öneri: ${report.typeTokenHit || 0}`,
    `Fuzzy öneri: ${report.fuzzySuggestion || 0}`,
    `Hafızadan otomatik: ${report.autoResolved || 0}`,
    `İncelemede kalan: ${report.pendingReview || 0}`,
    `Çakışma: ${report.conflicts || 0}`,
    `Hafıza süresi: ${report.memoryApplyMs || 0} ms`,
  ].join("\n");
}

export function buildMemoryDecisionReport({
  telemetry = null,
  totalAnalysisGroups = 0,
  analysisMs = 0,
} = {}) {
  return {
    ...(telemetry || createEmptyMemoryTelemetry()),
    totalAnalysisGroups,
    analysisMs,
  };
}
