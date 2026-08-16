/**
 * Firma-scoped banka ekstresi format hafızası.
 *
 * Sözleşme:
 * - Server learning_memory = kalıcı / yetkili ana kaynak
 * - Client company-mapping bucket = yalnız hızlı cache/fallback
 * - Hassas ekstre içeriği (IBAN, tutar, açıklama, dosya adı) yazılmaz
 */

import { COMPANY_ACCOUNT_MAPPING_STORAGE_KEY } from "@/src/utils/companyAccountMappingMemory";
import {
  buildBankStatementSchemaFingerprint,
  buildFormatMemoryLookupKey,
} from "@/src/utils/bankStatementSchemaFingerprint";
import {
  canonicalizeBankId,
  toParserBankId,
} from "@/src/utils/bankIdentity";
import { BANK_EXCEL_DETECTOR_VERSION } from "@/src/utils/bankExcelAutoDetect";
import { buildSafeLearningMemoryPayload } from "@/src/utils/learningMemorySafePayload";

export const STATEMENT_FORMAT_DOCUMENT_TYPE = "BANK_STATEMENT_FORMAT";
export const STATEMENT_FORMAT_CONFIRMATION_SOURCE = Object.freeze({
  USER_CONFIRMED: "user_confirmed",
  COMPANY_ACCOUNT_MATCH: "company_account_match",
});

export const STATEMENT_FORMAT_PERSIST_WARNING =
  "Banka formatı onayı alındı; kalıcı öğrenme kaydı yazılamadı. Bu oturumda devam edilir, sonraki oturumda yeniden sorulabilir.";

/** Test enjeksiyonu — DB/localStorage yokken */
let testStore = null;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function nowIso() {
  return new Date().toISOString();
}

function readCompanyBucket(companyId) {
  const id = String(companyId || "").trim();
  if (!id) return null;
  if (testStore) {
    return testStore[id] || { mappings: [], statementFormats: [] };
  }
  if (!canUseStorage()) return { mappings: [], statementFormats: [] };
  try {
    const raw = window.localStorage.getItem(COMPANY_ACCOUNT_MAPPING_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    const bucket = all && typeof all === "object" ? all[id] : null;
    return bucket && typeof bucket === "object"
      ? bucket
      : { mappings: [], statementFormats: [] };
  } catch {
    return { mappings: [], statementFormats: [] };
  }
}

function writeCompanyBucket(companyId, bucket) {
  const id = String(companyId || "").trim();
  if (!id) return false;
  if (testStore) {
    testStore[id] = bucket;
    return true;
  }
  if (!canUseStorage()) return false;
  try {
    const raw = window.localStorage.getItem(COMPANY_ACCOUNT_MAPPING_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    const next = all && typeof all === "object" ? { ...all } : {};
    next[id] = bucket;
    window.localStorage.setItem(
      COMPANY_ACCOUNT_MAPPING_STORAGE_KEY,
      JSON.stringify(next)
    );
    return true;
  } catch {
    return false;
  }
}

export function __setStatementFormatMemoryStoreForTests(store = null) {
  testStore = store;
}

export function __resetStatementFormatMemoryStoreForTests() {
  testStore = null;
}

export function __clearLocalStatementFormatCacheForTests(companyId = "") {
  const id = String(companyId || "").trim();
  if (testStore) {
    if (!id) {
      testStore = {};
      return;
    }
    const bucket = testStore[id] || { mappings: [], statementFormats: [] };
    testStore[id] = { ...bucket, statementFormats: [] };
    return;
  }
  if (!canUseStorage() || !id) return;
  try {
    const bucket = readCompanyBucket(id) || { mappings: [], statementFormats: [] };
    writeCompanyBucket(id, { ...bucket, statementFormats: [] });
  } catch {
    /* ignore */
  }
}

export function normalizeStatementFormatMemoryRecord(record = {}) {
  const companyId = String(record.companyId || record.company_id || "").trim();
  const canonicalBankId = canonicalizeBankId(
    record.canonicalBankId || record.bank_name || record.bankName || ""
  );
  const parserBankId =
    toParserBankId(record.parserBankId || canonicalBankId) || null;
  const schemaFingerprint = String(
    record.schemaFingerprint || record.keyword || ""
  ).trim();
  const currency = String(record.currency || "TRY").trim().toUpperCase() || "TRY";
  const directionModel = String(record.directionModel || "unknown").trim() || "unknown";
  if (!companyId || !canonicalBankId || !schemaFingerprint) return null;

  const confidenceRaw = record.confidence ?? record.metaConfidence;
  const confidence =
    confidenceRaw == null || confidenceRaw === ""
      ? "HIGH"
      : String(confidenceRaw).trim().toUpperCase();

  return {
    id: record.id || record.serverId || null,
    companyId,
    canonicalBankId,
    parserBankId,
    schemaFingerprint,
    currency,
    directionModel,
    detectorVersion:
      String(record.detectorVersion || BANK_EXCEL_DETECTOR_VERSION).trim() ||
      BANK_EXCEL_DETECTOR_VERSION,
    confirmationSource:
      String(
        record.confirmationSource ||
          record.user_correction ||
          STATEMENT_FORMAT_CONFIRMATION_SOURCE.USER_CONFIRMED
      ).trim() || STATEMENT_FORMAT_CONFIRMATION_SOURCE.USER_CONFIRMED,
    confidence,
    createdBy: record.createdBy || record.created_by || null,
    serverPersisted: Boolean(record.serverPersisted ?? record.id),
    createdAt: record.createdAt || record.learned_at || nowIso(),
    updatedAt: record.updatedAt || nowIso(),
    lookupKey: buildFormatMemoryLookupKey({
      companyId,
      schemaFingerprint,
      currency,
      directionModel,
    }),
  };
}

/** Yalnız local cache — yetkili kaynak değildir. */
export function loadCompanyStatementFormatMemory(companyId) {
  const bucket = readCompanyBucket(companyId);
  return (bucket?.statementFormats || [])
    .map(normalizeStatementFormatMemoryRecord)
    .filter(Boolean);
}

/**
 * learning_memory satırlarından format kayıtlarını ayıkla (firma guard’lı).
 * Başka companyId satırları kesilir.
 */
export function extractStatementFormatMemoryFromLearning(records = [], companyId = "") {
  const id = String(companyId || "").trim();
  return (records || [])
    .filter((r) => {
      if (!r) return false;
      if (!id) return false;
      if (String(r.company_id || r.companyId || "").trim() !== id) return false;
      const doc = String(r.document_type || r.documentType || "").trim();
      return doc === STATEMENT_FORMAT_DOCUMENT_TYPE;
    })
    .map((r) => {
      let meta = {};
      try {
        meta = JSON.parse(String(r.clean_description || r.cleanDescription || "{}"));
      } catch {
        meta = {};
      }
      return normalizeStatementFormatMemoryRecord({
        id: r.id,
        companyId: r.company_id || r.companyId,
        canonicalBankId: r.bank_name || r.bankName || meta.canonicalBankId,
        parserBankId: meta.parserBankId,
        schemaFingerprint: r.keyword || meta.schemaFingerprint,
        currency: meta.currency,
        directionModel: meta.directionModel,
        detectorVersion: meta.detectorVersion,
        confirmationSource: r.user_correction || meta.confirmationSource,
        confidence: meta.confidence,
        createdBy: r.created_by || meta.createdBy,
        serverPersisted: true,
        createdAt: r.learned_at || r.created_at,
        updatedAt: r.updated_at || r.learned_at,
      });
    })
    .filter(Boolean);
}

/**
 * Server kayıtları yetkili; local yalnız server’da olmayan lookup için fallback.
 * Aynı lookupKey’de server kazanır.
 */
export function mergeStatementFormatMemorySources({
  companyId = "",
  serverRecords = [],
  localRecords = [],
} = {}) {
  const id = String(companyId || "").trim();
  if (!id) return [];
  const map = new Map();
  for (const raw of localRecords || []) {
    const n = normalizeStatementFormatMemoryRecord(raw);
    if (!n || n.companyId !== id) continue;
    map.set(n.lookupKey, { ...n, serverPersisted: Boolean(n.serverPersisted) });
  }
  for (const raw of serverRecords || []) {
    const n = normalizeStatementFormatMemoryRecord(raw);
    if (!n || n.companyId !== id) continue;
    map.set(n.lookupKey, { ...n, serverPersisted: true });
  }
  return Array.from(map.values());
}

/**
 * Server hydrate sonrası local cache’i yenile (cache only).
 */
export function syncLocalStatementFormatCacheFromServer(companyId, serverRecords = []) {
  const id = String(companyId || "").trim();
  if (!id) return [];
  const normalized = (serverRecords || [])
    .map(normalizeStatementFormatMemoryRecord)
    .filter((r) => r && r.companyId === id);
  const bucket = readCompanyBucket(id) || { mappings: [], statementFormats: [] };
  writeCompanyBucket(id, {
    ...bucket,
    statementFormats: normalized.slice(0, 200),
    updatedAt: nowIso(),
  });
  return normalized;
}

export function findConfirmedStatementFormatMemory({
  companyId = "",
  schemaFingerprint = "",
  currency = "TRY",
  directionModel = "unknown",
  records = null,
} = {}) {
  const id = String(companyId || "").trim();
  if (!id || !schemaFingerprint) return null;
  const list =
    records != null
      ? (records || []).map(normalizeStatementFormatMemoryRecord).filter(Boolean)
      : loadCompanyStatementFormatMemory(id);
  const key = buildFormatMemoryLookupKey({
    companyId: id,
    schemaFingerprint,
    currency,
    directionModel,
  });
  const hit = list.find((r) => r && r.companyId === id && r.lookupKey === key);
  return hit || null;
}

/** Local cache upsert — yetkili persist sayılmaz. */
export function saveCompanyStatementFormatMemory(input = {}) {
  const normalized = normalizeStatementFormatMemoryRecord({
    ...input,
    updatedAt: nowIso(),
    createdAt: input.createdAt || nowIso(),
  });
  if (!normalized) return null;

  const bucket = readCompanyBucket(normalized.companyId) || {
    mappings: [],
    statementFormats: [],
  };
  const formats = [...(bucket.statementFormats || [])]
    .map(normalizeStatementFormatMemoryRecord)
    .filter(Boolean);
  const idx = formats.findIndex((r) => r.lookupKey === normalized.lookupKey);
  if (idx >= 0) {
    formats[idx] = {
      ...formats[idx],
      ...normalized,
      createdAt: formats[idx].createdAt || normalized.createdAt,
      updatedAt: nowIso(),
    };
  } else {
    formats.unshift(normalized);
  }

  writeCompanyBucket(normalized.companyId, {
    ...bucket,
    statementFormats: formats.slice(0, 200),
    updatedAt: nowIso(),
  });
  return idx >= 0 ? formats[idx] : formats[0];
}

/** learning_memory API için güvenli payload (PII yok). */
export function buildStatementFormatLearningPayload(record = {}) {
  const normalized = normalizeStatementFormatMemoryRecord(record);
  if (!normalized) return null;
  return buildSafeLearningMemoryPayload({
    company_id: normalized.companyId,
    document_type: STATEMENT_FORMAT_DOCUMENT_TYPE,
    keyword: normalized.schemaFingerprint,
    bank_name: normalized.canonicalBankId,
    clean_description: JSON.stringify({
      canonicalBankId: normalized.canonicalBankId,
      parserBankId: normalized.parserBankId,
      schemaFingerprint: normalized.schemaFingerprint,
      detectorVersion: normalized.detectorVersion,
      confirmationSource: normalized.confirmationSource,
      currency: normalized.currency,
      directionModel: normalized.directionModel,
      confidence: normalized.confidence || "HIGH",
    }),
    user_correction: normalized.confirmationSource,
    learned_at: normalized.createdAt || nowIso(),
    status: "active",
    raw_description: STATEMENT_FORMAT_DOCUMENT_TYPE,
    transaction_type: "BANK_STATEMENT_FORMAT",
  });
}

function findExistingServerFormatRecord(existingRecords = [], memory) {
  if (!memory) return null;
  const fromExtract = extractStatementFormatMemoryFromLearning(
    existingRecords,
    memory.companyId
  );
  const hit = fromExtract.find((r) => r.lookupKey === memory.lookupKey);
  if (hit?.id) {
    return existingRecords.find((r) => String(r.id) === String(hit.id)) || null;
  }
  // Ham satır fallback
  return (
    (existingRecords || []).find((r) => {
      if (String(r.company_id || r.companyId || "").trim() !== memory.companyId) {
        return false;
      }
      if (String(r.document_type || "").trim() !== STATEMENT_FORMAT_DOCUMENT_TYPE) {
        return false;
      }
      return String(r.keyword || "").trim() === memory.schemaFingerprint;
    }) || null
  );
}

/**
 * Kullanıcı onayı: fingerprint + local cache (henüz yetkili persist değil).
 */
export function confirmStatementBankFormat({
  companyId = "",
  sheetRows = [],
  bankId = "",
  sheetName = "",
  currency = "TRY",
  confirmationSource = STATEMENT_FORMAT_CONFIRMATION_SOURCE.USER_CONFIRMED,
  detectorVersion = BANK_EXCEL_DETECTOR_VERSION,
  confidence = "HIGH",
} = {}) {
  const fingerprint = buildBankStatementSchemaFingerprint(sheetRows, {
    sheetName,
    currency,
  });
  const draft = {
    companyId,
    canonicalBankId: bankId,
    parserBankId: toParserBankId(bankId),
    schemaFingerprint: fingerprint.schemaFingerprint,
    currency: fingerprint.currency,
    directionModel: fingerprint.directionModel,
    detectorVersion,
    confirmationSource,
    confidence,
    serverPersisted: false,
  };
  const memory = saveCompanyStatementFormatMemory(draft);
  return {
    memory,
    fingerprint,
    learningPayload: memory ? buildStatementFormatLearningPayload(memory) : null,
  };
}

/**
 * Server-first persist. Local cache yalnız başarı sonrası / fallback olarak güncellenir.
 *
 * @param {object} options
 * @param {Function} [options.createRecord] async (payload) => { data, error }
 * @param {Function} [options.updateRecord] async (id, fields) => boolean | { data, error }
 * @param {object[]} [options.existingLearningRecords]
 */
export async function persistConfirmedStatementFormatMemory({
  companyId = "",
  sheetRows = [],
  bankId = "",
  sheetName = "",
  currency = "TRY",
  confirmationSource = STATEMENT_FORMAT_CONFIRMATION_SOURCE.USER_CONFIRMED,
  detectorVersion = BANK_EXCEL_DETECTOR_VERSION,
  confidence = "HIGH",
  existingLearningRecords = [],
  createRecord = null,
  updateRecord = null,
} = {}) {
  const confirmed = confirmStatementBankFormat({
    companyId,
    sheetRows,
    bankId,
    sheetName,
    currency,
    confirmationSource,
    detectorVersion,
    confidence,
  });

  if (!confirmed.memory || !confirmed.learningPayload) {
    return {
      ...confirmed,
      persisted: false,
      reused: false,
      serverWriteCount: 0,
      warning: STATEMENT_FORMAT_PERSIST_WARNING,
      serverRecord: null,
    };
  }

  const existing = findExistingServerFormatRecord(
    existingLearningRecords,
    confirmed.memory
  );

  let serverRecord = null;
  let reused = false;
  let serverWriteCount = 0;
  let error = null;

  try {
    if (existing?.id && typeof updateRecord === "function") {
      const ok = await updateRecord(existing.id, confirmed.learningPayload);
      const success = ok === true || (ok && ok.data && !ok.error);
      if (!success) {
        error =
          (ok && ok.error) ||
          "Mevcut format hafızası güncellenemedi.";
      } else {
        serverRecord =
          ok?.data ||
          ({ ...existing, ...confirmed.learningPayload, id: existing.id });
        reused = true;
        serverWriteCount = 1;
      }
    } else if (typeof createRecord === "function") {
      if (existing?.id) {
        // update yoksa aynı kayıt yeniden create edilmesin
        serverRecord = existing;
        reused = true;
        serverWriteCount = 0;
      } else {
        const result = await createRecord(confirmed.learningPayload);
        if (result?.error || !result?.data) {
          error = result?.error || "Format hafızası yazılamadı.";
        } else {
          serverRecord = result.data;
          serverWriteCount = 1;
        }
      }
    } else {
      error = "learning_memory yazıcı bağlı değil.";
    }
  } catch (err) {
    error = err?.message || String(err);
  }

  if (error || !serverRecord) {
    // Local cache oturum fallback olarak kalır; kalıcı öğrenme başarısız
    saveCompanyStatementFormatMemory({
      ...confirmed.memory,
      serverPersisted: false,
    });
    return {
      ...confirmed,
      memory: { ...confirmed.memory, serverPersisted: false },
      persisted: false,
      reused: false,
      serverWriteCount: 0,
      warning: STATEMENT_FORMAT_PERSIST_WARNING,
      error,
      serverRecord: null,
    };
  }

  const persistedMemory = normalizeStatementFormatMemoryRecord({
    ...confirmed.memory,
    id: serverRecord.id,
    serverPersisted: true,
    createdBy: serverRecord.created_by || null,
  });
  saveCompanyStatementFormatMemory(persistedMemory);

  return {
    ...confirmed,
    memory: persistedMemory,
    persisted: true,
    reused,
    serverWriteCount,
    warning: null,
    error: null,
    serverRecord,
  };
}
