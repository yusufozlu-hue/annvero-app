"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ANNVERO_COMPANY_CHANGED_EVENT,
  ANNVERO_SELECTED_COMPANY_KEY,
} from "@/src/config/annveroNavConfig";
import { useUserRole } from "@/src/hooks/useUserRole";
import { pushRecentCompanyId } from "@/src/utils/companyPreferences";
import {
  fetchCompanies,
  getCompanyDisplayName,
  syncSelectedCompanyId,
} from "@/src/utils/companies";

const COMPANIES_SESSION_KEY = "annvero_companies_session_v1";

function readStoredCompanyId() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ANNVERO_SELECTED_COMPANY_KEY) || "";
}

function readSessionCompanies() {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(COMPANIES_SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSessionCompanies(companies = []) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(COMPANIES_SESSION_KEY, JSON.stringify(companies));
  } catch {
    // ignore quota errors
  }
}

export function useCompanyList() {
  const { canAccessCompany, loading: roleLoading } = useUserRole();
  const [companies, setCompanies] = useState(() => readSessionCompanies());
  const [selectedCompanyId, setSelectedCompanyIdState] = useState(readStoredCompanyId);
  const [isLoading, setIsLoading] = useState(() => readSessionCompanies().length === 0);
  const lastRefreshAtRef = useRef(0);
  const COMPANY_REFRESH_TTL_MS = 60_000;

  const persistCompanyId = useCallback((companyId = "") => {
    if (typeof window === "undefined") return;
    if (companyId) {
      localStorage.setItem(ANNVERO_SELECTED_COMPANY_KEY, companyId);
      pushRecentCompanyId(companyId);
    } else {
      localStorage.removeItem(ANNVERO_SELECTED_COMPANY_KEY);
    }
    window.dispatchEvent(
      new CustomEvent(ANNVERO_COMPANY_CHANGED_EVENT, { detail: { companyId } })
    );
  }, []);

  const setSelectedCompanyId = useCallback(
    (nextId) => {
      setSelectedCompanyIdState(nextId);
      persistCompanyId(nextId);
    },
    [persistCompanyId]
  );

  const refreshCompanies = useCallback(async (options = {}) => {
    const now = Date.now();
    if (
      !options.force &&
      companies.length > 0 &&
      now - lastRefreshAtRef.current < COMPANY_REFRESH_TTL_MS
    ) {
      return;
    }

    setIsLoading(companies.length === 0);

    try {
      const loaded = await fetchCompanies();
      setCompanies(loaded);
      writeSessionCompanies(loaded);
      lastRefreshAtRef.current = Date.now();
      setSelectedCompanyIdState((currentId) => {
        const storedId = readStoredCompanyId();
        const synced = syncSelectedCompanyId(loaded, currentId || storedId);
        if (synced && synced !== storedId) {
          persistCompanyId(synced);
        }
        return synced;
      });
    } finally {
      setIsLoading(false);
    }
  }, [companies.length, persistCompanyId]);

  useEffect(() => {
    refreshCompanies();

    const handleRefresh = () => refreshCompanies();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshCompanies();
    };
    const handleCompanyChanged = (event) => {
      const nextId = event.detail?.companyId ?? "";
      setSelectedCompanyIdState(nextId);
    };

    window.addEventListener("focus", handleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener(ANNVERO_COMPANY_CHANGED_EVENT, handleCompanyChanged);
    window.addEventListener("annvero:refresh-modules", handleRefresh);

    return () => {
      window.removeEventListener("focus", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(ANNVERO_COMPANY_CHANGED_EVENT, handleCompanyChanged);
      window.removeEventListener("annvero:refresh-modules", handleRefresh);
    };
  }, [refreshCompanies]);

  const accessibleCompanies = useMemo(
    () => companies.filter((company) => canAccessCompany(company.id)),
    [companies, canAccessCompany]
  );

  useEffect(() => {
    if (roleLoading || !accessibleCompanies.length) return;
    if (selectedCompanyId && canAccessCompany(selectedCompanyId)) return;
    const firstAccessible = accessibleCompanies[0]?.id || "";
    if (firstAccessible && firstAccessible !== selectedCompanyId) {
      setSelectedCompanyId(firstAccessible);
    } else if (!firstAccessible && selectedCompanyId) {
      setSelectedCompanyId("");
    }
  }, [
    accessibleCompanies,
    canAccessCompany,
    roleLoading,
    selectedCompanyId,
    setSelectedCompanyId,
  ]);

  const selectedCompany = useMemo(
    () => accessibleCompanies.find((company) => company.id === selectedCompanyId) || null,
    [accessibleCompanies, selectedCompanyId]
  );

  return {
    companies: accessibleCompanies,
    allCompanies: companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
    getCompanyDisplayName,
    refreshCompanies,
    isLoading: isLoading || roleLoading,
    canAccessCompany,
  };
}
