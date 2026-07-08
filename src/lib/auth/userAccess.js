import { getAnnveroRoleFromUser, isManagementUser, isPlatformAdmin } from "@/src/lib/auth/admin";
import {
  canAccessCompany,
  canAccessModule,
  getDefaultPermissionsForRole,
  getModulesForRole,
  hasPermission,
} from "@/src/lib/auth/permissions";
import { ANNVERO_ROLES, resolveUserRole } from "@/src/config/annveroRoles";

const ELEVATED_ROLES = new Set([
  ANNVERO_ROLES.ADMIN,
  ANNVERO_ROLES.PARTNER,
  ANNVERO_ROLES.MANAGER,
]);

export function buildFallbackProfile(user, { schemaMissing = false } = {}) {
  const isAdmin = isPlatformAdmin(user);
  const metadataRole = getAnnveroRoleFromUser(user);
  const role = resolveUserRole({
    isAdmin,
    storedRole: metadataRole,
    profileRole: "",
  });

  const safeRole =
    schemaMissing || isAdmin || metadataRole
      ? role
      : ANNVERO_ROLES.VIEWER;

  return {
    id: user?.id || "",
    email: user?.email || "",
    displayName:
      user?.user_metadata?.display_name ||
      user?.user_metadata?.full_name ||
      user?.email ||
      "",
    role: safeRole,
    permissions: getDefaultPermissionsForRole(safeRole),
    companyIds: Array.isArray(user?.user_metadata?.company_ids)
      ? user.user_metadata.company_ids
      : [],
    teamId: user?.user_metadata?.team_id || "",
    isActive: true,
    lastLoginAt: new Date().toISOString(),
    source: schemaMissing ? "fallback" : "restricted",
    isPlatformAdmin: isAdmin,
    isPartner: safeRole === ANNVERO_ROLES.PARTNER,
    isManagementUser: isManagementUser(user) || safeRole === ANNVERO_ROLES.PARTNER,
    needsInvite: !schemaMissing && !isAdmin && !metadataRole,
  };
}

export function mergeProfileWithAuth(user, profile = null, options = {}) {
  if (!user) return null;

  if (!profile) {
    return buildFallbackProfile(user, options);
  }

  const profileRole = profile.isActive === false ? ANNVERO_ROLES.VIEWER : profile.role || "";
  const role = resolveUserRole({
    isAdmin: isPlatformAdmin(user),
    storedRole: "",
    profileRole,
  });

  const isPartner = role === ANNVERO_ROLES.PARTNER;
  const isManagement =
    isManagementUser(user) ||
    role === ANNVERO_ROLES.PARTNER ||
    role === ANNVERO_ROLES.ADMIN;

  return {
    id: user.id || profile.id,
    email: String(profile.email || user.email || "").trim().toLowerCase(),
    displayName:
      profile.displayName ||
      user.user_metadata?.display_name ||
      user.user_metadata?.full_name ||
      user.email ||
      "",
    role,
    permissions:
      Array.isArray(profile.permissions) && profile.permissions.length
        ? profile.permissions
        : getDefaultPermissionsForRole(role),
    companyIds: Array.isArray(profile.companyIds) ? profile.companyIds : [],
    teamId: profile.teamId || "",
    isActive: profile.isActive !== false,
    lastLoginAt: profile.lastLoginAt || new Date().toISOString(),
    modules: getModulesForRole(role),
    source: "database",
    isPlatformAdmin: isPlatformAdmin(user),
    isPartner,
    isManagementUser: isManagement,
    needsInvite: false,
  };
}

function hasEffectiveCompanyAccess(profile = {}) {
  const role = profile.role || "";
  const companyIds = Array.isArray(profile.companyIds) ? profile.companyIds : [];

  // Admin/partner: boş company_ids = tüm firmalar
  if (role === ANNVERO_ROLES.ADMIN || role === ANNVERO_ROLES.PARTNER) {
    return true;
  }

  if (ELEVATED_ROLES.has(role)) {
    return true;
  }

  return companyIds.length > 0;
}

/** Banner: yalnızca rol boş/viewer VEYA (normal rol + firma erişimi yok) */
export function shouldShowAccessWarning(profile = null) {
  if (!profile) return false;

  if (profile.isPlatformAdmin || profile.isManagementUser) return false;
  if (profile.role === ANNVERO_ROLES.ADMIN || profile.role === ANNVERO_ROLES.PARTNER) {
    return false;
  }
  if (ELEVATED_ROLES.has(profile.role)) return false;

  const role = profile.role || "";
  if (!role || role === ANNVERO_ROLES.VIEWER) return true;

  if (profile.source === "restricted" || profile.needsInvite) {
    return !hasEffectiveCompanyAccess(profile);
  }

  if (!hasEffectiveCompanyAccess(profile)) return true;

  return false;
}

export function createUserAccess(profile) {
  const role = profile?.role || ANNVERO_ROLES.VIEWER;
  const permissions = profile?.permissions || getDefaultPermissionsForRole(role);
  const companyIds = profile?.companyIds || [];

  return {
    role,
    permissions,
    companyIds,
    modules: getModulesForRole(role),
    isPlatformAdmin: Boolean(profile?.isPlatformAdmin),
    isPartner: Boolean(profile?.isPartner) || role === ANNVERO_ROLES.PARTNER,
    isManagementUser:
      Boolean(profile?.isManagementUser) ||
      role === ANNVERO_ROLES.PARTNER ||
      role === ANNVERO_ROLES.ADMIN,
    canAccessRoute: (pathname, routeChecker) => routeChecker(role, pathname),
    canAccessCompany: (companyId) => canAccessCompany(role, companyId, companyIds),
    canAccessModule: (moduleId) => canAccessModule(role, moduleId, permissions),
    hasPermission: (permission) => hasPermission(role, permission, permissions),
    isActive: profile?.isActive !== false,
    usingFallback: profile?.source === "fallback" || profile?.source === "fallback_restricted",
    showAccessWarning: shouldShowAccessWarning(profile),
  };
}
