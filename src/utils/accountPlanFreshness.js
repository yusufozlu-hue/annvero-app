/**
 * Hesap planı güncellik özeti — API upload metadata + kaynak etiketi.
 * localStorage fallback API tarihi gibi sunulmaz.
 */

import { formatDateTime } from "@/src/utils/companyCenter";

export const ACCOUNT_PLAN_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @typedef {{
 *   id?: string,
 *   fileName?: string,
 *   originalFileName?: string,
 *   uploadedBy?: string,
 *   uploadedAt?: string | number | Date | null,
 *   activatedAt?: string | number | Date | null,
 *   isActive?: boolean,
 *   totalRows?: number,
 * }} AccountPlanUploadMeta
 */

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function resolveAccountPlanUpdatedAtMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

/**
 * tr-TR kart tarihi: 15.09.2026 17:25
 * @param {unknown} value
 */
export function formatAccountPlanUpdatedAt(value) {
  return formatDateTime(value) || null;
}

/**
 * @param {Array<{ isActive?: boolean }>} accounts
 */
export function countActiveAccountPlanRows(accounts = []) {
  return (accounts || []).filter((row) => row?.isActive !== false).length;
}

/**
 * @param {{
 *   companyId?: string,
 *   status?: 'loading' | 'ready' | 'missing' | 'none',
 *   source?: 'api' | 'localStorage' | 'unavailable' | 'none' | 'error',
 *   upload?: AccountPlanUploadMeta | null,
 *   accounts?: Array<{ isActive?: boolean }>,
 *   accountCount?: number | null,
 *   nowMs?: number,
 * }} input
 */
export function buildAccountPlanFreshnessSummary(input = {}) {
  const status = input.status || "ready";
  const source = input.source || "none";
  const upload = input.upload && typeof input.upload === "object" ? input.upload : null;
  const companyId = String(input.companyId || "").trim();

  if (status === "loading") {
    return {
      companyId,
      status: "loading",
      source,
      readiness: "loading",
      readinessLabel: "Yükleniyor",
      accountCount: null,
      updatedAtMs: null,
      updatedAtLabel: null,
      fileName: null,
      uploadId: null,
      uploadedBy: null,
      sourceLabel: null,
      isStale: false,
      staleWarning: null,
      showApiDates: false,
    };
  }

  const accountCount =
    input.accountCount != null
      ? Number(input.accountCount) || 0
      : countActiveAccountPlanRows(input.accounts);

  const readiness =
    accountCount > 0 ? "ready" : status === "missing" || source === "none" ? "missing" : "missing";

  const isApiSource = source === "api";
  const updatedAtRaw = isApiSource
    ? upload?.activatedAt || upload?.uploadedAt || null
    : null;
  const updatedAtMs = resolveAccountPlanUpdatedAtMs(updatedAtRaw);
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const isStale =
    isApiSource &&
    updatedAtMs != null &&
    nowMs - updatedAtMs > ACCOUNT_PLAN_STALE_AFTER_MS;

  const uploadedBy = isApiSource ? String(upload?.uploadedBy || "").trim() : "";

  let sourceLabel = null;
  if (source === "localStorage") sourceLabel = "Yerel önbellek";
  else if (source === "api") sourceLabel = "Sunucu (aktif sürüm)";
  else if (source === "unavailable" || source === "error") {
    sourceLabel = accountCount > 0 ? "Yerel önbellek" : null;
  }

  return {
    companyId,
    status: readiness === "missing" ? "missing" : "ready",
    source,
    readiness,
    readinessLabel: readiness === "ready" ? "Hazır" : "Eksik",
    accountCount,
    updatedAtMs,
    updatedAtLabel: formatAccountPlanUpdatedAt(updatedAtRaw),
    fileName: isApiSource
      ? String(upload?.originalFileName || upload?.fileName || "").trim() || null
      : null,
    uploadId: isApiSource ? String(upload?.id || "").trim() || null : null,
    uploadedBy: uploadedBy || null,
    sourceLabel,
    isStale,
    staleWarning: isStale ? "Hesap planı güncel olmayabilir" : null,
    showApiDates: isApiSource,
  };
}

/**
 * Firma değişiminde önceki özetin kısa süre görünmesini engeller.
 * @param {ReturnType<typeof buildAccountPlanFreshnessSummary> | null} summary
 * @param {string} selectedCompanyId
 */
export function isAccountPlanFreshnessStaleForCompany(summary, selectedCompanyId) {
  if (!summary) return true;
  if (summary.status === "loading") return false;
  const selected = String(selectedCompanyId || "").trim();
  if (!selected) return true;
  return String(summary.companyId || "").trim() !== selected;
}
