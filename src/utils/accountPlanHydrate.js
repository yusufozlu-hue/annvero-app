/**
 * Kanonik aktif hesap planı hydrate — API → companyId anahtarı (localStorage + state).
 * Bank Parser / Fiş Dönüştürme / Elektraweb ortak davranışı.
 *
 * Başarısızlık veya unavailable: mevcut localStorage planına dokunmaz.
 * İptal (cancelled / AbortSignal): yazmaz.
 */

import { fetchFullActiveAccountPlan } from "@/src/utils/accountPlanApi";
import {
  loadAccountPlansFromStorage,
  saveAccountPlansToStorage,
  setCompanyAccountPlan,
} from "@/src/utils/companyCenter";

/**
 * companyCenter storage sözleşmesi: `{ [companyId]: { uploadedAt?, accounts } }`.
 *
 * @typedef {Record<string, unknown>} AccountPlansByCompany
 * @typedef {{
 *   accountCode?: string,
 *   accountName?: string,
 *   [key: string]: unknown,
 * }} AccountPlanRow
 *
 * @param {{
 *   companyId: string,
 *   signal?: AbortSignal,
 *   isCancelled?: () => boolean,
 *   fetchPlan?: (
 *     companyId: string,
 *     options?: Record<string, unknown>
 *   ) => Promise<{ source?: string, accounts?: AccountPlanRow[] }>,
 *   loadStorage?: () => AccountPlansByCompany,
 *   setPlan?: (
 *     plans: AccountPlansByCompany,
 *     companyId: string,
 *     accounts: AccountPlanRow[]
 *   ) => AccountPlansByCompany,
 *   saveStorage?: (plans: AccountPlansByCompany) => void,
 * }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   reason: string,
 *   companyId: string,
 *   accounts: AccountPlanRow[],
 *   accountPlans: AccountPlansByCompany | null,
 * }>}
 */
export async function hydrateCompanyAccountPlanFromApi({
  companyId,
  signal,
  isCancelled,
  fetchPlan = fetchFullActiveAccountPlan,
  loadStorage = loadAccountPlansFromStorage,
  setPlan = setCompanyAccountPlan,
  saveStorage = saveAccountPlansToStorage,
} = {}) {
  const empty = {
    ok: false,
    reason: "no-company",
    companyId: companyId || "",
    accounts: [],
    accountPlans: null,
  };

  if (!companyId) return empty;

  const cancelled = () =>
    Boolean((typeof isCancelled === "function" && isCancelled()) || signal?.aborted);

  if (cancelled()) {
    return { ...empty, reason: "cancelled" };
  }

  try {
    const plan = await fetchPlan(companyId, signal ? { signal } : {});

    if (cancelled()) {
      return { ...empty, reason: "cancelled" };
    }

    if (!plan || plan.source === "unavailable") {
      return { ...empty, reason: "unavailable" };
    }

    const accounts = Array.isArray(plan.accounts) ? plan.accounts : [];

    // Yazmadan önce tekrar kontrol — A→B yarışında iptal edilen istek storage'a yazmasın.
    if (cancelled()) {
      return { ...empty, reason: "cancelled" };
    }

    /** @type {AccountPlansByCompany} */
    const accountPlans = setPlan(loadStorage(), companyId, accounts);
    saveStorage(accountPlans);

    return {
      ok: true,
      reason: "hydrated",
      companyId,
      accounts,
      accountPlans,
    };
  } catch (error) {
    if (cancelled() || error?.name === "AbortError") {
      return { ...empty, reason: "cancelled" };
    }
    return { ...empty, reason: "error" };
  }
}
