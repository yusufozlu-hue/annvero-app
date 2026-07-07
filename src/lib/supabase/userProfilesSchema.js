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

export function mapProfileRow(row = {}) {
  return {
    id: row.id || "",
    email: row.email || "",
    displayName: row.display_name || row.displayName || "",
    role: row.role || "muhasebe_personeli",
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    companyIds: Array.isArray(row.company_ids)
      ? row.company_ids
      : Array.isArray(row.companyIds)
        ? row.companyIds
        : [],
    teamId: row.team_id || row.teamId || "",
    isActive: row.is_active ?? row.isActive ?? true,
    passwordResetRequestedAt: row.password_reset_requested_at || row.passwordResetRequestedAt || "",
    lastLoginAt: row.last_login_at || row.lastLoginAt || "",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
  };
}

export function mapProfileToRecord(profile = {}) {
  return {
    id: profile.id || `user-${Date.now()}`,
    email: String(profile.email || "").trim().toLowerCase(),
    display_name: profile.displayName || profile.display_name || "",
    role: profile.role || "muhasebe_personeli",
    permissions: profile.permissions || [],
    company_ids: profile.companyIds || profile.company_ids || [],
    team_id: profile.teamId || profile.team_id || "",
    is_active: profile.isActive ?? profile.is_active ?? true,
    password_reset_requested_at: profile.passwordResetRequestedAt || null,
    last_login_at: profile.lastLoginAt || null,
    updated_at: new Date().toISOString(),
  };
}
