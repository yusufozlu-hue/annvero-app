import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { formatCompanyFromSupabaseRow } from "@/src/utils/companyNormalize";

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

function readRawCompaniesFromStorage() {
  if (typeof window === "undefined") return [];

  for (const key of COMPANY_STORAGE_KEYS) {
    const saved = localStorage.getItem(key);
    if (!saved) continue;

    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return [];
}

export async function fetchCompanies() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    console.error("Supabase istemcisi yapılandırılmamış.");
    return sortCompaniesForDisplay(readRawCompaniesFromStorage());
  }

  try {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    const companies = (data || [])
      .map(formatCompanyFromSupabaseRow)
      .filter(Boolean);

    return sortCompaniesForDisplay(companies);
  } catch (error) {
    console.error("Firma listesi Supabase'den alınamadı:", error);
    return sortCompaniesForDisplay(readRawCompaniesFromStorage());
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
  if (loadedCompanies.some((company) => company.id === currentId)) {
    return currentId;
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
