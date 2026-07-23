import { isAuthUserUuid, normalizeCompanyIds } from "@/src/lib/auth/companyAccessPolicy";

export const USER_PROFILES_TABLE = "annvero_user_profiles";

export function isUserProfilesSchemaCacheError(error) {
  const message = `${error?.message || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("annvero_user_profiles")
  );
}

export function getUserProfilesSchemaErrorMessage() {
  return "Kullanıcı profili tablosu henüz oluşturulmamış. supabase/migrations/011_annvero_user_profiles.sql dosyasını çalıştırın.";
}

/**
 * Profil satırı → uygulama modeli.
 * company_ids legacy uyumluluk alanıdır; authorization map'i DEĞİLDİR.
 * Runtime companyIds yalnız membership hydrate sonrası dolar (companyIdsSource=membership).
 */
export function mapProfileRow(row = {}) {
  const legacyCompanyIds = normalizeCompanyIds(
    Array.isArray(row.company_ids)
      ? row.company_ids
      : Array.isArray(row.companyIds)
        ? row.companyIds
        : []
  );
  const authUserId = String(row.auth_user_id || row.authUserId || "").trim() || "";

  return {
    id: row.id || "",
    email: row.email || "",
    displayName: row.display_name || row.displayName || "",
    role: row.role || "muhasebe_personeli",
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    // Yetki kaynağı değil — hydrate edilmeden boş
    companyIds: [],
    companyIdsSource: "none",
    legacyCompanyIds,
    authUserId: isAuthUserUuid(authUserId) ? authUserId : "",
    teamId: row.team_id || row.teamId || "",
    isActive: row.is_active ?? row.isActive ?? true,
    passwordResetRequestedAt: row.password_reset_requested_at || row.passwordResetRequestedAt || "",
    lastLoginAt: row.last_login_at || row.lastLoginAt || "",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
  };
}

export function mapProfileToRecord(profile = {}) {
  const email = String(profile.email || "").trim().toLowerCase();
  const id = profile.id || `pending-${email || Date.now()}`;
  const authFromProfile = String(profile.authUserId || profile.auth_user_id || "").trim();
  const authUserId = isAuthUserUuid(authFromProfile)
    ? authFromProfile
    : isAuthUserUuid(id)
      ? id
      : null;

  // Yazma: admin ataması companyIds veya legacy; runtime okuma bunları yetki saymaz.
  const writeCompanyIds = normalizeCompanyIds(
    Array.isArray(profile.companyIds) && profile.companyIdsSource === "membership"
      ? profile.companyIds
      : Array.isArray(profile.companyIds) && profile.companyIds.length
        ? profile.companyIds
        : Array.isArray(profile.legacyCompanyIds)
          ? profile.legacyCompanyIds
          : Array.isArray(profile.company_ids)
            ? profile.company_ids
            : []
  );

  return {
    id,
    email,
    display_name: profile.displayName || profile.display_name || "",
    role: profile.role || "muhasebe_personeli",
    permissions: Array.isArray(profile.permissions) ? profile.permissions : [],
    company_ids: writeCompanyIds,
    auth_user_id: authUserId,
    team_id: profile.teamId || profile.team_id || "",
    is_active: profile.isActive ?? profile.is_active ?? true,
    password_reset_requested_at:
      profile.passwordResetRequestedAt || profile.password_reset_requested_at || null,
    last_login_at: profile.lastLoginAt || profile.last_login_at || null,
    updated_at: new Date().toISOString(),
  };
}
