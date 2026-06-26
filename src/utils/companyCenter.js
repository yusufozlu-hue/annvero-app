import { getCompanyDisplayName } from "@/src/utils/companies";
import { normalizeCompany } from "@/src/utils/companyNormalize";

export const ACCOUNT_PLAN_STORAGE_KEY = "annvero_account_plans_v1";
export const LEGACY_ACCOUNT_PLAN_STORAGE_KEY = "annvero_hesap_planlari_v1";
export const RULE_ENGINE_STORAGE_KEY = "annvero_rule_engine_v1";
export const PENDING_LUCA_ROWS_STORAGE_KEY = "annvero_pending_luca_rows_v1";

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

function normalizeAccountPlanRow(row) {
  if (!row || typeof row !== "object") return null;

  const accountCode = String(row.accountCode || row.hesapKodu || "").trim();
  const accountName = String(row.accountName || row.hesapAdi || "").trim();

  if (!accountCode || !accountName) return null;

  return {
    id: row.id || crypto.randomUUID(),
    accountCode,
    accountName,
    currency: String(row.currency || row.paraBirimi || "TL").trim() || "TL",
    isActive: row.isActive ?? true,
  };
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
  const companyId =
    typeof companyOrId === "string" ? companyOrId : companyOrId?.id;

  if (!companyId) return [];

  const byId = extractAccountRows(accountPlans?.[companyId]);

  if (byId.length > 0) return byId;

  if (typeof companyOrId === "object" && companyOrId) {
    const companyName = getCompanyDisplayName(companyOrId);
    return extractAccountRows(accountPlans?.[companyName]);
  }

  return byId;
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

export function getAccountPlanUploadedAt(accountPlans, companyId) {
  if (!companyId) return null;

  return extractUploadedAt(accountPlans?.[companyId]);
}

export function setCompanyAccountPlan(accountPlans, companyId, accounts) {
  if (!companyId) return accountPlans;

  return {
    ...accountPlans,
    [companyId]: {
      uploadedAt: Date.now(),
      accounts,
    },
  };
}

export function updateCompanyAccounts(accountPlans, companyId, updater) {
  if (!companyId) return accountPlans;

  const current = getAccountPlanForCompany(accountPlans, companyId);

  return {
    ...accountPlans,
    [companyId]: {
      uploadedAt: getAccountPlanUploadedAt(accountPlans, companyId),
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
