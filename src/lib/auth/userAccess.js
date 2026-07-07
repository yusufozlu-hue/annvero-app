import { isAdminUser } from "@/src/lib/auth/admin";
import {
  canAccessCompany,
  canAccessModule,
  getDefaultPermissionsForRole,
  getModulesForRole,
  hasPermission,
} from "@/src/lib/auth/permissions";
import { ANNVERO_ROLES, resolveUserRole } from "@/src/config/annveroRoles";

export function buildFallbackProfile(user) {
  const isAdmin = isAdminUser(user);
  const role = resolveUserRole({ isAdmin, storedRole: "" });
  return {
    id: user?.id || "",
    email: user?.email || "",
    displayName: user?.user_metadata?.full_name || user?.email || "",
    role,
    permissions: getDefaultPermissionsForRole(role),
    companyIds: [],
    teamId: "",
    isActive: true,
    lastLoginAt: new Date().toISOString(),
    source: "fallback",
  };
}

export function mergeProfileWithAuth(user, profile = null) {
  if (!user) return null;

  const fallback = buildFallbackProfile(user);
  if (!profile) return fallback;

  const role = profile.isActive === false
    ? ANNVERO_ROLES.VIEWER
    : resolveUserRole({
        isAdmin: isAdminUser(user),
        storedRole: profile.role || fallback.role,
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
    modules: getModulesForRole(role),
    source: profile.source || "database",
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
    canAccessRoute: (pathname, routeChecker) => routeChecker(role, pathname),
    canAccessCompany: (companyId) => canAccessCompany(role, companyId, companyIds),
    canAccessModule: (moduleId) => canAccessModule(role, moduleId, permissions),
    hasPermission: (permission) => hasPermission(role, permission, permissions),
    isActive: profile?.isActive !== false,
  };
}
