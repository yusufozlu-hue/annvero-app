import { ANNVERO_SELECTED_COMPANY_KEY } from "@/src/config/annveroNavConfig";
import { formatCompanyFromSupabaseRow } from "@/src/utils/companyNormalize";
import { fetchCompanyRecords } from "@/src/utils/companiesApi";

export const COMPANIES_SESSION_STORAGE_KEY = "annvero_companies_session_v1";

export const COMPANY_STORAGE_KEYS = [
  "annvero_companies_v24",
  "annvero_companies_v23",
  "annvero_companies_v22",
  "annvero_companies_v21",
  "annvero_companies_v2",
];

export function getCompanyDisplayName(company) {
  if (!company) return "";

  return (
    company.companyName ||
    company.name ||
    company.title ||
    ""
  ).trim();
}

export function isCompanyActive(company) {
  return company?.isActive !== false;
}

const sortByCompanyName = (a, b) =>
  getCompanyDisplayName(a).localeCompare(getCompanyDisplayName(b), "tr", {
    sensitivity: "base",
  });

function dedupeCompaniesByName(companies) {
  const groups = new Map();

  for (const company of companies) {
    const name = getCompanyDisplayName(company);
    if (!name || !company?.id) continue;

    const key = name.toLocaleLowerCase("tr");

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(company);
  }

  const result = [];

  for (const group of groups.values()) {
    const activeOnes = group.filter(isCompanyActive);
    const pool = activeOnes.length > 0 ? activeOnes : group;
    result.push(pool[pool.length - 1]);
  }

  return result;
}

export function normalizeCompanies(companies) {
  if (!Array.isArray(companies)) return [];

  const filtered = companies.filter((company) => {
    const name = getCompanyDisplayName(company);
    return Boolean(name && company?.id);
  });

  return dedupeCompaniesByName(filtered);
}

export function groupCompaniesForDisplay(companies) {
  const list = normalizeCompanies(companies);

  const activeCompanies = list.filter(isCompanyActive).sort(sortByCompanyName);
  const passiveCompanies = list
    .filter((company) => !isCompanyActive(company))
    .sort(sortByCompanyName);

  return {
    activeCompanies,
    passiveCompanies,
    allCompanies: [...activeCompanies, ...passiveCompanies],
  };
}

export function sortCompaniesForDisplay(companies) {
  return groupCompaniesForDisplay(companies).allCompanies;
}

/** Yerel legacy firma listesi — oturum/API yerine yetki için kullanılmaz. */
export function readLegacyCompaniesFromStorage() {
  if (typeof window === "undefined") return [];

  for (const key of COMPANY_STORAGE_KEYS) {
    const saved = localStorage.getItem(key);
    if (!saved) continue;

    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return sortCompaniesForDisplay(parsed);
      }
    } catch {
      continue;
    }
  }

  return [];
}

let companiesFetchCache = null;
let companiesFetchCacheAt = 0;
const COMPANIES_FETCH_CACHE_MS = 60_000;

export function invalidateCompaniesCache() {
  companiesFetchCache = null;
  companiesFetchCacheAt = 0;
}

/** Çıkış / kullanıcı değişimi — bellek + session firma önbelleği. */
export function clearCompaniesClientCache() {
  invalidateCompaniesCache();
  clearSessionCompanies();
}

export function readSessionCompanies() {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(COMPANIES_SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeSessionCompanies(companies = []) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(COMPANIES_SESSION_STORAGE_KEY, JSON.stringify(companies));
  } catch {
    // ignore quota errors
  }
}

export function clearSessionCompanies() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(COMPANIES_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Firma kaydı sonrası tüm modüllerde listeyi yenile. */
export function broadcastCompaniesRefresh() {
  invalidateCompaniesCache();
  clearSessionCompanies();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("annvero:refresh-modules"));
  }
}

export async function fetchCompanies(options = {}) {
  const now = Date.now();
  if (
    !options.force &&
    companiesFetchCache &&
    now - companiesFetchCacheAt < COMPANIES_FETCH_CACHE_MS
  ) {
    return companiesFetchCache;
  }

  try {
    const data = await fetchCompanyRecords();

    const companies = (data || [])
      .map(formatCompanyFromSupabaseRow)
      .filter(Boolean);

    companiesFetchCache = sortCompaniesForDisplay(companies);
    companiesFetchCacheAt = Date.now();
    return companiesFetchCache;
  } catch (error) {
    console.error("Firma listesi Supabase'den alınamadı:", error);
    // Oturumsuz / hatalı durumda başka kullanıcının localStorage listesini sızdırma
    return [];
  }
}

/** @deprecated Use fetchCompanies() instead. */
export function loadCompanies() {
  return [];
}

/** @deprecated Use fetchCompanies() instead. */
export function loadCompaniesFromStorage() {
  return loadCompanies();
}

export function syncSelectedCompanyId(loadedCompanies, currentId) {
  if (currentId && loadedCompanies.some((company) => company.id === currentId)) {
    return currentId;
  }

  if (typeof window !== "undefined") {
    try {
      const storedId = localStorage.getItem(ANNVERO_SELECTED_COMPANY_KEY) || "";
      if (storedId && loadedCompanies.some((company) => company.id === storedId)) {
        return storedId;
      }
    } catch {
      // ignore storage errors
    }
  }

  return loadedCompanies[0]?.id || "";
}

export function persistCompaniesToLocalStorage(companies) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(COMPANY_STORAGE_KEYS[0], JSON.stringify(companies));
  } catch (error) {
    console.error("Firma listesi localStorage'a yazılamadı:", error);
  }
}
