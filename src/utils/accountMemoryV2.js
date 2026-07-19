/**
 * Öğrenen Hafıza V2 — firma bazlı muhasebe karar motoru.
 * analysisKey / parser / Luca üretimini değiştirmez; yalnızca karar uygular.
 */

import {
  normalizeBankAnalysisKey,
  normalizeParserText,
} from "@/src/utils/textNormalize";
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

/** Kullanıcı onaylı öğrenme kaynakları — yalnız bunlar supersede edebilir */
const USER_APPROVED_MEMORY_SOURCES = new Set([
  "cari-resolution-center",
  "group-learn",
  "row-learn",
  "user-learn",
  "similar-learn",
]);

/**
 * Güvenli leaf: 120/320 altı seçilebilir cari (parent 120 / 120.01 değil).
 * Genel last-wins değil; supersede önkoşulu.
 */
function isSafeUserApprovedCariLeafAccount(code = "") {
  const c = String(code || "").trim();
  if (!isLikelyCariGlAccount(c)) return false;
  if (/^(120|320)$/.test(c)) return false;
  const parts = c.split(".").filter(Boolean);
  // 120.01 / 320.01 tarzı ara parent
  if (parts.length < 3 && !/[A-Za-z]/.test(c)) return false;
  return true;
}

function recordCanonicalKey(record = {}) {
  return (
    String(record.canonicalAnalysisKey || "").trim() ||
    buildCariMemoryCanonicalKey(
      record.analysisKey || record.normalizedDescription,
      record.direction
    )
  );
}

function bankScopeCompatible(record, bankId, bankName) {
  const left = String(record?.bankId || record?.bankName || "")
    .trim()
    .toUpperCase();
  const right = String(bankId || bankName || "")
    .trim()
    .toUpperCase();
  if (!left || !right) return true;
  return left === right;
}

/**
 * Aynı company + bank + direction + cm:* canonical kapsamındaki
 * diğer aktif kayıtları pasifleştirir. Parent/mükerrer/genel last-wins yok.
 */
export function supersedeSameCanonicalScopeRecords(
  records = [],
  {
    keepId = "",
    companyId = "",
    direction = "",
    canonicalAnalysisKey = "",
    bankId = "",
    bankName = "",
    accountCode = "",
    source = "",
  } = {}
) {
  const src = String(source || "").trim();
  const canon = String(canonicalAnalysisKey || "").trim();
  const keep = String(keepId || "").trim();
  if (!USER_APPROVED_MEMORY_SOURCES.has(src)) {
    return { records, supersededCount: 0 };
  }
  if (!isSafeUserApprovedCariLeafAccount(accountCode)) {
    return { records, supersededCount: 0 };
  }
  // Yalnız kısa-kod canonical (cm:BILETDUK|GIRIS) — serbest metin last-wins değil
  if (!canon.startsWith("cm:")) {
    return { records, supersededCount: 0 };
  }
  if (!keep || !companyId) {
    return { records, supersededCount: 0 };
  }

  let supersededCount = 0;
  const next = (records || []).map((record) => {
    if (!record || String(record.id || "") === keep) return record;
    if (record.isActive === false) return record;
    if (String(record.companyId || "") !== companyId) return record;
    if (!directionCompatible(record.direction, direction)) return record;
    if (!bankScopeCompatible(record, bankId, bankName)) return record;
    if (recordCanonicalKey(record) !== canon) return record;
    supersededCount += 1;
    return {
      ...normalizeAccountMemoryV2Record(record),
      isActive: false,
      supersededBy: keep,
      supersedeReason: "user_approved_canonical_leaf",
      updatedAt: nowIso(),
    };
  });
  return { records: next, supersededCount };
}

/** Karşı taraf kısa kodları — uzun grup adı ile aynı canonical memory key */
const CARI_MEMORY_SHORT_CODES = [
  "BILETDUK",
  "BILETDUKKANI",
  "TTLKOM",
  "TTNET",
  "TURKCELL",
  "VODAFONE",
  "AYDEM",
  "BEDAS",
];

/**
 * Öğrenme yazma/okuma için kararlı, PII’siz karşı taraf anahtarı.
 * Parser/eşleştirme kurallarını değiştirmez; yalnız hafıza indeksine eklenir.
 */
export function buildCariMemoryCanonicalKey(descriptionOrKey = "", direction = "") {
  const raw = String(descriptionOrKey || "").trim();
  let dir = normalizeMemoryDirection(direction);
  let body = raw;
  const fromKey = extractDirectionFromAnalysisKey(raw);
  if (fromKey) {
    dir = dir || fromKey;
    const pipe = raw.lastIndexOf("|");
    body = pipe >= 0 ? raw.slice(0, pipe).trim() : raw;
  }
  dir = dir || "NA";
  const norm = normalizeParserText(body);
  if (!norm) return `|${dir}`;

  const tokens = norm.split(/\s+/).filter(Boolean);
  for (const code of CARI_MEMORY_SHORT_CODES) {
    const c = normalizeParserText(code);
    if (!c) continue;
    if (tokens.some((token) => token === c || token.startsWith(c))) {
      return `cm:${c}|${dir}`;
    }
  }
  if (
    tokens.includes("BILET") &&
    tokens.some((token) => token === "DUK" || token.startsWith("DUK"))
  ) {
    return `cm:BILETDUK|${dir}`;
  }

  return normalizeBankAnalysisKey(body, dir);
}

/** Raporlama için PII içermeyen parmak izi (yazma/okuma karşılaştırması) */
export function fingerprintCariMemoryKey(key = "") {
  const text = String(key || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp:${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
  if (!canUseStorage()) return false;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify(records.slice(0, MAX_RECORDS))
    );
    return true;
  } catch {
    return false;
  }
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
  const analysisKey = String(record.analysisKey || "").trim();
  const direction = String(record.direction || "").trim().toUpperCase();
  const normalizedDescription = String(
    record.normalizedDescription || record.description || ""
  ).trim();
  const canonicalAnalysisKey =
    String(record.canonicalAnalysisKey || "").trim() ||
    buildCariMemoryCanonicalKey(analysisKey || normalizedDescription, direction);
  return {
    id: record.id || buildRecordId(),
    companyId: String(record.companyId || "").trim(),
    bankId: String(record.bankId || record.bankName || "").trim(),
    bankName: String(record.bankName || "").trim(),
    analysisKey,
    canonicalAnalysisKey,
    normalizedDescription,
    direction,
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
    supersededBy: String(record.supersededBy || "").trim(),
    supersedeReason: String(record.supersedeReason || "").trim(),
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
  return writeJsonArray(
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

/** Test/perf: buildAccountMemoryV2Index çağrı sayısı (analiz başına 1 beklenir) */
let accountMemoryV2IndexBuildCount = 0;

export function getAccountMemoryV2IndexBuildCount() {
  return accountMemoryV2IndexBuildCount;
}

export function resetAccountMemoryV2IndexBuildCount() {
  accountMemoryV2IndexBuildCount = 0;
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
  accountMemoryV2IndexBuildCount += 1;
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
  const byTransactionType = new Map();
  const byToken = new Map();

  const push = (map, key, record) => {
    const k = String(key || "").trim();
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(record);
  };

  for (const record of scoped) {
    const canonical =
      String(record.canonicalAnalysisKey || "").trim() ||
      buildCariMemoryCanonicalKey(
        record.analysisKey || record.normalizedDescription,
        record.direction
      );
    const analysisKeys = new Set(
      [record.analysisKey, canonical].map((k) => String(k || "").trim()).filter(Boolean)
    );
    for (const analysisKey of analysisKeys) {
      push(
        byAnalysisKey,
        `${analysisKey}|${record.direction}|${record.transactionType}`,
        record
      );
      push(byAnalysisKey, `${analysisKey}|${record.direction}|`, record);
    }
    push(byIban, record.iban, record);
    push(byTax, record.taxNumber, record);
    push(
      byAlias,
      normalizeParserText(record.counterpartyAlias || ""),
      record
    );
    const normalizedDesc = normalizeParserText(record.normalizedDescription);
    push(byNormalized, `${normalizedDesc}|${record.direction}`, record);
    push(byTransactionType, String(record.transactionType || "").trim().toUpperCase(), record);
    const tokenSource = `${normalizedDesc} ${normalizeParserText(record.counterpartyAlias || "")} ${normalizeParserText(record.finalDescriptionTemplate || "")}`;
    for (const token of tokenize(tokenSource)) {
      push(byToken, token, record);
    }
  }

  return {
    scoped,
    byAnalysisKey,
    byIban,
    byTax,
    byAlias,
    byNormalized,
    byTransactionType,
    byToken,
  };
}

function collectFuzzyCandidateRecords(
  index,
  normalizedDescription = "",
  transactionType = "",
  direction = ""
) {
  const candidates = new Set();
  const typeKey = String(transactionType || "").trim().toUpperCase();

  if (typeKey && index.byTransactionType?.has(typeKey)) {
    for (const record of index.byTransactionType.get(typeKey) || []) {
      if (directionCompatible(record.direction, direction)) {
        candidates.add(record);
      }
    }
  }

  for (const token of tokenize(normalizedDescription)) {
    for (const record of index.byToken?.get(token) || []) {
      if (directionCompatible(record.direction, direction)) {
        candidates.add(record);
      }
    }
  }

  if (candidates.size === 0) {
    return index.scoped || [];
  }
  return [...candidates];
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

function dedupeMemoryRecordsById(candidates = []) {
  const byId = new Map();
  const withoutId = [];
  for (const record of candidates || []) {
    if (!record) continue;
    const id = String(record.id || "").trim();
    if (!id) {
      withoutId.push(record);
      continue;
    }
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, record);
      continue;
    }
    const prevAt = new Date(prev.updatedAt || prev.lastUsedAt || 0).getTime();
    const nextAt = new Date(record.updatedAt || record.lastUsedAt || 0).getTime();
    if (nextAt >= prevAt) byId.set(id, record);
  }
  return [...byId.values(), ...withoutId];
}

/**
 * Çakışmada önce exact analysisKey, sonra tek hesap koduna indir.
 * Aynı canonical altında farklı hesaplar hâlâ conflict kalır.
 */
function narrowConflictCandidates(
  candidates = [],
  { analysisKey = "", canonicalKey = "" } = {}
) {
  const unique = dedupeMemoryRecordsById(candidates);
  if (!detectConflict(unique)) return { list: unique, conflict: null };

  const key = String(analysisKey || "").trim();
  if (key) {
    const exact = unique.filter((record) => record.analysisKey === key);
    if (exact.length && !detectConflict(exact)) {
      return { list: exact, conflict: null };
    }
  }

  const canon = String(canonicalKey || "").trim();
  if (canon) {
    const byCanon = unique.filter((record) => {
      const recordCanon =
        String(record.canonicalAnalysisKey || "").trim() ||
        buildCariMemoryCanonicalKey(
          record.analysisKey || record.normalizedDescription,
          record.direction
        );
      return recordCanon === canon;
    });
    if (byCanon.length && !detectConflict(byCanon)) {
      return { list: byCanon, conflict: null };
    }
    if (key) {
      const exactCanon = byCanon.filter((record) => record.analysisKey === key);
      if (exactCanon.length && !detectConflict(exactCanon)) {
        return { list: exactCanon, conflict: null };
      }
    }
  }

  return { list: unique, conflict: detectConflict(unique) };
}

/** Pipeline gate: localStorage senkron hydrate; stale React state kullanılmaz. */
export function hydrateAccountMemoryForPipeline(companyId = "") {
  const records = loadAccountMemoryV2Records();
  const scopedCompanyId = String(companyId || "").trim();
  const index = buildAccountMemoryV2Index(records, scopedCompanyId);
  const activeCount = (index.scoped || []).filter(
    (record) => record.isActive !== false
  ).length;
  return {
    ready: true,
    records,
    index,
    companyId: scopedCompanyId,
    activeCount,
    loadedAt: Date.now(),
  };
}

/**
 * PII’siz lookup izi — yazma/okuma fingerprint + reject reason.
 */
export function traceAccountMemoryLookup(query = {}, indexOrRecords, options = {}) {
  const decision = resolveAccountMemoryV2Decision(query, indexOrRecords, options);
  const direction = String(query.direction || "").trim().toUpperCase();
  const analysisKey = String(query.analysisKey || "").trim();
  const canonicalKey = buildCariMemoryCanonicalKey(
    analysisKey || query.normalizedDescription || query.description || "",
    direction
  );
  const companyId = String(query.companyId || query.firmaId || "").trim();
  let rejectReason = "";
  if (decision.mode === "auto") rejectReason = "";
  else if (decision.mode === "conflict") {
    rejectReason = decision.message || "conflict_multiple_account_codes";
  } else if (decision.mode === "suggest") {
    rejectReason =
      decision.message ||
      (decision.autoApply === false ? "suggest_not_auto_eligible" : "suggest");
  } else if (decision.mode === "none") {
    rejectReason = "no_matching_memory_record";
  } else {
    rejectReason = `mode_${decision.mode || "unknown"}`;
  }
  if (
    !rejectReason &&
    decision.record &&
    !decision.autoApply &&
    !isMemoryRecordAutoEligible(decision.record)
  ) {
    rejectReason = "record_not_auto_eligible";
  }

  return {
    companyScopeFp: fingerprintCariMemoryKey(companyId || "NO_COMPANY"),
    storedCanonicalFp: decision.record
      ? fingerprintCariMemoryKey(
          decision.record.canonicalAnalysisKey ||
            buildCariMemoryCanonicalKey(
              decision.record.analysisKey ||
                decision.record.normalizedDescription,
              decision.record.direction
            )
        )
      : "",
    queryAnalysisFp: fingerprintCariMemoryKey(analysisKey),
    queryCanonicalFp: fingerprintCariMemoryKey(canonicalKey),
    direction,
    transactionType: String(query.transactionType || "").trim().toUpperCase(),
    mode: decision.mode,
    autoApply: Boolean(decision.autoApply),
    tier: decision.tier || "",
    rejectReason,
    accountCodeFp: decision.record
      ? fingerprintCariMemoryKey(decision.record.accountCode || "")
      : "",
    candidateCount: Array.isArray(decision.candidates)
      ? decision.candidates.length
      : 0,
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
    if (payload.rejectReason == null) {
      if (payload.mode === "auto") payload.rejectReason = "";
      else if (payload.mode === "conflict") {
        payload.rejectReason =
          payload.message || "conflict_multiple_account_codes";
      } else if (payload.mode === "suggest") {
        payload.rejectReason =
          payload.message || "suggest_not_auto_eligible";
      } else if (payload.mode === "none") {
        payload.rejectReason = "no_matching_memory_record";
      } else {
        payload.rejectReason = `mode_${payload.mode || "unknown"}`;
      }
    }
    return payload;
  };

  const queryCanonicalKey = buildCariMemoryCanonicalKey(
    analysisKey || normalizedDescription,
    direction
  );

  const tryTier = (tier, candidates, confidence) => {
    // ANALYSIS_KEY: yön zorunlu; type boş kayıtlar typed sorguyla da eşleşsin.
    const filtered = filterSafeCandidates(candidates, baseQuery, {
      requireType: tier !== MEMORY_MATCH_TIER.ANALYSIS_KEY,
    });
    if (!filtered.length) return null;

    const narrowed =
      tier === MEMORY_MATCH_TIER.ANALYSIS_KEY
        ? narrowConflictCandidates(filtered, {
            analysisKey,
            canonicalKey: queryCanonicalKey,
          })
        : {
            list: dedupeMemoryRecordsById(filtered),
            conflict: detectConflict(dedupeMemoryRecordsById(filtered)),
          };
    const list = narrowed.list;
    if (!list.length) return null;

    if (narrowed.conflict) {
      if (telemetry) telemetry.conflicts = (telemetry.conflicts || 0) + 1;
      return finish({
        mode: "conflict",
        tier: MEMORY_MATCH_TIER.CONFLICT,
        confidence: 0,
        autoApply: false,
        record: null,
        candidates: narrowed.conflict.candidates,
        accountCodes: narrowed.conflict.accountCodes,
        message:
          "Aynı analiz anahtarı için birden fazla aktif hafıza kararı var. Otomatik uygulanmadı.",
        rejectReason: "conflict_multiple_account_codes",
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
        rejectReason: "cari_forbidden_for_transaction_type",
      });
    }

    const eligible = isMemoryRecordAutoEligible(record);
    const autoApply =
      options.allowAuto !== false &&
      confidence >= MEMORY_AUTO_APPLY_MIN_CONFIDENCE &&
      eligible;

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
      rejectReason: autoApply
        ? ""
        : !eligible
          ? "record_not_auto_eligible"
          : options.allowAuto === false
            ? "allow_auto_disabled"
            : "confidence_below_auto_threshold",
    });
  };

  const tryAnalysisKeyLookup = (key) => {
    const k = String(key || "").trim();
    if (!k) return null;
    const exact =
      index.byAnalysisKey.get(`${k}|${direction}|${transactionType}`) || [];
    const loose = index.byAnalysisKey.get(`${k}|${direction}|`) || [];
    return tryTier(
      MEMORY_MATCH_TIER.ANALYSIS_KEY,
      exact.length ? exact : loose,
      100
    );
  };

  if (analysisKey) {
    const hit = tryAnalysisKeyLookup(analysisKey);
    if (hit) return hit;
  }

  if (queryCanonicalKey && queryCanonicalKey !== analysisKey) {
    const hit = tryAnalysisKeyLookup(queryCanonicalKey);
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
    const profile = globalThis.__ANNVERO_ANALYSIS_PROFILE__;
    const typeScanStarted = profile?.enabled ? performance.now() : 0;
    const typePool =
      index.byTransactionType?.get(transactionType) || index.scoped || [];
    const typeCandidates = typePool.filter((record) => {
      if (record.transactionType !== transactionType) return false;
      if (!directionCompatible(record.direction, direction)) return false;
      const recTokens = tokenize(record.normalizedDescription || record.counterpartyAlias);
      return recTokens.some((token) => tokens.has(token) && token.length >= 5);
    });
    if (profile?.enabled) {
      profile.typeTokenScopedScanCount += 1;
      profile.typeTokenScopedCandidateCount += typePool.length;
      const elapsed = performance.now() - typeScanStarted;
      profile.functionMs.typeTokenScopedFilter =
        (profile.functionMs.typeTokenScopedFilter || 0) + elapsed;
    }
    if (typeCandidates.length) {
      const hit = tryTier(MEMORY_MATCH_TIER.TYPE_TOKEN, typeCandidates, 88);
      if (hit) {
        // type+token asla kör auto (eşik 90 altı)
        return finish({ ...hit, autoApply: false, mode: "suggest" });
      }
    }
  }

  // Fuzzy — yalnız öneri (type/token aday daraltma; boşsa scoped full fallback)
  {
    const profile = globalThis.__ANNVERO_ANALYSIS_PROFILE__;
    const fuzzyStarted = profile?.enabled ? performance.now() : 0;
    const fuzzyPool = collectFuzzyCandidateRecords(
      index,
      normalizedDescription,
      transactionType,
      direction
    );
    if (profile?.enabled) {
      profile.fuzzyScanCount += 1;
      profile.fuzzyCandidateCount += fuzzyPool.length;
    }
    let best = null;
    let bestScore = 0;
    for (const record of fuzzyPool) {
      if (!directionCompatible(record.direction, direction)) continue;
      if (
        !transactionTypeCompatible(record.transactionType, transactionType, {
          strict: true,
        })
      ) {
        continue;
      }
      if (!amountInRange(record, query.amount)) continue;
      if (profile?.enabled) profile.fuzzyScoreCallCount += 1;
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
    if (profile?.enabled) {
      const elapsed = performance.now() - fuzzyStarted;
      profile.fuzzyTotalMs += elapsed;
      profile.functionMs.computeFuzzyScan =
        (profile.functionMs.computeFuzzyScan || 0) + elapsed;
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
  const canonicalAnalysisKey =
    String(input.canonicalAnalysisKey || "").trim() ||
    buildCariMemoryCanonicalKey(analysisKey || normalizedDescription, direction);
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
  const source = String(input.source || context.source || "user-learn").trim();
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
    if (canonicalAnalysisKey && recordCanonicalKey(record) === canonicalAnalysisKey) {
      return (
        directionCompatible(record.direction, direction) &&
        transactionTypeCompatible(record.transactionType, transactionType, {
          strict: Boolean(transactionType && record.transactionType),
        }) &&
        bankScopeCompatible(record, bankId, bankName)
      );
    }
    return (
      normalizeParserText(record.normalizedDescription) === normalizedDescription &&
      directionCompatible(record.direction, direction) &&
      record.transactionType === transactionType
    );
  });

  let previous = existingIndex >= 0 ? records[existingIndex] : null;
  let writeIndex = existingIndex;
  // Kullanıcı onaylı cm:* leaf: her zaman taze kayıt.
  // Exact-key upsert eski correctionRatio / çakışan kardeşleri canlıda autoApply=false bırakıyordu.
  if (
    USER_APPROVED_MEMORY_SOURCES.has(source) &&
    canonicalAnalysisKey.startsWith("cm:") &&
    isSafeUserApprovedCariLeafAccount(accountCode)
  ) {
    previous = null;
    writeIndex = -1;
  } else if (
    previous &&
    USER_APPROVED_MEMORY_SOURCES.has(source) &&
    analysisKey &&
    String(previous.analysisKey || "").trim() !== analysisKey &&
    recordCanonicalKey(previous) === canonicalAnalysisKey
  ) {
    // Non-cm canonical kardeş: yine taze yaz
    previous = null;
    writeIndex = -1;
  }

  const accountChanged =
    previous && String(previous.accountCode || "") !== accountCode;
  const createdAt = previous?.createdAt || nowIso();

  const payload = normalizeAccountMemoryV2Record({
    id: previous?.id || buildRecordId(),
    companyId,
    bankId,
    bankName,
    analysisKey,
    canonicalAnalysisKey,
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
    source,
    usageCount: Number(previous?.usageCount || 0) + 1,
    successCount: Number(previous?.successCount || 0) + (accountChanged ? 0 : 1),
    correctionCount: Number(previous?.correctionCount || 0) + (accountChanged ? 1 : 0),
    lastUsedAt: nowIso(),
    createdAt,
    updatedAt: nowIso(),
    isActive: true,
    supersededBy: "",
    supersedeReason: "",
  });

  if (writeIndex >= 0) records[writeIndex] = payload;
  else records.unshift(payload);

  const superseded = supersedeSameCanonicalScopeRecords(records, {
    keepId: payload.id,
    companyId,
    direction,
    canonicalAnalysisKey,
    bankId,
    bankName,
    accountCode,
    source,
  });
  const nextRecords = superseded.records;

  const persisted = persistAccountMemoryV2Records(nextRecords);
  if (!persisted) return null;

  // V1 aynası — eski okuyucular için
  const v1Ok = writeJsonArray(
    V1_STORAGE_KEY,
    nextRecords.map((record) => ({
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
      canonicalAnalysisKey: record.canonicalAnalysisKey,
      direction: record.direction,
      transactionType: record.transactionType,
      descriptionTemplate: record.finalDescriptionTemplate,
      iban: record.iban,
      lastUsedAt: record.lastUsedAt,
      usageCount: record.usageCount,
      isActive: record.isActive !== false,
      supersededBy: record.supersededBy || "",
    }))
  );
  if (!v1Ok) return null;

  return {
    ...payload,
    _supersededCount: superseded.supersededCount,
  };
}

/**
 * Çözüm Merkezi yeşil buton öğrenme zinciri:
 * save → persist → canonical active count → immediate read-back.
 * Workbench bunu çağırır; doğrudan save başarı sayılmaz.
 */
export function persistCariResolutionLearnWithReadback({
  seedRow = {},
  accountCode = "",
  learnContext = {},
  companyId = "",
  bankName = "",
  source = "cari-resolution-center",
} = {}) {
  const code = String(accountCode || "").trim();
  const firmaId = String(companyId || "").trim();
  const checkboxTrue = true;
  const shouldLearn = Boolean(learnContext?.ok && firmaId && code);
  const emptyTrace = {
    build: "",
    checkbox: checkboxTrue,
    shouldLearn,
    source,
    canonicalFp: "",
    accountFp: fingerprintCariMemoryKey(code),
    persisted: false,
    supersededCount: 0,
    activeCanonicalCountAfterSave: -1,
    immediateReadBack: { autoApply: false, rejectReason: "not_attempted" },
  };

  if (!shouldLearn) {
    return {
      learnOk: false,
      persisted: false,
      supersededCount: 0,
      activeCanonicalCountAfterSave: 0,
      saveTrace: {
        ...emptyTrace,
        immediateReadBack: {
          autoApply: false,
          rejectReason: !firmaId
            ? "missing_company"
            : !learnContext?.ok
              ? "learn_context_invalid"
              : "missing_account",
        },
      },
    };
  }

  const direction = String(learnContext.direction || "").trim().toUpperCase();
  const analysisKey = String(learnContext.analysisKey || "").trim();
  const description = String(learnContext.description || "").trim();
  const canonicalAnalysisKey = buildCariMemoryCanonicalKey(
    analysisKey || description,
    direction
  );

  const saved = saveAccountMemoryV2Decision(
    {
      ...seedRow,
      hesapKodu: code,
      accountCode: code,
      analysisKey,
      canonicalAnalysisKey,
      direction,
      transactionType:
        learnContext.transactionType || seedRow.transactionType || "",
      belgeTuru: seedRow.belgeTuru || "",
      documentType: seedRow.belgeTuru || "",
      cariId: code,
      normalizedDescription: description,
      finalDescriptionTemplate:
        description ||
        seedRow.detayAciklama ||
        seedRow.fisAciklama ||
        "",
      source,
    },
    { firmaId, kaynakAdi: bankName }
  );

  if (!saved) {
    return {
      learnOk: false,
      persisted: false,
      supersededCount: 0,
      activeCanonicalCountAfterSave: 0,
      saveTrace: {
        ...emptyTrace,
        canonicalFp: fingerprintCariMemoryKey(canonicalAnalysisKey),
        immediateReadBack: {
          autoApply: false,
          rejectReason: "save_returned_null",
        },
      },
    };
  }

  const after = loadAccountMemoryV2Records();
  const activeCanonical = after.filter(
    (record) =>
      record.isActive !== false &&
      String(record.companyId || "") === firmaId &&
      recordCanonicalKey(record) === canonicalAnalysisKey
  );
  const snap = hydrateAccountMemoryForPipeline(firmaId);
  const readBackDecision = resolveAccountMemoryV2Decision(
    {
      companyId: firmaId,
      analysisKey,
      direction,
      transactionType:
        learnContext.transactionType || seedRow.transactionType || "",
      normalizedDescription: description,
    },
    snap.index,
    { allowAuto: true }
  );
  const readBackTrace = traceAccountMemoryLookup(
    {
      companyId: firmaId,
      analysisKey,
      direction,
      transactionType:
        learnContext.transactionType || seedRow.transactionType || "",
      normalizedDescription: description,
    },
    snap.index,
    { allowAuto: true }
  );

  const learnOk =
    Boolean(readBackDecision.autoApply) &&
    String(readBackDecision.record?.accountCode || "").trim() === code &&
    activeCanonical.length === 1;

  return {
    learnOk,
    persisted: true,
    saved,
    supersededCount: Number(saved._supersededCount || 0),
    activeCanonicalCountAfterSave: activeCanonical.length,
    saveTrace: {
      checkbox: checkboxTrue,
      shouldLearn: true,
      source,
      canonicalFp: fingerprintCariMemoryKey(canonicalAnalysisKey),
      accountFp: fingerprintCariMemoryKey(code),
      persisted: true,
      supersededCount: Number(saved._supersededCount || 0),
      activeCanonicalCountAfterSave: activeCanonical.length,
      immediateReadBack: {
        autoApply: Boolean(readBackDecision.autoApply),
        rejectReason: readBackTrace.rejectReason || "",
        mode: readBackDecision.mode || "",
      },
    },
  };
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

    // Luca satırlarında direction genelde yok. borc/alacak ile çıkarmak YANLIŞ:
    // GİRİŞ hareketinin cari bacağı alacaklıdır → CIKIS sanılır, GIRIS hafızası kaçırılır.
    const direction =
      normalizeMemoryDirection(row.direction || row.yon || "") ||
      extractDirectionFromAnalysisKey(row.analysisKey) ||
      "";

    const decision = resolveAccountMemoryV2Decision(
      {
        companyId,
        analysisKey: row.analysisKey,
        direction,
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
