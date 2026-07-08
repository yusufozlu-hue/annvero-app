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

export function useUserRole() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [needsInvite, setNeedsInvite] = useState(false);
  const [accountActive, setAccountActive] = useState(true);

  const loadProfile = useCallback(async () => {
    setLoading(true);
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
        setAccountActive(true);
        return;
      }

      if (data.active === false || response.status === 403) {
        setAuthenticated(true);
        setProfile(null);
        setUsingFallback(false);
        setNeedsInvite(false);
        setAccountActive(false);
        return;
      }

      setAuthenticated(true);
      setIsPlatformAdmin(Boolean(data.isPlatformAdmin ?? data.isAdmin));
      // usingFallback yalnızca DB gerçekten ulaşılamadığında true olmalı (API tarafında kısıtlanır).
      setSchemaMissing(Boolean(data.schemaMissing));
      setUsingFallback(Boolean(data.usingFallback && (data.schemaMissing || data.adminUnavailable)));
      setNeedsInvite(Boolean(data.needsInvite || data.profile?.needsInvite));
      setAccountActive(true);
      setProfile(data.profile || null);

      if (data.profile?.role && typeof window !== "undefined") {
        localStorage.setItem(ANNVERO_ROLE_STORAGE_KEY, data.profile.role);
      }
      if (data.profile) upsertCachedUser(data.profile);
    } catch {
      // Ağ hatası: sessiz metadata/local fallback; kullanıcıya banner göstermeyiz.
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
    isAdmin: isPlatformAdmin,
    isPlatformAdmin,
    isPartner: access.isPartner,
    isManagementUser: access.isManagementUser,
    authenticated,
    loading,
    schemaMissing,
    usingFallback,
    needsInvite,
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
