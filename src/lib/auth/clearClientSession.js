/**
 * İstemci oturum / rol / firma önbelleklerinin güvenli temizliği.
 * Cookie ipucu authorization değildir; çıkış ve kullanıcı değişiminde çağrılır.
 */

import { ANNVERO_ROLE_STORAGE_KEY } from "@/src/config/annveroRoles";
import {
  ANNVERO_FAVORITE_COMPANIES_KEY,
  ANNVERO_RECENT_COMPANIES_KEY,
  ANNVERO_SELECTED_COMPANY_KEY,
} from "@/src/config/annveroNavConfig";
import { invalidateAuthMeCache } from "@/src/lib/auth/authMeClient";
import { resetAuthGateCache } from "@/src/components/authGateCache";
import { ANNVERO_USERS_CACHE_KEY } from "@/src/utils/annveroUserStore";
import {
  clearCompaniesClientCache,
  COMPANIES_SESSION_STORAGE_KEY,
} from "@/src/utils/companies";
import { invalidateTransactionMemoryCache } from "@/src/utils/transactionMemoryApi";

const CLIENT_AUTH_STORAGE_KEYS = [
  ANNVERO_ROLE_STORAGE_KEY,
  ANNVERO_USERS_CACHE_KEY,
  ANNVERO_SELECTED_COMPANY_KEY,
  ANNVERO_FAVORITE_COMPANIES_KEY,
  ANNVERO_RECENT_COMPANIES_KEY,
  COMPANIES_SESSION_STORAGE_KEY,
];

export function clearClientSessionCaches() {
  invalidateAuthMeCache();
  resetAuthGateCache();
  clearCompaniesClientCache();
  invalidateTransactionMemoryCache();

  if (typeof window === "undefined") return;

  try {
    for (const key of CLIENT_AUTH_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}
