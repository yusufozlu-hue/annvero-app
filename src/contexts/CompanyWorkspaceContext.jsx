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
import { hasSupabaseAuthCookieHint } from "@/src/lib/supabase/client";
import { pushRecentCompanyId } from "@/src/utils/companyPreferences";
import {
  fetchCompanies,
  getCompanyDisplayName,
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
    companyIds,
    role,
  } = useUserRole();
  // UI state yalnız canAccessCompany ile filtrelenmiş liste tutar — ham RLS yok.
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyIdState] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const lastRefreshAtRef = useRef(0);
  const companiesCountRef = useRef(0);
  /** Ham RLS sonucu; profil/yetki gelene kadar UI'a yazılmaz. */
  const rawCompaniesRef = useRef(null);
  const rawReadyRef = useRef(false);
  /** In-flight publish yarışlarını iptal eder (logout / kullanıcı değişimi). */
  const publishEpochRef = useRef(0);
  const COMPANY_REFRESH_TTL_MS = 60_000;

  const roleLoadingRef = useRef(roleLoading);
  const authenticatedRef = useRef(authenticated);
  const canAccessCompanyRef = useRef(canAccessCompany);

  useEffect(() => {
    roleLoadingRef.current = roleLoading;
    authenticatedRef.current = authenticated;
    canAccessCompanyRef.current = canAccessCompany;
  }, [roleLoading, authenticated, canAccessCompany]);

  useEffect(() => {
    companiesCountRef.current = companies.length;
  }, [companies.length]);

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
      if (nextId && !canAccessCompanyRef.current(nextId)) return;
      setSelectedCompanyIdState(nextId);
      persistCompanyId(nextId);
    },
    [persistCompanyId]
  );

  /**
   * Ham listeyi canAccessCompany ile filtreleyip yalnız yetkili sonucu yayımlar.
   * SessionStorage'a da yalnız filtrelenmiş liste yazılır.
   */
  const publishFilteredCompanies = useCallback(
    (rawList) => {
      const access = canAccessCompanyRef.current;
      const filtered = (Array.isArray(rawList) ? rawList : []).filter((company) =>
        access(company.id)
      );

      setCompanies(filtered);
      companiesCountRef.current = filtered.length;
      writeSessionCompanies(filtered);
      lastRefreshAtRef.current = Date.now();

      setSelectedCompanyIdState((currentId) => {
        const storedId = readStoredCompanyId();
        const candidate = syncSelectedCompanyId(
          filtered,
          currentId || storedId
        );
        const synced =
          candidate && access(candidate)
            ? candidate
            : filtered[0]?.id || "";
        if (synced && synced !== storedId) {
          persistCompanyId(synced);
        } else if (!synced && storedId) {
          persistCompanyId("");
        }
        return synced;
      });
      setIsLoading(false);
    },
    [persistCompanyId]
  );

  const discardHeldRaw = useCallback(() => {
    rawCompaniesRef.current = null;
    rawReadyRef.current = false;
    publishEpochRef.current += 1;
    setCompanies([]);
    companiesCountRef.current = 0;
    setSelectedCompanyIdState("");
    setIsLoading(false);
    lastRefreshAtRef.current = 0;
  }, []);

  const refreshCompanies = useCallback(
    async (options = {}) => {
      const now = Date.now();
      const hasCompanies = companiesCountRef.current > 0;
      if (
        !options.force &&
        hasCompanies &&
        now - lastRefreshAtRef.current < COMPANY_REFRESH_TTL_MS
      ) {
        return;
      }

      // AuthGate children + cookie ipucu: oturum yoksa fail-closed (sorgu yok).
      if (!hasSupabaseAuthCookieHint()) {
        discardHeldRaw();
        return;
      }

      if (!hasCompanies) setIsLoading(true);

      const epoch = ++publishEpochRef.current;

      try {
        // /api/auth/me ile paralel: getSession + RLS select fetchCompanies içinde.
        const loaded = await fetchCompanies(options);
        if (epoch !== publishEpochRef.current) return;

        // Ham sonucu ref'te tut (UI'ya yazılmaz); yetki değişince yeniden filtrelenir.
        rawCompaniesRef.current = loaded;
        rawReadyRef.current = true;

        if (roleLoadingRef.current) {
          // Profil hâlâ geliyor; yayımlama publish efektine bırakılır.
          return;
        }

        if (!authenticatedRef.current) {
          // Profil hatası / unauthenticated — ham veriyi at.
          discardHeldRaw();
          return;
        }

        publishFilteredCompanies(loaded);
        rawReadyRef.current = false;
      } catch {
        if (epoch !== publishEpochRef.current) return;
        rawCompaniesRef.current = null;
        rawReadyRef.current = false;
        if (!hasCompanies) setIsLoading(false);
      }
    },
    [discardHeldRaw, publishFilteredCompanies]
  );

  // Boot: AuthGate children boyandığında (cookie/session yolu) firma sorgusunu
  // /api/auth/me beklemeden başlat. UI yayımlama profil tamamına bağlı.
  useEffect(() => {
    let cancelled = false;

    const boot = () => {
      if (cancelled) return;
      if (!hasSupabaseAuthCookieHint()) {
        discardHeldRaw();
        return;
      }
      // SessionStorage seed UI'a yazılmaz — yetki doğrulanmadan firma adı görünmesin.
      setIsLoading(true);
      void refreshCompanies({ force: true });
    };

    queueMicrotask(boot);

    const handleRefresh = () => refreshCompanies({ force: true });
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshCompanies();
    };
    const handleCompanyChanged = (event) => {
      const nextId = event.detail?.companyId ?? "";
      if (nextId && !canAccessCompanyRef.current(nextId)) return;
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
  }, [discardHeldRaw, refreshCompanies]);

  // Profil/yetki hazır olunca (veya companyIds/role değişince) tutulan ham sonucu
  // filtreleyip yayımlar. Ham dizi yalnız ref'te kalır; UI'ya yazılmaz.
  // Not: canAccessCompany her render'da yeni fonksiyon — bağımlılık olarak
  // stabil companyIds/role kullanılır; filtre ref üzerinden güncel kalır.
  useEffect(() => {
    if (roleLoading) return;

    // setState'i effect gövdesinden çıkarmak için microtask (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (!authenticatedRef.current) {
        discardHeldRaw();
        return;
      }

      if (rawCompaniesRef.current == null && !rawReadyRef.current) return;

      publishFilteredCompanies(rawCompaniesRef.current || []);
      rawReadyRef.current = false;
    });
  }, [
    roleLoading,
    authenticated,
    companyIds,
    role,
    discardHeldRaw,
    publishFilteredCompanies,
  ]);

  // Profil şirket listesi değişince seçimi yeniden doğrula (state zaten filtrelenmiş).
  useEffect(() => {
    if (roleLoading || !authenticated) return;

    queueMicrotask(() => {
      if (selectedCompanyId && canAccessCompany(selectedCompanyId)) return;
      const firstAccessible = companies[0]?.id || "";
      if (firstAccessible && firstAccessible !== selectedCompanyId) {
        setSelectedCompanyId(firstAccessible);
      } else if (!firstAccessible && selectedCompanyId) {
        setSelectedCompanyId("");
      }
    });
  }, [
    companies,
    authenticated,
    canAccessCompany,
    roleLoading,
    selectedCompanyId,
    setSelectedCompanyId,
  ]);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) || null,
    [companies, selectedCompanyId]
  );

  const value = useMemo(
    () => ({
      companies,
      // Ham RLS asla dışarı verilmez; admin/partner zaten canAccessCompany ile tam listeyi görür.
      allCompanies: companies,
      selectedCompanyId,
      setSelectedCompanyId,
      selectedCompany,
      getCompanyDisplayName,
      refreshCompanies,
      // Profil bitmeden topbar "yükleniyor" kalsın — yetkisiz ad flash'ı yok.
      isLoading: isLoading || roleLoading,
      canAccessCompany,
    }),
    [
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
