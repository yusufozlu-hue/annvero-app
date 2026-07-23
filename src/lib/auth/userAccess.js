import {
  getTrustedAppRole,
  isManagementUser,
  isOwnerEmail,
  isPlatformAdmin,
  isTrustedAppAdminRole,
  isTrustedAppPartnerRole,
} from "@/src/lib/auth/admin";
import {
  canAccessCompany,
  canAccessModule,
  getDefaultPermissionsForRole,
  getModulesForRole,
  hasPermission,
} from "@/src/lib/auth/permissions";
import { ANNVERO_ROLES, resolveUserRole } from "@/src/config/annveroRoles";

/**
 * DB profile admin/partner tek başına elevated yetki VERMEZ.
 * Trusted kapı yoksa viewer'a indir.
 */
export function demoteUntrustedElevatedRole(profileRole = "", user = null) {
  const role = String(profileRole || "").trim();
  const elevated =
    role === ANNVERO_ROLES.ADMIN ||
    role === ANNVERO_ROLES.PARTNER ||
    isTrustedAppAdminRole(role) ||
    isTrustedAppPartnerRole(role);

  if (!elevated) return role || "";

  if (isPlatformAdmin(user)) return ANNVERO_ROLES.ADMIN;
  if (isTrustedAppPartnerRole(getTrustedAppRole(user))) return ANNVERO_ROLES.PARTNER;

  return ANNVERO_ROLES.VIEWER;
}

/**
 * Profil yok / hata — fail-closed kısıtlı profil.
 * user_metadata.role / company_ids ASLA yetki kaynağı değildir.
 */
export function buildFallbackProfile(user, { schemaMissing = false } = {}) {
  const isAdmin = isPlatformAdmin(user);
  const trustedAppRole = getTrustedAppRole(user);
  const trustedPartner = isTrustedAppPartnerRole(trustedAppRole);

  const safeRole = isAdmin
    ? ANNVERO_ROLES.ADMIN
    : trustedPartner
      ? ANNVERO_ROLES.PARTNER
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
    companyIds: [],
    companyIdsSource: "none",
    teamId: "",
    isActive: true,
    lastLoginAt: new Date().toISOString(),
    source: schemaMissing ? "fallback" : "restricted",
    isPlatformAdmin: isAdmin,
    isPartner: trustedPartner && !isAdmin,
    isManagementUser: isAdmin || trustedPartner || isManagementUser(user),
    needsInvite: !schemaMissing && !isAdmin && !trustedPartner,
  };
}

export function mergeProfileWithAuth(user, profile = null, options = {}) {
  if (!user) return null;

  if (!profile) {
    return buildFallbackProfile(user, options);
  }

  const platformAdmin = isPlatformAdmin(user);
  const trustedAppRole = getTrustedAppRole(user);
  const trustedPartner = isTrustedAppPartnerRole(trustedAppRole);
  const trustedManagement = platformAdmin || trustedPartner || isManagementUser(user);

  const rawProfileRole =
    profile.isActive === false ? ANNVERO_ROLES.VIEWER : profile.role || "";
  const safeProfileRole = demoteUntrustedElevatedRole(rawProfileRole, user);

  const role = resolveUserRole({
    isAdmin: platformAdmin,
    storedRole: trustedPartner ? ANNVERO_ROLES.PARTNER : "",
    profileRole: platformAdmin || trustedPartner ? "" : safeProfileRole,
  });

  const effectiveRole = platformAdmin
    ? ANNVERO_ROLES.ADMIN
    : trustedPartner
      ? ANNVERO_ROLES.PARTNER
      : role === ANNVERO_ROLES.ADMIN || role === ANNVERO_ROLES.PARTNER
        ? ANNVERO_ROLES.VIEWER
        : role;

  // Firma yetkisi: yalnız membership-derived (companyIdsSource === "membership")
  // Legacy profile.company_ids / metadata ASLA kopyalanmaz.
  const membershipDerived =
    profile.companyIdsSource === "membership" ||
    profile.companyIdsSource === "elevated_trusted";
  const companyIds = membershipDerived
    ? Array.isArray(profile.companyIds)
      ? profile.companyIds
      : []
    : [];

  return {
    id: user.id || profile.id,
    email: String(profile.email || user.email || "").trim().toLowerCase(),
    displayName:
      profile.displayName ||
      user.user_metadata?.display_name ||
      user.user_metadata?.full_name ||
      user.email ||
      "",
    role: effectiveRole,
    permissions:
      Array.isArray(profile.permissions) &&
      profile.permissions.length &&
      effectiveRole === safeProfileRole &&
      !platformAdmin &&
      !trustedPartner
        ? profile.permissions
        : getDefaultPermissionsForRole(effectiveRole),
    companyIds,
    companyIdsSource: membershipDerived ? profile.companyIdsSource : "none",
    teamId: profile.teamId || "",
    isActive: profile.isActive !== false,
    lastLoginAt: profile.lastLoginAt || new Date().toISOString(),
    modules: getModulesForRole(effectiveRole),
    source: "database",
    isPlatformAdmin: platformAdmin,
    isPartner: trustedPartner && !platformAdmin,
    isManagementUser: trustedManagement,
    needsInvite: false,
  };
}

function hasEffectiveCompanyAccess(profile = {}) {
  if (profile.isPlatformAdmin || profile.isManagementUser) return true;
  if (profile.companyIdsSource !== "membership") return false;
  const companyIds = Array.isArray(profile.companyIds) ? profile.companyIds : [];
  return companyIds.length > 0;
}

function isElevatedAccess(profile = {}) {
  if (!profile) return false;
  return Boolean(profile.isPlatformAdmin || profile.isManagementUser);
}

export function getAccessWarningReason(profile = null) {
  if (!profile) return "no_profile";
  if (profile.source === "fallback") return "hidden_network_fallback";
  if (profile.isPlatformAdmin) return "hidden_platform_admin";
  if (profile.isManagementUser) return "hidden_management_user";

  const role = profile.role || "";
  if (!role) return "empty_role";

  // Canonical membership önce değerlendirilir — role=goruntuleme tek başına uyarı DEĞİLDİR.
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
    reason === "restricted_no_company_access" ||
    reason === "no_company_access"
  );
}

/**
 * Access nesnesi — role string tek başına elevated VERMEZ.
 * Trusted flag'ler mergeProfileWithAuth / AND kapısından gelir.
 */
export function createUserAccess(profile) {
  const email = profile?.email || "";
  const isPlatformAdminFlag = Boolean(profile?.isPlatformAdmin);
  const isManagementFlag =
    Boolean(profile?.isManagementUser) || isPlatformAdminFlag;
  const isPartnerFlag = Boolean(profile?.isPartner) && !isPlatformAdminFlag;

  let role = profile?.role || ANNVERO_ROLES.VIEWER;
  if (
    (role === ANNVERO_ROLES.ADMIN || role === ANNVERO_ROLES.PARTNER) &&
    !isPlatformAdminFlag &&
    !isManagementFlag
  ) {
    role = ANNVERO_ROLES.VIEWER;
  }
  if (isPlatformAdminFlag) role = ANNVERO_ROLES.ADMIN;
  else if (isPartnerFlag || (isManagementFlag && !isPlatformAdminFlag)) {
    if (role !== ANNVERO_ROLES.PARTNER && isPartnerFlag) {
      role = ANNVERO_ROLES.PARTNER;
    }
  }

  const permissions =
    (Array.isArray(profile?.permissions) && profile.permissions.length
      ? profile.permissions
      : null) || getDefaultPermissionsForRole(role);
  const companyIds =
    profile?.companyIdsSource === "membership" ||
    profile?.companyIdsSource === "elevated_trusted" ||
    isPlatformAdminFlag ||
    isManagementFlag
      ? Array.isArray(profile?.companyIds)
        ? profile.companyIds
        : []
      : [];

  return {
    role,
    permissions,
    companyIds,
    companyIdsSource:
      isPlatformAdminFlag || isManagementFlag
        ? "elevated_trusted"
        : profile?.companyIdsSource === "membership"
          ? "membership"
          : "none",
    modules: getModulesForRole(role),
    isPlatformAdmin: isPlatformAdminFlag,
    isPartner: isPartnerFlag,
    isManagementUser: isManagementFlag,
    canAccessRoute: (pathname, routeChecker) => routeChecker(role, pathname),
    canAccessCompany: (companyId) => {
      if (isPlatformAdminFlag || isManagementFlag) return true;
      if (!companyId) return true;
      return canAccessCompany(role, companyId, companyIds);
    },
    canAccessModule: (moduleId) => canAccessModule(role, moduleId, permissions),
    hasPermission: (permission) => hasPermission(role, permission, permissions),
    isActive: profile?.isActive !== false,
    usingFallback: profile?.source === "fallback" || profile?.source === "fallback_restricted",
    showAccessWarning: isManagementFlag
      ? false
      : shouldShowAccessWarning({ ...profile, role, email, companyIds }),
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
    Boolean(profile?.isPartner) ||
    (isTrustedAppPartnerRole(getTrustedAppRole(user)) && !isAdmin);
  const isPlatformAdminFlag = isAdmin;

  let showAccessWarning = shouldShowAccessWarning({ ...profile, role, email });
  let warningReason = getAccessWarningReason({ ...profile, role, email });

  if (isAdmin || isPartner) {
    showAccessWarning = false;
    if (isPartner) warningReason = "forced_false_partner";
    else warningReason = "forced_false_admin";
  }

  return {
    email,
    role,
    isAdmin,
    isPartner,
    isPlatformAdmin: isPlatformAdminFlag,
    companyIds: Array.isArray(profile?.companyIds) ? profile.companyIds : [],
    companyIdsSource: profile?.companyIdsSource || "none",
    showAccessWarning,
    warningReason,
    ownerEmailAloneNotAdmin: isOwnerEmail(email) && !isAdmin,
  };
}
