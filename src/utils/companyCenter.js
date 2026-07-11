import { getCompanyDisplayName } from "@/src/utils/companies";
import { normalizeCompany } from "@/src/utils/companyNormalize";

export const ACCOUNT_PLAN_STORAGE_KEY = "annvero_account_plans_v1";
export const LEGACY_ACCOUNT_PLAN_STORAGE_KEY = "annvero_hesap_planlari_v1";
export const RULE_ENGINE_STORAGE_KEY = "annvero_rule_engine_v1";
export const PENDING_LUCA_ROWS_STORAGE_KEY = "annvero_pending_luca_rows_v1";
export const LUCA_TRANSFER_SCHEMA_VERSION = 2;
export const LUCA_TRANSFER_IDB_NAME = "annvero_luca_transfer_v1";
export const LUCA_TRANSFER_IDB_STORE = "datasets";
export const LUCA_TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;
export const LUCA_TRANSFER_MAX_PER_SOURCE_COMPANY = 3;

function normalizeLucaTransferSource(source) {
  const value = String(source || "")
    .trim()
    .toLowerCase();
  if (value === "bank" || value === "banka") return "bank";
  if (value === "elektraweb" || value === "elektra") return "elektraweb";
  return "";
}

export function buildLucaTransferStorageKey(source, companyId, runId) {
  const src = normalizeLucaTransferSource(source);
  const company = String(companyId || "").trim() || "unknown";
  const run = String(runId || "").trim() || "latest";
  return `annvero:luca:${src}:${company}:${run}`;
}

export function buildLucaTransferPointerKey(source, companyId) {
  const src = normalizeLucaTransferSource(source);
  const company = String(companyId || "").trim() || "unknown";
  return `annvero:luca:${src}:latest:${company}`;
}

function openLucaTransferDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb_unavailable"));
      return;
    }

    const request = indexedDB.open(LUCA_TRANSFER_IDB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LUCA_TRANSFER_IDB_STORE)) {
        db.createObjectStore(LUCA_TRANSFER_IDB_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("indexeddb_open_failed"));
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("indexeddb_request_failed"));
  });
}

function resolveRunIdFromPointerValue(raw) {
  if (!raw) return "";
  const text = String(raw).trim();
  if (!text) return "";

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && parsed.runId) {
      return String(parsed.runId).trim();
    }
  } catch {
    // plain runId string (backward compat)
  }

  return text;
}

function validateLucaTransferDataset(parsed, src, company) {
  if (!parsed || !Array.isArray(parsed.rows) || !parsed.rows.length) return null;
  if (Number(parsed.schemaVersion) !== LUCA_TRANSFER_SCHEMA_VERSION) return null;
  if (normalizeLucaTransferSource(parsed.source || parsed.kaynakTipi) !== src) {
    return null;
  }
  if (String(parsed.companyId || parsed.firmaId || "") !== company) {
    return null;
  }
  return parsed;
}

function createdAtMs(entry) {
  const fromCreated = Date.parse(entry?.createdAt || "");
  if (!Number.isNaN(fromCreated)) return fromCreated;
  const savedAt = Number(entry?.savedAt);
  return Number.isFinite(savedAt) ? savedAt : 0;
}

async function cleanupLucaTransferIdb(db, source, companyId) {
  const tx = db.transaction(LUCA_TRANSFER_IDB_STORE, "readwrite");
  const store = tx.objectStore(LUCA_TRANSFER_IDB_STORE);
  const all = (await idbRequest(store.getAll())) || [];
  const same = all.filter(
    (entry) =>
      normalizeLucaTransferSource(entry?.source) === source &&
      String(entry?.companyId || entry?.firmaId || "") === companyId
  );

  same.sort((a, b) => createdAtMs(b) - createdAtMs(a));

  const now = Date.now();
  const keepKeys = new Set();

  for (const entry of same) {
    const age = now - (Number(entry.savedAt) || createdAtMs(entry));
    if (age > LUCA_TRANSFER_TTL_MS) continue;
    if (keepKeys.size >= LUCA_TRANSFER_MAX_PER_SOURCE_COMPANY) continue;
    if (entry?.key) keepKeys.add(entry.key);
  }

  for (const entry of same) {
    if (entry?.key && !keepKeys.has(entry.key)) {
      store.delete(entry.key);
    }
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("indexeddb_cleanup_failed"));
    tx.onabort = () => reject(tx.error || new Error("indexeddb_cleanup_aborted"));
  });
}

function cleanupLegacyLucaTransferLocalStorage() {
  if (typeof localStorage === "undefined") return;

  const keysToRemove = [];

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (
      !key.startsWith("annvero:luca:bank:") &&
      !key.startsWith("annvero:luca:elektraweb:")
    ) {
      continue;
    }
    // Pointer keys: annvero:luca:{source}:latest:{company}
    if (key.includes(":latest:")) continue;

    const raw = localStorage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.rows)
      ) {
        keysToRemove.push(key);
      }
    } catch {
      // ignore non-JSON leftovers
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

/**
 * Kaynak-izolasyonlu Luca aktarım kaydı (IndexedDB).
 * Banka ve Elektraweb aynı anahtarı paylaşmaz.
 * localStorage'da yalnızca küçük pointer tutulur.
 */
export async function saveLucaTransferDataset(payload = {}) {
  if (typeof window === "undefined") {
    return { ok: false, error: "window_unavailable" };
  }

  const source = normalizeLucaTransferSource(payload.source || payload.kaynakTipi);
  const companyId = String(payload.companyId || payload.firmaId || "").trim();
  const runId =
    String(payload.runId || payload.datasetId || "").trim() ||
    `${source}-${Date.now()}`;

  if (!source || !companyId) {
    return { ok: false, error: "missing_source_or_company" };
  }

  const dataset = {
    schemaVersion: LUCA_TRANSFER_SCHEMA_VERSION,
    datasetId: runId,
    runId,
    source,
    companyId,
    firmaId: companyId,
    companyName: payload.companyName || "",
    bankId: payload.bankId || "",
    bankName: payload.bankName || payload.kaynakAdi || "",
    kaynakTipi: source === "bank" ? "BANKA" : "ELEKTRAWEB",
    kaynakAdi:
      payload.kaynakAdi ||
      payload.bankName ||
      (source === "bank" ? "BANKA" : "ELEKTRAWEB"),
    createdAt: payload.createdAt || new Date().toISOString(),
    movementCount: Number(payload.movementCount) || 0,
    lucaRowCount: Array.isArray(payload.rows) ? payload.rows.length : 0,
    format: payload.format || "standard-luca-row-v1",
    rows: Array.isArray(payload.rows) ? payload.rows : [],
  };

  const key = buildLucaTransferStorageKey(source, companyId, runId);
  const pointerKey = buildLucaTransferPointerKey(source, companyId);
  const pointerMeta = {
    runId,
    companyId,
    source,
    rowCount: dataset.lucaRowCount,
    createdAt: dataset.createdAt,
    schemaVersion: LUCA_TRANSFER_SCHEMA_VERSION,
  };

  try {
    const db = await openLucaTransferDb();
    const tx = db.transaction(LUCA_TRANSFER_IDB_STORE, "readwrite");
    const store = tx.objectStore(LUCA_TRANSFER_IDB_STORE);
    store.put({ key, ...dataset, savedAt: Date.now() });

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("indexeddb_put_failed"));
      tx.onabort = () => reject(tx.error || new Error("indexeddb_put_aborted"));
    });

    localStorage.setItem(pointerKey, JSON.stringify(pointerMeta));

    try {
      await cleanupLucaTransferIdb(db, source, companyId);
    } catch (cleanupError) {
      console.warn("[luca-transfer] idb cleanup failed", cleanupError);
    }

    try {
      cleanupLegacyLucaTransferLocalStorage();
    } catch (legacyError) {
      console.warn("[luca-transfer] legacy localStorage cleanup failed", legacyError);
    }

    db.close();

    return {
      ok: true,
      key,
      runId,
      source,
      companyId,
      rowCount: dataset.lucaRowCount,
      storage: "indexeddb",
    };
  } catch (error) {
    console.error("[luca-transfer] save failed", error);
    return {
      ok: false,
      error: error?.name || "quota_or_write_error",
      message: error?.message || String(error),
    };
  }
}

export async function loadLucaTransferDataset({
  source,
  companyId,
  runId = "",
} = {}) {
  if (typeof window === "undefined") return null;

  const src = normalizeLucaTransferSource(source);
  const company = String(companyId || "").trim();
  if (!src || !company) return null;

  let resolvedRunId = String(runId || "").trim();
  if (!resolvedRunId) {
    resolvedRunId = resolveRunIdFromPointerValue(
      localStorage.getItem(buildLucaTransferPointerKey(src, company))
    );
  }
  if (!resolvedRunId) return null;

  const key = buildLucaTransferStorageKey(src, company, resolvedRunId);

  try {
    const db = await openLucaTransferDb();
    const tx = db.transaction(LUCA_TRANSFER_IDB_STORE, "readonly");
    const store = tx.objectStore(LUCA_TRANSFER_IDB_STORE);
    const record = await idbRequest(store.get(key));
    db.close();

    if (record) {
      const { key: _key, savedAt: _savedAt, ...dataset } = record;
      const validated = validateLucaTransferDataset(dataset, src, company);
      if (validated) return validated;
    }
  } catch (error) {
    console.warn("[luca-transfer] idb load failed, trying localStorage", error);
  }

  // Migration fallback: eski localStorage full-dataset anahtarı
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const validated = validateLucaTransferDataset(parsed, src, company);
    if (!validated) return null;

    try {
      const db = await openLucaTransferDb();
      const tx = db.transaction(LUCA_TRANSFER_IDB_STORE, "readwrite");
      const store = tx.objectStore(LUCA_TRANSFER_IDB_STORE);
      store.put({ key, ...validated, savedAt: Date.now() });
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error || new Error("indexeddb_migrate_failed"));
        tx.onabort = () =>
          reject(tx.error || new Error("indexeddb_migrate_aborted"));
      });
      db.close();
      localStorage.removeItem(key);
    } catch (migrateError) {
      console.warn("[luca-transfer] migrate to idb failed", migrateError);
    }

    return validated;
  } catch {
    return null;
  }
}

/** @deprecated Ortak anahtar — yalnızca geriye dönük okuma; yeni yazımlar saveLucaTransferDataset kullanır */
export function savePendingLucaRows(payload) {
  if (typeof window === "undefined") return;

  localStorage.setItem(PENDING_LUCA_ROWS_STORAGE_KEY, JSON.stringify(payload));
}

export function loadPendingLucaRows() {
  if (typeof window === "undefined") return null;

  const saved = localStorage.getItem(PENDING_LUCA_ROWS_STORAGE_KEY);

  if (!saved) return null;

  try {
    return JSON.parse(saved);
  } catch {
    return null;
  }
}

export const RULE_TAB_TO_STORAGE = {
  banka: "bankRules",
  fatura: "documentRules",
  vergi: "taxRules",
  hafiza: "learningRules",
};

export const RULE_STORAGE_TO_TAB = {
  bankRules: "banka",
  documentRules: "fatura",
  taxRules: "vergi",
  learningRules: "hafiza",
};

export function emptyUiCompanyRules() {
  return {
    banka: [],
    fatura: [],
    vergi: [],
    hafiza: [],
  };
}

export function normalizeCompanyRecord(company) {
  if (!company) return null;

  return normalizeCompany(company);
}

function compactHeader(value) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ş", "S")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C")
    .replace(/[^A-Z0-9]/g, "");
}

function pickAccountPlanField(row, ...keys) {
  if (!row || typeof row !== "object") return "";

  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }

  const wanted = keys.map(compactHeader);

  for (const [rawKey, value] of Object.entries(row)) {
    if (value === undefined || value === null || String(value).trim() === "") continue;

    if (wanted.includes(compactHeader(rawKey))) {
      return String(value).trim();
    }
  }

  return "";
}

function normalizeAccountPlanRow(row) {
  if (!row || typeof row !== "object") return null;

  const accountCode = pickAccountPlanField(
    row,
    "accountCode",
    "hesapKodu",
    "Hesap Kodu",
    "HesapKodu",
    "kod",
    "Kod",
    "code",
    "Code"
  );
  const accountName = pickAccountPlanField(
    row,
    "accountName",
    "hesapAdi",
    "Hesap Adı",
    "Hesap Adi",
    "HesapAdi",
    "açıklama",
    "aciklama",
    "Açıklama",
    "unvan",
    "Unvan",
    "name",
    "Name"
  );

  if (!accountCode || !accountName) return null;

  return {
    id: row.id || crypto.randomUUID(),
    accountCode,
    accountName,
    currency:
      pickAccountPlanField(row, "currency", "paraBirimi", "Para Birimi", "ParaBirimi") ||
      "TL",
    isActive: row.isActive ?? true,
  };
}

export function normalizeAccountPlanForMatching(accounts = []) {
  const normalized = [];

  for (const account of accounts || []) {
    const row = normalizeAccountPlanRow(account);
    if (row) normalized.push(row);
  }

  return normalized;
}

export function resolveAccountPlanStorageKey(accountPlans, companyOrId) {
  if (!accountPlans || typeof accountPlans !== "object") return null;

  const keys = Object.keys(accountPlans);
  const companyId =
    typeof companyOrId === "string" ? companyOrId : companyOrId?.id;
  const companyName =
    typeof companyOrId === "object" && companyOrId
      ? getCompanyDisplayName(companyOrId)
      : typeof companyOrId === "string"
        ? companyOrId
        : "";

  if (companyId && accountPlans[companyId]) return companyId;

  if (companyName && accountPlans[companyName]) return companyName;

  if (companyName) {
    const normalizedName = companyName.toLocaleLowerCase("tr");
    const byName = keys.find(
      (key) => key.toLocaleLowerCase("tr") === normalizedName
    );
    if (byName) return byName;
  }

  if (companyId) {
    const byId = keys.find((key) => key === companyId);
    if (byId) return byId;
  }

  return null;
}

function extractAccountRows(entry) {
  if (Array.isArray(entry)) return entry;
  if (entry && typeof entry === "object" && Array.isArray(entry.accounts)) {
    return entry.accounts;
  }
  return [];
}

function extractUploadedAt(entry) {
  if (Array.isArray(entry)) {
    for (const row of entry) {
      if (row?.uploadedAt) return row.uploadedAt;
    }
    return null;
  }

  if (entry && typeof entry === "object") {
    if (entry.uploadedAt) return entry.uploadedAt;

    for (const row of entry.accounts || []) {
      if (row?.uploadedAt) return row.uploadedAt;
    }
  }

  return null;
}

export function normalizeAccountPlansFromStorage(raw) {
  if (!raw || typeof raw !== "object") return {};

  const normalized = {};

  for (const [key, value] of Object.entries(raw)) {
    const accounts = extractAccountRows(value)
      .map(normalizeAccountPlanRow)
      .filter(Boolean);

    normalized[key] = {
      uploadedAt: extractUploadedAt(value),
      accounts,
    };
  }

  return normalized;
}

export function loadAccountPlansFromStorage() {
  if (typeof window === "undefined") return {};

  for (const key of [ACCOUNT_PLAN_STORAGE_KEY, LEGACY_ACCOUNT_PLAN_STORAGE_KEY]) {
    const saved = localStorage.getItem(key);

    if (!saved) continue;

    try {
      const parsed = JSON.parse(saved);

      if (parsed && typeof parsed === "object") {
        return normalizeAccountPlansFromStorage(parsed);
      }
    } catch {
      continue;
    }
  }

  return {};
}

export function saveAccountPlansToStorage(accountPlans) {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    ACCOUNT_PLAN_STORAGE_KEY,
    JSON.stringify(normalizeAccountPlansFromStorage(accountPlans))
  );
}

export function normalizeUiCompanyRules(record) {
  if (!record || typeof record !== "object") {
    return emptyUiCompanyRules();
  }

  const normalized = {
    banka: record.bankRules || record.banka || [],
    fatura: record.documentRules || record.fatura || [],
    vergi: record.taxRules || record.vergi || [],
    hafiza: record.learningRules || record.hafiza || [],
  };

  if (record.updatedAt) {
    normalized.updatedAt = record.updatedAt;
  }

  return normalized;
}

export function serializeUiCompanyRules(uiRules) {
  const source = uiRules || emptyUiCompanyRules();

  const serialized = {
    bankRules: source.banka || [],
    documentRules: source.fatura || [],
    taxRules: source.vergi || [],
    learningRules: source.hafiza || [],
  };

  if (source.updatedAt) {
    serialized.updatedAt = source.updatedAt;
  }

  return serialized;
}

export function normalizeRuleEngineFromStorage(raw) {
  if (!raw || typeof raw !== "object") return {};

  const normalized = {};

  for (const [companyId, rules] of Object.entries(raw)) {
    normalized[companyId] = normalizeUiCompanyRules(rules);
  }

  return normalized;
}

export function serializeRuleEngineForStorage(uiEngine) {
  if (!uiEngine || typeof uiEngine !== "object") return {};

  const serialized = {};

  for (const [companyId, rules] of Object.entries(uiEngine)) {
    serialized[companyId] = serializeUiCompanyRules(rules);
  }

  return serialized;
}

export function loadRuleEngineFromStorage() {
  if (typeof window === "undefined") return {};

  const saved = localStorage.getItem(RULE_ENGINE_STORAGE_KEY);

  if (!saved) return {};

  try {
    const parsed = JSON.parse(saved);
    return normalizeRuleEngineFromStorage(parsed);
  } catch {
    return {};
  }
}

export function saveRuleEngineToStorage(uiEngine) {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    RULE_ENGINE_STORAGE_KEY,
    JSON.stringify(serializeRuleEngineForStorage(uiEngine))
  );
}

export function getAccountPlanForCompany(accountPlans, companyOrId) {
  const storageKey = resolveAccountPlanStorageKey(accountPlans, companyOrId);

  if (!storageKey) return [];

  return normalizeAccountPlanForMatching(extractAccountRows(accountPlans[storageKey]));
}

function normalizeEmbeddedAccountRow(row) {
  return normalizeAccountPlanRow(row);
}

/**
 * @param {{
 *   selectedCompany?: object | null,
 *   accountPlan?: Array<{ accountCode: string, accountName: string }>,
 *   storageKeys?: string[],
 *   matchedStorageKey?: string,
 * }} params
 */
export function logElektrawebAccountPlanDiagnostics({
  selectedCompany = null,
  accountPlan = [],
  storageKeys = [],
  matchedStorageKey = "",
}) {
  console.log("[elektraweb-debug] selectedCompany", selectedCompany);
  console.log("[elektraweb-debug] accountPlan.length", accountPlan.length);
  console.log("[elektraweb-debug] accountPlan.slice(0, 10)", accountPlan.slice(0, 10));
  console.log(
    "[elektraweb-debug] accountPlan columns",
    Object.keys(accountPlan[0] || {})
  );
  console.log("[elektraweb-debug] storageKeys", storageKeys);
  console.log("[elektraweb-debug] matchedStorageKey", matchedStorageKey || "(none)");

  if (accountPlan.length === 0) {
    console.warn(
      "[elektraweb-debug] accountPlan.length 0 — hesap planı firmaId/ad ile eşleşmiyor olabilir",
      {
        selectedCompanyId: selectedCompany?.id || "",
        selectedCompanyName: getCompanyDisplayName(selectedCompany),
        storageKeys,
      }
    );
  }
}

export function getCompanyAccountPlansWithDiagnostics(accountPlans, companyOrId) {
  const companyId =
    typeof companyOrId === "string" ? companyOrId : companyOrId?.id;
  const companyName =
    typeof companyOrId === "object" && companyOrId
      ? getCompanyDisplayName(companyOrId)
      : "";
  const storageKey = resolveAccountPlanStorageKey(accountPlans, companyOrId);
  const fromStorage = normalizeAccountPlanForMatching(
    extractAccountRows(storageKey ? accountPlans?.[storageKey] : [])
  );
  const merged = new Map();

  for (const account of fromStorage) {
    merged.set(account.accountCode, account);
  }

  const embeddedAccounts =
    typeof companyOrId === "object" && companyOrId
      ? companyOrId.accounts || companyOrId.accountPlan || []
      : [];

  for (const account of normalizeAccountPlanForMatching(embeddedAccounts)) {
    merged.set(account.accountCode, account);
  }

  const plans = [...merged.values()];
  let matchedBy = "none";

  if (plans.length > 0) {
    if (storageKey && companyId && storageKey === companyId) {
      matchedBy = "storage-id";
    } else if (storageKey && companyName && storageKey === companyName) {
      matchedBy = "storage-name";
    } else if (storageKey) {
      matchedBy = "storage-key";
    } else if (embeddedAccounts.length > 0) {
      matchedBy = "company-embedded";
    } else {
      matchedBy = "merged";
    }
  }

  const diagnostics = {
    companyId: companyId || "",
    companyName,
    storageKeys: Object.keys(accountPlans || {}),
    matchedStorageKey: storageKey || "",
    planRowCount: plans.length,
    matchedBy,
  };

  console.log("[elektraweb-account-plan] diagnostics", diagnostics);

  return { plans, diagnostics };
}

export function companyHasRules(ruleEngine, companyId) {
  return countCompanyRules(ruleEngine, companyId) > 0;
}

export function countCompanyRules(ruleEngine, companyId) {
  if (!companyId || !ruleEngine?.[companyId]) return 0;

  const companyRules = normalizeUiCompanyRules(ruleEngine[companyId]);

  return ["banka", "fatura", "vergi", "hafiza"].reduce(
    (total, key) => total + (companyRules[key]?.length || 0),
    0
  );
}

export function getCompanyRules(ruleEngine, companyId) {
  return normalizeUiCompanyRules(ruleEngine?.[companyId]);
}

export function getAccountPlanUploadedAt(accountPlans, companyOrId) {
  const storageKey = resolveAccountPlanStorageKey(accountPlans, companyOrId);
  if (!storageKey) return null;

  return extractUploadedAt(accountPlans?.[storageKey]);
}

export function setCompanyAccountPlan(accountPlans, companyId, accounts) {
  if (!companyId) return accountPlans;

  const normalizedAccounts = normalizeAccountPlanForMatching(accounts);

  return {
    ...accountPlans,
    [companyId]: {
      uploadedAt: Date.now(),
      accounts: normalizedAccounts,
    },
  };
}

export function updateCompanyAccounts(accountPlans, companyId, updater) {
  if (!companyId) return accountPlans;

  const current = getAccountPlanForCompany(accountPlans, companyId);
  const storageKey =
    resolveAccountPlanStorageKey(accountPlans, companyId) || companyId;

  return {
    ...accountPlans,
    [companyId]: {
      uploadedAt: getAccountPlanUploadedAt(accountPlans, storageKey),
      accounts: updater(current),
    },
  };
}

export function getCompanyRulesUpdatedAt(ruleEngine, companyId) {
  if (!companyId || !ruleEngine?.[companyId]) return null;

  return ruleEngine[companyId].updatedAt || null;
}

export function countPendingLucaRowsForCompany(companyId) {
  if (!companyId) return 0;

  const pending = loadPendingLucaRows();

  if (!pending) return 0;

  if (pending.companyId && pending.companyId !== companyId) return 0;

  return Array.isArray(pending.rows) ? pending.rows.length : 0;
}

export function formatDateTime(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

function compactAccount(value) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replace(/\s+/g, "");
}

export function resolve102BankAccount(
  bankAccounts = [],
  accountCode,
  lucaBankaHesabi = ""
) {
  const normalizedCode = compactAccount(accountCode);

  if (normalizedCode !== "102" && !normalizedCode.startsWith("102.")) {
    return accountCode;
  }

  const hint = lucaBankaHesabi || accountCode;
  const normalizedHint = compactAccount(hint);

  const matched = bankAccounts.find((bank) => {
    if (bank.isActive === false) return false;

    return (
      compactAccount(bank.lucaAccountCode) === normalizedHint ||
      compactAccount(bank.accountName) === normalizedHint ||
      compactAccount(bank.bankName) === normalizedHint
    );
  });

  if (matched?.lucaAccountCode) {
    return matched.lucaAccountCode;
  }

  const firstActiveBank = bankAccounts.find((bank) => bank.isActive !== false);

  if (normalizedCode === "102" && firstActiveBank?.lucaAccountCode) {
    return firstActiveBank.lucaAccountCode;
  }

  return lucaBankaHesabi || accountCode;
}
