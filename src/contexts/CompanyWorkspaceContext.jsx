"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ANNVERO_COMPANY_CHANGED_EVENT,
  ANNVERO_SELECTED_COMPANY_KEY,
} from "@/src/config/annveroNavConfig";
import { useUserRole } from "@/src/hooks/useUserRole";
import { pushRecentCompanyId } from "@/src/utils/companyPreferences";
import {
  fetchCompanies,
  getCompanyDisplayName,
  readSessionCompanies,
  syncSelectedCompanyId,
  writeSessionCompanies,
} from "@/src/utils/companies";

const CompanyWorkspaceContext = createContext(null);

function readStoredCompanyId() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ANNVERO_SELECTED_COMPANY_KEY) || "";
}

export function CompanyWorkspaceProvider({ children }) {
  const {
    canAccessCompany,
    loading: roleLoading,
    authenticated,
  } = useUserRole();
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyIdState] = useState("");
  const [isLoading, setIsLoading] = useState(true);
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
      const loaded = await fetchCompanies(options);
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
    let cancelled = false;

    const boot = () => {
      if (cancelled) return;
      if (!authenticated) {
        setCompanies([]);
        setSelectedCompanyIdState("");
        setIsLoading(false);
        lastRefreshAtRef.current = 0;
        return;
      }

      const seeded = readSessionCompanies();
      if (seeded.length > 0) {
        setCompanies(seeded);
        setSelectedCompanyIdState(readStoredCompanyId());
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }

      void refreshCompanies({ force: true });
    };

    queueMicrotask(boot);

    if (!authenticated) {
      return () => {
        cancelled = true;
      };
    }

    const handleRefresh = () => refreshCompanies({ force: true });
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshCompanies();
    };
    const handleCompanyChanged = (event) => {
      const nextId = event.detail?.companyId ?? "";
      setSelectedCompanyIdState(nextId);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener(ANNVERO_COMPANY_CHANGED_EVENT, handleCompanyChanged);
    window.addEventListener("annvero:refresh-modules", handleRefresh);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(ANNVERO_COMPANY_CHANGED_EVENT, handleCompanyChanged);
      window.removeEventListener("annvero:refresh-modules", handleRefresh);
    };
  }, [authenticated, refreshCompanies]);

  const accessibleCompanies = useMemo(
    () => companies.filter((company) => canAccessCompany(company.id)),
    [companies, canAccessCompany]
  );

  useEffect(() => {
    if (roleLoading || !authenticated) return;

    queueMicrotask(() => {
      if (selectedCompanyId && canAccessCompany(selectedCompanyId)) return;
      const firstAccessible = accessibleCompanies[0]?.id || "";
      if (firstAccessible && firstAccessible !== selectedCompanyId) {
        setSelectedCompanyId(firstAccessible);
      } else if (!firstAccessible && selectedCompanyId) {
        setSelectedCompanyId("");
      }
    });
  }, [
    accessibleCompanies,
    authenticated,
    canAccessCompany,
    roleLoading,
    selectedCompanyId,
    setSelectedCompanyId,
  ]);

  const selectedCompany = useMemo(
    () => accessibleCompanies.find((company) => company.id === selectedCompanyId) || null,
    [accessibleCompanies, selectedCompanyId]
  );

  const value = useMemo(
    () => ({
      companies: accessibleCompanies,
      allCompanies: companies,
      selectedCompanyId,
      setSelectedCompanyId,
      selectedCompany,
      getCompanyDisplayName,
      refreshCompanies,
      isLoading: isLoading || roleLoading,
      canAccessCompany,
    }),
    [
      accessibleCompanies,
      companies,
      selectedCompanyId,
      setSelectedCompanyId,
      selectedCompany,
      refreshCompanies,
      isLoading,
      roleLoading,
      canAccessCompany,
    ]
  );

  return (
    <CompanyWorkspaceContext.Provider value={value}>
      {children}
    </CompanyWorkspaceContext.Provider>
  );
}

export function useCompanyWorkspace() {
  const context = useContext(CompanyWorkspaceContext);
  if (!context) {
    throw new Error("useCompanyWorkspace must be used within CompanyWorkspaceProvider");
  }
  return context;
}

export function useOptionalCompanyWorkspace() {
  return useContext(CompanyWorkspaceContext);
}
