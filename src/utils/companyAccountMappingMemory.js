/**
 * Firma hesap eşleme hafızası — onaylanan eşlemeler kalıcı.
 * localStorage + company record.accountMappingResults ile çalışır.
 */

import {
  MAPPING_STATUS,
  bootstrapCompanyAccountMappings,
  applyMappingsToCompanyFields,
} from "@/src/utils/companyAccountAutoDetect";

export const COMPANY_ACCOUNT_MAPPING_STORAGE_KEY =
  "annvero-company-account-mappings-v1";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function nowIso() {
  return new Date().toISOString();
}

function readAll() {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(COMPANY_ACCOUNT_MAPPING_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(
    COMPANY_ACCOUNT_MAPPING_STORAGE_KEY,
    JSON.stringify(data)
  );
}

export function loadCompanyAccountMappings(companyId) {
  const id = String(companyId || "").trim();
  if (!id) return { mappings: [], summary: null, scannedAt: "" };
  const all = readAll();
  return all[id] || { mappings: [], summary: null, scannedAt: "" };
}

export function saveCompanyAccountMappings(companyId, payload = {}) {
  const id = String(companyId || "").trim();
  if (!id) return null;
  const all = readAll();
  const next = {
    mappings: payload.mappings || [],
    summary: payload.summary || null,
    scannedAt: payload.scannedAt || nowIso(),
    updatedAt: nowIso(),
  };
  all[id] = next;
  writeAll(all);
  return next;
}

export function approveCompanyAccountMapping(companyId, mappingId, patch = {}) {
  const stored = loadCompanyAccountMappings(companyId);
  const mappings = (stored.mappings || []).map((m) => {
    if (m.id !== mappingId) return m;
    return {
      ...m,
      ...patch,
      status: MAPPING_STATUS.APPROVED,
      approvedByUser: true,
      source: "user-approved",
      updatedAt: nowIso(),
      confidence: Math.max(Number(m.confidence || 0), 95),
    };
  });
  const summary = rebuildSummary(mappings, stored.scannedAt);
  return saveCompanyAccountMappings(companyId, {
    mappings,
    summary,
    scannedAt: stored.scannedAt,
  });
}

export function setCompanyAccountMappingPassive(companyId, mappingId) {
  const stored = loadCompanyAccountMappings(companyId);
  const mappings = (stored.mappings || []).map((m) => {
    if (m.id !== mappingId) return m;
    return {
      ...m,
      status: MAPPING_STATUS.PASSIVE,
      updatedAt: nowIso(),
    };
  });
  return saveCompanyAccountMappings(companyId, {
    mappings,
    summary: rebuildSummary(mappings, stored.scannedAt),
    scannedAt: stored.scannedAt,
  });
}

export function chooseAlternateAccount(companyId, mappingId, accountCode, accountName = "") {
  return approveCompanyAccountMapping(companyId, mappingId, {
    recommendedAccountCode: accountCode,
    recommendedAccountName: accountName,
    reason: `kullanıcı seçimi: ${accountCode}`,
    source: "user-selected",
  });
}

function rebuildSummary(mappings = [], scannedAt = "") {
  return {
    autoApplied: mappings.filter((m) => m.status === MAPPING_STATUS.AUTO_APPLIED)
      .length,
    needsApproval: mappings.filter(
      (m) => m.status === MAPPING_STATUS.NEEDS_APPROVAL
    ).length,
    missing: mappings.filter((m) => m.status === MAPPING_STATUS.MISSING).length,
    conflict: mappings.filter((m) => m.status === MAPPING_STATUS.CONFLICT).length,
    approved: mappings.filter((m) => m.status === MAPPING_STATUS.APPROVED).length,
    passive: mappings.filter((m) => m.status === MAPPING_STATUS.PASSIVE).length,
    total: mappings.length,
    scannedAt: scannedAt || nowIso(),
  };
}

/**
 * Hesap planı yüklendiğinde / Yeniden tara: bootstrap + persist.
 */
export function runCompanyAccountAutoDetect({
  companyId,
  company = {},
  accountPlan = [],
  signals = {},
} = {}) {
  const existing = loadCompanyAccountMappings(companyId);
  const result = bootstrapCompanyAccountMappings({
    accountPlan,
    signals,
    company,
    existingMappings: existing.mappings || company.accountMappingResults || [],
  });

  const saved = saveCompanyAccountMappings(companyId, {
    mappings: result.mappings,
    summary: result.summary,
    scannedAt: result.summary.scannedAt,
  });

  const companyNext = applyMappingsToCompanyFields(
    {
      ...company,
      accountMappingResults: result.mappings,
      accountMappingSummary: result.summary,
    },
    result.mappings
  );

  return {
    ...result,
    stored: saved,
    companyPatch: {
      cashAccounts: companyNext.cashAccounts,
      posMerchantAccounts: companyNext.posMerchantAccounts,
      bankAccounts: companyNext.bankAccounts,
      creditCards: companyNext.creditCards,
      checkAccountMappings: companyNext.checkAccountMappings,
      taxSgkAccountMappings: companyNext.taxSgkAccountMappings,
      accountMappingResults: result.mappings,
      accountMappingSummary: result.summary,
    },
  };
}
