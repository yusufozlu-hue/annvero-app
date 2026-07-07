import { getAnnveroRoleFromUser, isManagementUser, isPlatformAdmin } from "@/src/lib/auth/admin";
import {
  canAccessCompany,
  canAccessModule,
  getDefaultPermissionsForRole,
  getModulesForRole,
  hasPermission,
} from "@/src/lib/auth/permissions";
import { ANNVERO_ROLES, resolveUserRole } from "@/src/config/annveroRoles";

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
    source: schemaMissing ? "fallback" : "fallback_restricted",
    isPlatformAdmin: isAdmin,
    isPartner: safeRole === ANNVERO_ROLES.PARTNER,
    isManagementUser: isManagementUser(user) || safeRole === ANNVERO_ROLES.PARTNER,
    needsInvite: !schemaMissing && !isAdmin && !metadataRole,
  };
}

export function mergeProfileWithAuth(user, profile = null, options = {}) {
  if (!user) return null;

  const fallback = buildFallbackProfile(user, options);
  if (!profile) return fallback;

  const profileRole = profile.isActive === false ? ANNVERO_ROLES.VIEWER : profile.role || "";
  const role = resolveUserRole({
    isAdmin: isPlatformAdmin(user),
    storedRole: getAnnveroRoleFromUser(user),
    profileRole,
  });

  return {
    ...fallback,
    ...profile,
    id: user.id || profile.id,
    email: profile.email || user.email,
    role,
    permissions:
      Array.isArray(profile.permissions) && profile.permissions.length
        ? profile.permissions
        : getDefaultPermissionsForRole(role),
    companyIds: Array.isArray(profile.companyIds) ? profile.companyIds : [],
    modules: getModulesForRole(role),
    source: profile.source || "database",
    isPlatformAdmin: isPlatformAdmin(user),
    isPartner: role === ANNVERO_ROLES.PARTNER,
    isManagementUser:
      isManagementUser(user) ||
      role === ANNVERO_ROLES.PARTNER ||
      role === ANNVERO_ROLES.ADMIN,
    needsInvite: false,
  };
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
    isManagementUser: Boolean(profile?.isManagementUser) || role === ANNVERO_ROLES.PARTNER || role === ANNVERO_ROLES.ADMIN,
    canAccessRoute: (pathname, routeChecker) => routeChecker(role, pathname),
    canAccessCompany: (companyId) => canAccessCompany(role, companyId, companyIds),
    canAccessModule: (moduleId) => canAccessModule(role, moduleId, permissions),
    hasPermission: (permission) => hasPermission(role, permission, permissions),
    isActive: profile?.isActive !== false,
    usingFallback: profile?.source === "fallback",
  };
}
