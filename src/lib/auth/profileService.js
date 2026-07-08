import { isAdminUser, getAnnveroRoleFromUser } from "@/src/lib/auth/admin";
import { getDefaultPermissionsForRole } from "@/src/lib/auth/permissions";
import { ANNVERO_ROLE_LABELS, ANNVERO_ROLES } from "@/src/config/annveroRoles";
import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";
import {
  mapProfileRow,
  mapProfileToRecord,
  USER_PROFILES_TABLE,
  isUserProfilesSchemaCacheError,
} from "@/src/lib/supabase/userProfilesSchema";

function getAdminClient() {
  const guard = getServerSupabaseAdminGuardResponse("auth:profiles", USER_PROFILES_TABLE);
  if (guard) {
    return { supabase: null, schemaMissing: false, adminUnavailable: true };
  }

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  if (!supabase) {
    return { supabase: null, schemaMissing: false, adminUnavailable: true };
  }

  return {
    supabase,
    schemaMissing: false,
    adminUnavailable: false,
  };
}

function emptyResult(overrides = {}) {
  return {
    profile: null,
    schemaMissing: false,
    adminUnavailable: false,
    error: null,
    ...overrides,
  };
}

export async function fetchProfileByEmail(email = "") {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return emptyResult();

  const { supabase, schemaMissing, adminUnavailable } = getAdminClient();
  if (adminUnavailable) return emptyResult({ adminUnavailable: true });
  if (schemaMissing) return emptyResult({ schemaMissing: true });
  if (!supabase) return emptyResult({ adminUnavailable: true });

  // Case-insensitive exact match (no wildcards) — emails DB'de karışık büyük/küçük olabilir.
  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("*")
    .ilike("email", normalized.replace(/[%_]/g, ""))
    .maybeSingle();

  if (error) {
    if (isUserProfilesSchemaCacheError(error)) {
      logSupabaseQueryError("auth:profiles:fetch", error, USER_PROFILES_TABLE);
      return emptyResult({ schemaMissing: true });
    }
    logSupabaseQueryError("auth:profiles:fetch", error, USER_PROFILES_TABLE);
    return emptyResult({ error });
  }

  return emptyResult({ profile: data ? mapProfileRow(data) : null });
}

export async function upsertProfile(profile = {}) {
  const { supabase, schemaMissing, adminUnavailable } = getAdminClient();
  if (adminUnavailable || !supabase) {
    return {
      profile: null,
      schemaMissing: false,
      adminUnavailable: true,
      error: new Error("Profil servisi kullanılamıyor (service role)."),
    };
  }
  if (schemaMissing) {
    return {
      profile: null,
      schemaMissing: true,
      adminUnavailable: false,
      error: new Error("Profil tablosu kullanılamıyor."),
    };
  }

  const record = mapProfileToRecord(profile);
  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .upsert(record, { onConflict: "email" })
    .select("*")
    .single();

  if (error) {
    logSupabaseQueryError("auth:profiles:upsert", error, USER_PROFILES_TABLE);
    return { profile: null, schemaMissing: false, adminUnavailable: false, error };
  }

  return {
    profile: mapProfileRow(data),
    schemaMissing: false,
    adminUnavailable: false,
    error: null,
  };
}

export async function syncAnnveroUserMetadata(authUserId = "", profile = {}) {
  if (!authUserId || !profile?.email) return { ok: false };

  const { supabase, schemaMissing, adminUnavailable } = getAdminClient();
  if (schemaMissing || adminUnavailable || !supabase) return { ok: false };

  const { error } = await supabase.auth.admin.updateUserById(authUserId, {
    user_metadata: {
      annvero_role: profile.role || ANNVERO_ROLES.ACCOUNTING,
      display_name: profile.displayName || profile.email,
      company_ids: profile.companyIds || [],
      team_id: profile.teamId || "",
    },
  });

  return { ok: !error, error };
}

function getSiteUrl(redirectTo = "") {
  if (redirectTo) return redirectTo.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    const url = process.env.VERCEL_URL;
    return url.startsWith("http") ? url.replace(/\/$/, "") : `https://${url}`;
  }
  return "http://localhost:3000";
}

export async function inviteAuthUser({
  email = "",
  role = ANNVERO_ROLES.ACCOUNTING,
  displayName = "",
  redirectTo = "",
} = {}) {
  const { supabase, schemaMissing, adminUnavailable } = getAdminClient();
  if (schemaMissing || adminUnavailable || !supabase) {
    return {
      invited: false,
      schemaMissing,
      adminUnavailable,
      error: new Error("Supabase admin kullanılamıyor."),
    };
  }

  const siteUrl = getSiteUrl(redirectTo);
  const callbackUrl = `${siteUrl}/auth/callback?next=${encodeURIComponent("/dashboard")}`;

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: callbackUrl,
    data: {
      annvero_role: role,
      display_name: displayName || email,
    },
  });

  if (error) return { invited: false, error, user: null };
  return { invited: true, user: data.user, error: null };
}

export async function sendPasswordRecoveryEmail(email = "", redirectTo = "") {
  const { supabase, schemaMissing, adminUnavailable } = getAdminClient();
  if (schemaMissing || adminUnavailable || !supabase) {
    return { sent: false, error: new Error("Supabase admin kullanılamıyor.") };
  }

  const siteUrl = getSiteUrl(redirectTo);
  const callbackUrl = `${siteUrl}/auth/callback?next=${encodeURIComponent("/login")}`;

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: String(email).trim().toLowerCase(),
    options: { redirectTo: callbackUrl },
  });

  if (error) return { sent: false, error };

  const actionLink = data?.properties?.action_link || "";
  if (actionLink && process.env.NODE_ENV !== "production") {
    console.info("[auth] recovery link (dev):", actionLink);
  }

  return { sent: true, error: null, actionLink };
}

function resolveProvisionRole(user) {
  if (isAdminUser(user)) return ANNVERO_ROLES.ADMIN;

  const metadataRole = getAnnveroRoleFromUser(user);
  if (metadataRole && ANNVERO_ROLE_LABELS[metadataRole]) {
    return metadataRole;
  }

  return ANNVERO_ROLES.ACCOUNTING;
}

export async function provisionProfileForUser(user) {
  if (!user?.email) {
    return {
      profile: null,
      schemaMissing: false,
      adminUnavailable: false,
      created: false,
      needsInvite: false,
    };
  }

  const existing = await fetchProfileByEmail(user.email);
  if (existing.schemaMissing || existing.adminUnavailable) {
    return {
      profile: null,
      schemaMissing: Boolean(existing.schemaMissing),
      adminUnavailable: Boolean(existing.adminUnavailable),
      created: false,
      needsInvite: false,
    };
  }

  if (existing.error && !existing.profile) {
    return {
      profile: null,
      schemaMissing: false,
      adminUnavailable: false,
      created: false,
      needsInvite: false,
      error: existing.error,
    };
  }

  // Mevcut profil (pending-* dahil) → auth user id'ye bağla
  if (existing.profile) {
    const linked = {
      ...existing.profile,
      id: user.id,
      email: String(user.email).trim().toLowerCase(),
      displayName:
        existing.profile.displayName ||
        user.user_metadata?.display_name ||
        user.email,
      lastLoginAt: new Date().toISOString(),
    };
    const saved = await upsertProfile(linked);
    if (saved.profile) {
      await syncAnnveroUserMetadata(user.id, saved.profile);
      return {
        profile: saved.profile,
        schemaMissing: false,
        adminUnavailable: false,
        created: false,
        needsInvite: false,
      };
    }
    // Upsert başarısız olsa bile mevcut DB profilini kullan
    return {
      profile: linked,
      schemaMissing: false,
      adminUnavailable: Boolean(saved.adminUnavailable),
      created: false,
      needsInvite: false,
      error: saved.error,
    };
  }

  // İlk login: Auth kullanıcısı için otomatik profil oluştur
  const role = resolveProvisionRole(user);
  const draft = {
    id: user.id,
    email: String(user.email).trim().toLowerCase(),
    displayName: user.user_metadata?.display_name || user.user_metadata?.full_name || user.email,
    role,
    permissions: getDefaultPermissionsForRole(role),
    companyIds: Array.isArray(user.user_metadata?.company_ids)
      ? user.user_metadata.company_ids
      : [],
    teamId: user.user_metadata?.team_id || "",
    isActive: true,
    lastLoginAt: new Date().toISOString(),
  };

  const saved = await upsertProfile(draft);
  if (saved.profile) {
    await syncAnnveroUserMetadata(user.id, saved.profile);
    return {
      profile: saved.profile,
      schemaMissing: false,
      adminUnavailable: false,
      created: true,
      needsInvite: false,
    };
  }

  return {
    profile: null,
    schemaMissing: Boolean(saved.schemaMissing),
    adminUnavailable: Boolean(saved.adminUnavailable),
    created: false,
    needsInvite: false,
    error: saved.error,
  };
}

export async function touchLastLogin(user, profile) {
  if (!user?.id || !profile?.email) return { ok: false };

  const result = await upsertProfile({
    ...profile,
    id: user.id,
    email: user.email,
    lastLoginAt: new Date().toISOString(),
  });

  return { ok: Boolean(result.profile), error: result.error };
}
