import {
  ANNVERO_FAVORITE_COMPANIES_KEY,
  ANNVERO_RECENT_COMPANIES_KEY,
} from "@/src/config/annveroNavConfig";

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function loadFavoriteCompanyIds() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(ANNVERO_FAVORITE_COMPANIES_KEY) || "[]", []);
}

export function saveFavoriteCompanyIds(ids = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ANNVERO_FAVORITE_COMPANIES_KEY, JSON.stringify(ids));
}

export function toggleFavoriteCompanyId(companyId = "") {
  if (!companyId) return loadFavoriteCompanyIds();
  const current = loadFavoriteCompanyIds();
  const next = current.includes(companyId)
    ? current.filter((id) => id !== companyId)
    : [companyId, ...current].slice(0, 20);
  saveFavoriteCompanyIds(next);
  return next;
}

export function loadRecentCompanyIds() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(ANNVERO_RECENT_COMPANIES_KEY) || "[]", []);
}

export function pushRecentCompanyId(companyId = "") {
  if (!companyId || typeof window === "undefined") return loadRecentCompanyIds();
  const next = [companyId, ...loadRecentCompanyIds().filter((id) => id !== companyId)].slice(0, 8);
  localStorage.setItem(ANNVERO_RECENT_COMPANIES_KEY, JSON.stringify(next));
  return next;
}
