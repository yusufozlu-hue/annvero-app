/**
 * Profil provisioning ve metadata sync politikası (saf, sunucusuz).
 * Login akışı elevated app_metadata / auto-admin üretmez.
 */

import {
  getTrustedAppRole,
  isAdminUser,
  isTrustedAppAdminRole,
  isTrustedAppPartnerRole,
} from "@/src/lib/auth/admin";
import { ANNVERO_ROLE_LABELS, ANNVERO_ROLES } from "@/src/config/annveroRoles";

/**
 * Yeni profil her zaman güvenli non-elevated role ile oluşur.
 * first-user / no-admin / owner-email / AND-admin → admin üretmez.
 */
export function resolveProvisionRole(user) {
  const metadataRole = getTrustedAppRole(user);
  if (
    metadataRole &&
    ANNVERO_ROLE_LABELS[metadataRole] &&
    !isTrustedAppAdminRole(metadataRole) &&
    !isTrustedAppPartnerRole(metadataRole)
  ) {
    return metadataRole;
  }

  return ANNVERO_ROLES.ACCOUNTING;
}

/**
 * Auto-admin promotion kapalı — her zaman false.
 */
export function shouldPromoteToOwner() {
  return false;
}

/**
 * Elevated (admin/partner) app_metadata login akışında ASLA yazılmaz.
 */
export function buildAnnveroMetadataUpdatePayload(profile = {}) {
  const role = profile.role || ANNVERO_ROLES.ACCOUNTING;
  const elevated =
    role === ANNVERO_ROLES.ADMIN ||
    role === ANNVERO_ROLES.PARTNER ||
    isTrustedAppAdminRole(role) ||
    isTrustedAppPartnerRole(role);

  const payload = {
    user_metadata: {
      display_name: profile.displayName || profile.email,
      team_id: profile.teamId || "",
    },
  };

  if (!elevated) {
    payload.app_metadata = {
      annvero_role: role,
      role,
    };
  }

  return { payload, skippedElevatedAppMetadata: elevated };
}

/** Owner/admin email tek başına bootstrap yetkisi VERMEZ. */
export function isBootstrapOwnerEmail() {
  return false;
}

/** Yalnız zaten AND platform admin → profil senkron adayı. */
export function shouldBootstrapAsAdmin(user) {
  return isAdminUser(user);
}
