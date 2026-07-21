import { getTrustedAppRole, isManagementUser, isOwnerEmail, isPlatformAdmin } from "@/src/lib/auth/admin";
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

/**
 * Profil yok / hata — fail-closed kısıtlı profil.
 * user_metadata.role / company_ids ASLA yetki kaynağı değildir.
 */
export function buildFallbackProfile(user, { schemaMissing = false } = {}) {
  const isAdmin = isPlatformAdmin(user);
  const trustedAppRole = getTrustedAppRole(user);
  const role = resolveUserRole({
    isAdmin,
    storedRole: isTrustedElevatedRole(trustedAppRole) ? trustedAppRole : "",
    profileRole: "",
  });

  const safeRole = isAdmin
    ? ANNVERO_ROLES.ADMIN
    : isTrustedElevatedRole(trustedAppRole)
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
    // Tenant claim: user_metadata company_ids yok sayılır — yetki kaynağı değil
    companyIds: [],
    teamId: "",
    isActive: true,
    lastLoginAt: new Date().toISOString(),
    source: schemaMissing ? "fallback" : "restricted",
    isPlatformAdmin: isAdmin,
    isPartner: safeRole === ANNVERO_ROLES.PARTNER,
    isManagementUser: isAdmin || safeRole === ANNVERO_ROLES.PARTNER || isManagementUser(user),
    needsInvite: !schemaMissing && !isAdmin && !isTrustedElevatedRole(trustedAppRole),
  };
}

function isTrustedElevatedRole(role = "") {
  const r = String(role || "").trim().toLowerCase();
  return (
    r === ANNVERO_ROLES.ADMIN ||
    r === ANNVERO_ROLES.PARTNER ||
    r === "admin" ||
    r === "partner"
  );
}

export function mergeProfileWithAuth(user, profile = null, options = {}) {
  if (!user) return null;

  if (!profile) {
    return buildFallbackProfile(user, options);
  }

  const platformAdmin = isPlatformAdmin(user);
  const profileRole = profile.isActive === false ? ANNVERO_ROLES.VIEWER : profile.role || "";
  const role = resolveUserRole({
    isAdmin: platformAdmin,
    storedRole: "",
    profileRole,
  });

  const isPartner = role === ANNVERO_ROLES.PARTNER;
  const isManagement =
    isManagementUser(user) ||
    role === ANNVERO_ROLES.PARTNER ||
    role === ANNVERO_ROLES.ADMIN ||
    platformAdmin;

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
    isPlatformAdmin: platformAdmin || role === ANNVERO_ROLES.ADMIN,
    isPartner,
    isManagementUser: isManagement,
    needsInvite: false,
  };
}

function hasEffectiveCompanyAccess(profile = {}) {
  const role = profile.role || "";
  const companyIds = Array.isArray(profile.companyIds) ? profile.companyIds : [];

  if (role === ANNVERO_ROLES.ADMIN || role === ANNVERO_ROLES.PARTNER) {
    return true;
  }

  if (ELEVATED_ROLES.has(role)) {
    return true;
  }

  return companyIds.length > 0;
}

function isElevatedAccess(profile = {}) {
  if (!profile) return false;
  // Email allowlist tek başına elevated access VERMEZ
  if (profile.isPlatformAdmin || profile.isManagementUser) return true;
  const role = profile.role || "";
  return (
    role === ANNVERO_ROLES.ADMIN ||
    role === ANNVERO_ROLES.PARTNER ||
    ELEVATED_ROLES.has(role)
  );
}

export function getAccessWarningReason(profile = null) {
  if (!profile) return "no_profile";
  if (profile.source === "fallback") return "hidden_network_fallback";
  if (profile.isPlatformAdmin) return "hidden_platform_admin";
  if (profile.isManagementUser) return "hidden_management_user";
  if (profile.role === ANNVERO_ROLES.ADMIN) return "hidden_role_admin";
  if (profile.role === ANNVERO_ROLES.PARTNER) return "hidden_role_partner";
  if (ELEVATED_ROLES.has(profile.role)) return "hidden_elevated_role";

  const role = profile.role || "";
  if (!role) return "empty_role";
  if (role === ANNVERO_ROLES.VIEWER) return "viewer_role";
  if (profile.source === "restricted" || profile.needsInvite) {
    return hasEffectiveCompanyAccess(profile)
      ? "hidden_restricted_has_companies"
      : "restricted_no_company_access";
  }
  if (!hasEffectiveCompanyAccess(profile)) return "no_company_access";
  return "ok_no_warning";
}

export function shouldShowAccessWarning(profile = null) {
  if (!profile) return false;
  if (isElevatedAccess(profile)) return false;

  const reason = getAccessWarningReason(profile);
  return (
    reason === "empty_role" ||
    reason === "viewer_role" ||
    reason === "restricted_no_company_access" ||
    reason === "no_company_access"
  );
}

/**
 * Access nesnesi — email allowlist tek başına ADMIN role zorlamaz.
 * Platform admin flag profil/AND kapısından gelir.
 */
export function createUserAccess(profile) {
  const email = profile?.email || "";
  let role = profile?.role || ANNVERO_ROLES.VIEWER;

  const permissions =
    (Array.isArray(profile?.permissions) && profile.permissions.length
      ? profile.permissions
      : null) || getDefaultPermissionsForRole(role);
  const companyIds = Array.isArray(profile?.companyIds) ? profile.companyIds : [];
  const elevated =
    Boolean(profile?.isPlatformAdmin) ||
    Boolean(profile?.isManagementUser) ||
    role === ANNVERO_ROLES.ADMIN ||
    role === ANNVERO_ROLES.PARTNER;

  return {
    role,
    permissions,
    companyIds,
    modules: getModulesForRole(role),
    isPlatformAdmin: Boolean(profile?.isPlatformAdmin) || role === ANNVERO_ROLES.ADMIN,
    isPartner: Boolean(profile?.isPartner) || role === ANNVERO_ROLES.PARTNER,
    isManagementUser: elevated,
    canAccessRoute: (pathname, routeChecker) => routeChecker(role, pathname),
    canAccessCompany: (companyId) => canAccessCompany(role, companyId, companyIds),
    canAccessModule: (moduleId) => canAccessModule(role, moduleId, permissions),
    hasPermission: (permission) => hasPermission(role, permission, permissions),
    isActive: profile?.isActive !== false,
    usingFallback: profile?.source === "fallback" || profile?.source === "fallback_restricted",
    showAccessWarning: elevated ? false : shouldShowAccessWarning({ ...profile, role, email }),
  };
}

export function buildAccessDebugPayload(user, profile, extras = {}) {
  const email = String(user?.email || profile?.email || "").trim().toLowerCase();
  const role = profile?.role || "";

  const isAdmin =
    Boolean(extras.isAdmin) ||
    Boolean(profile?.isPlatformAdmin) ||
    isPlatformAdmin(user);
  const isPartner =
    Boolean(profile?.isPartner) || role === ANNVERO_ROLES.PARTNER;
  const isPlatformAdminFlag = isAdmin;

  let showAccessWarning = shouldShowAccessWarning({ ...profile, role, email });
  let warningReason = getAccessWarningReason({ ...profile, role, email });

  if (isAdmin || isPartner || role === ANNVERO_ROLES.ADMIN || role === ANNVERO_ROLES.PARTNER) {
    showAccessWarning = false;
    if (role === ANNVERO_ROLES.PARTNER || isPartner) warningReason = "forced_false_partner";
    else warningReason = "forced_false_admin";
  }

  return {
    email,
    role,
    isAdmin,
    isPartner,
    isPlatformAdmin: isPlatformAdminFlag,
    companyIds: Array.isArray(profile?.companyIds) ? profile.companyIds : [],
    showAccessWarning,
    warningReason,
    ownerEmailAloneNotAdmin: isOwnerEmail(email) && !isAdmin,
  };
}
