"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ANNVERO_ROLE_STORAGE_KEY,
  canAccessRoute,
  canSeeNavGroup,
  canSeeNavItem,
} from "@/src/config/annveroRoles";
import { createUserAccess } from "@/src/lib/auth/userAccess";
import { canAccessCompany as checkCompanyAccess } from "@/src/lib/auth/permissions";
import { upsertCachedUser } from "@/src/utils/annveroUserStore";

const STALE_ACCESS_KEYS = [
  "annvero_show_access_warning",
  "annvero_needs_invite",
  "annvero_missing_company_access",
  "annvero_access_warning_v1",
];

function clearStaleAccessFlags() {
  if (typeof window === "undefined") return;
  try {
    for (const key of STALE_ACCESS_KEYS) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export function useUserRole() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [needsInvite, setNeedsInvite] = useState(false);
  const [apiShowAccessWarning, setApiShowAccessWarning] = useState(false);
  const [accountActive, setAccountActive] = useState(true);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    clearStaleAccessFlags();
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" });
      const data = await response.json();

      if (!data.authenticated) {
        setAuthenticated(false);
        setProfile(null);
        setIsPlatformAdmin(false);
        setSchemaMissing(false);
        setUsingFallback(false);
        setNeedsInvite(false);
        setApiShowAccessWarning(false);
        setAccountActive(true);
        return;
      }

      if (data.active === false || response.status === 403) {
        setAuthenticated(true);
        setProfile(null);
        setUsingFallback(false);
        setNeedsInvite(false);
        setApiShowAccessWarning(false);
        setAccountActive(false);
        return;
      }

      const nextProfile = data.profile || null;
      const role = data.role || nextProfile?.role || "";
      const elevated =
        Boolean(data.isAdmin) ||
        Boolean(data.isPlatformAdmin) ||
        Boolean(data.isPartner) ||
        role === "admin" ||
        role === "partner";

      setAuthenticated(true);
      setIsPlatformAdmin(Boolean(data.isPlatformAdmin ?? data.isAdmin) || role === "admin");
      setSchemaMissing(Boolean(data.schemaMissing));
      setUsingFallback(Boolean(data.usingFallback && (data.schemaMissing || data.adminUnavailable)));
      setNeedsInvite(elevated ? false : Boolean(data.needsInvite));
      // Banner sadece API'nin kesin showAccessWarning alanı; eski flag'ler yok sayılır
      setApiShowAccessWarning(elevated ? false : data.showAccessWarning === true);
      setAccountActive(true);
      setProfile(nextProfile);

      if (nextProfile?.role && typeof window !== "undefined") {
        localStorage.setItem(ANNVERO_ROLE_STORAGE_KEY, nextProfile.role);
      }
      if (nextProfile) upsertCachedUser(nextProfile);

      if (typeof window !== "undefined" && data.debug) {
        console.info("[auth/me debug]", data.debug);
      }
    } catch {
      // Ağ hatası: banner gösterme
      clearStaleAccessFlags();
      if (typeof window !== "undefined") {
        const storedRole = localStorage.getItem(ANNVERO_ROLE_STORAGE_KEY) || "";
        setProfile({
          role: storedRole || "muhasebe_personeli",
          companyIds: [],
          permissions: [],
          source: "fallback",
        });
        setUsingFallback(true);
        setSchemaMissing(false);
        setAuthenticated(true);
        setApiShowAccessWarning(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const access = useMemo(() => createUserAccess(profile || {}), [profile]);
  const role = access.role;

  // Tek kaynak: API showAccessWarning === true VE client access de true; admin asla false
  const showAccessWarning =
    apiShowAccessWarning === true && access.showAccessWarning === true;

  const setRole = (nextRole) => {
    if (typeof window === "undefined") return;
    localStorage.setItem(ANNVERO_ROLE_STORAGE_KEY, nextRole);
    setProfile((prev) => ({ ...(prev || {}), role: nextRole }));
  };

  return {
    role,
    profile,
    permissions: access.permissions,
    companyIds: access.companyIds,
    modules: access.modules,
    isAdmin: isPlatformAdmin || role === "admin",
    isPlatformAdmin: isPlatformAdmin || role === "admin",
    isPartner: access.isPartner,
    isManagementUser: access.isManagementUser,
    authenticated,
    loading,
    schemaMissing,
    usingFallback,
    needsInvite,
    showAccessWarning,
    userAccess: access,
    refresh: loadProfile,
    setRole,
    canAccessRoute: (pathname) => canAccessRoute(role, pathname),
    canSeeNavGroup: (groupTitle) => canSeeNavGroup(role, groupTitle),
    canSeeNavItem: (item) => canSeeNavItem(role, item),
    canAccessCompany: (companyId) => checkCompanyAccess(role, companyId, access.companyIds),
    canAccessModule: access.canAccessModule,
    hasPermission: access.hasPermission,
    isActive: accountActive && access.isActive,
  };
}
