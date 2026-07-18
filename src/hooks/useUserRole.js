"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ANNVERO_ROLE_STORAGE_KEY,
  canAccessRoute,
  canSeeNavGroup,
  canSeeNavItem,
} from "@/src/config/annveroRoles";
import { createUserAccess } from "@/src/lib/auth/userAccess";
import { canAccessCompany as checkCompanyAccess } from "@/src/lib/auth/permissions";
import {
  invalidateAuthMeCache,
  fetchAuthMe,
  peekAuthMeCache,
} from "@/src/lib/auth/authMeClient";
import { emitAuthInvalid } from "@/src/components/authGateCache";
import { upsertCachedUser } from "@/src/utils/annveroUserStore";

const STALE_ACCESS_KEYS = [
  "annvero_show_access_warning",
  "annvero_needs_invite",
  "annvero_missing_company_access",
  "annvero_access_warning_v1",
];

const UserRoleContext = createContext(null);

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

function useUserRoleState() {
  const cached = typeof window !== "undefined" ? peekAuthMeCache() : null;
  const [profile, setProfile] = useState(() => cached?.data?.profile || null);
  const [loading, setLoading] = useState(() => !cached?.data?.authenticated);
  const [authenticated, setAuthenticated] = useState(() =>
    Boolean(cached?.data?.authenticated)
  );
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(() =>
    Boolean(cached?.data?.isPlatformAdmin || cached?.data?.isAdmin)
  );
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [needsInvite, setNeedsInvite] = useState(false);
  const [apiShowAccessWarning, setApiShowAccessWarning] = useState(false);
  const [accountActive, setAccountActive] = useState(true);
  const [email, setEmail] = useState(() => cached?.data?.email || "");

  const loadProfile = useCallback(async (options = {}) => {
    const force = Boolean(options.force);
    const existing = !force ? peekAuthMeCache() : null;
    if (!existing) setLoading(true);
    clearStaleAccessFlags();
    try {
      const { response, data } = await fetchAuthMe({ force });

      if (!data.authenticated) {
        setAuthenticated(false);
        setProfile(null);
        setIsPlatformAdmin(false);
        setSchemaMissing(false);
        setUsingFallback(false);
        setNeedsInvite(false);
        setApiShowAccessWarning(false);
        setAccountActive(true);
        setEmail("");
        invalidateAuthMeCache();
        emitAuthInvalid();
        return;
      }

      if (data.active === false || response.status === 403) {
        setAuthenticated(true);
        setProfile(null);
        setUsingFallback(false);
        setNeedsInvite(false);
        setApiShowAccessWarning(false);
        setAccountActive(false);
        setEmail(data.email || "");
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
      setIsPlatformAdmin(
        Boolean(data.isPlatformAdmin ?? data.isAdmin) || role === "admin"
      );
      setSchemaMissing(Boolean(data.schemaMissing));
      setUsingFallback(
        Boolean(
          data.usingFallback && (data.schemaMissing || data.adminUnavailable)
        )
      );
      setNeedsInvite(elevated ? false : Boolean(data.needsInvite));
      setApiShowAccessWarning(
        elevated ? false : data.showAccessWarning === true
      );
      setAccountActive(true);
      setProfile(nextProfile);
      setEmail(data.email || nextProfile?.email || "");

      if (nextProfile?.role && typeof window !== "undefined") {
        localStorage.setItem(ANNVERO_ROLE_STORAGE_KEY, nextProfile.role);
      }
      if (nextProfile) upsertCachedUser(nextProfile);
    } catch {
      clearStaleAccessFlags();
      // Ağ hatasında localStorage rolünden sahte oturum üretme.
      setAuthenticated(false);
      setProfile(null);
      setIsPlatformAdmin(false);
      setUsingFallback(false);
      setApiShowAccessWarning(false);
      setEmail("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadProfile();
    });
    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  const access = useMemo(() => createUserAccess(profile || {}), [profile]);
  const role = access.role;

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
    email,
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
    refresh: () => {
      invalidateAuthMeCache();
      return loadProfile({ force: true });
    },
    setRole,
    canAccessRoute: (pathname) => canAccessRoute(role, pathname),
    canSeeNavGroup: (groupTitle) => canSeeNavGroup(role, groupTitle),
    canSeeNavItem: (item) => canSeeNavItem(role, item),
    canAccessCompany: (companyId) =>
      checkCompanyAccess(role, companyId, access.companyIds),
    canAccessModule: access.canAccessModule,
    hasPermission: access.hasPermission,
    isActive: accountActive && access.isActive,
  };
}

export function UserRoleProvider({ children }) {
  const value = useUserRoleState();
  return (
    <UserRoleContext.Provider value={value}>{children}</UserRoleContext.Provider>
  );
}

/** Ortak rol/profil — UserRoleProvider içinde tek /api/auth/me paylaşılır. */
export function useUserRole() {
  const ctx = useContext(UserRoleContext);
  if (!ctx) {
    throw new Error("useUserRole must be used within UserRoleProvider");
  }
  return ctx;
}
