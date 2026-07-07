"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ANNVERO_ROLE_STORAGE_KEY,
  canAccessRoute,
  canSeeNavGroup,
} from "@/src/config/annveroRoles";
import { createUserAccess } from "@/src/lib/auth/userAccess";
import { canAccessCompany as checkCompanyAccess } from "@/src/lib/auth/permissions";
import { upsertCachedUser } from "@/src/utils/annveroUserStore";

export function useUserRole() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" });
      const data = await response.json();

      if (!data.authenticated) {
        setAuthenticated(false);
        setProfile(null);
        setIsAdmin(false);
        return;
      }

      if (data.active === false) {
        setAuthenticated(true);
        setProfile(null);
        return;
      }

      setAuthenticated(true);
      setIsAdmin(Boolean(data.isAdmin));
      setProfile(data.profile || null);

      if (data.profile?.role && typeof window !== "undefined") {
        localStorage.setItem(ANNVERO_ROLE_STORAGE_KEY, data.profile.role);
      }
      if (data.profile) upsertCachedUser(data.profile);
    } catch {
      if (typeof window !== "undefined") {
        const storedRole = localStorage.getItem(ANNVERO_ROLE_STORAGE_KEY) || "";
        setProfile({ role: storedRole, companyIds: [], permissions: [] });
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
    isAdmin,
    authenticated,
    loading,
    refresh: loadProfile,
    setRole,
    canAccessRoute: (pathname) => canAccessRoute(role, pathname),
    canSeeNavGroup: (groupTitle) => canSeeNavGroup(role, groupTitle),
    canAccessCompany: (companyId) => checkCompanyAccess(role, companyId, access.companyIds),
    canAccessModule: access.canAccessModule,
    hasPermission: access.hasPermission,
    isActive: access.isActive,
  };
}
