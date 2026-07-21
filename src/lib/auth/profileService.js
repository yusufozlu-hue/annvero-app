import { isAdminUser, getAnnveroRoleFromUser, isOwnerEmail } from "@/src/lib/auth/admin";
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

  const role = profile.role || ANNVERO_ROLES.ACCOUNTING;
  // user_metadata: bilgilendirici (yetki kaynağı değil)
  // app_metadata: yalnız service_role yazar — admin AND kapısının güvenilir ayağı
  const { error } = await supabase.auth.admin.updateUserById(authUserId, {
    user_metadata: {
      display_name: profile.displayName || profile.email,
      team_id: profile.teamId || "",
      // company_ids / role user_metadata'ya YAZILMAZ (yetki claim sızıntısı)
    },
    app_metadata: {
      annvero_role: role,
      role:
        role === ANNVERO_ROLES.ADMIN
          ? "admin"
          : role === ANNVERO_ROLES.PARTNER
            ? "partner"
            : role,
    },
  });

  return { ok: !error, error };
}

function isLocalHostUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "[::1]"
    );
  } catch {
    return /localhost|127\.0\.0\.1/i.test(String(value || ""));
  }
}

function getSiteUrl(redirectTo = "") {
  const productionFallback = "https://www.annvero.com";
  const isProd = process.env.NODE_ENV === "production";

  if (redirectTo) {
    const cleaned = redirectTo.replace(/\/$/, "");
    if (isProd && isLocalHostUrl(cleaned)) return productionFallback;
    return cleaned;
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    const cleaned = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
    if (isProd && isLocalHostUrl(cleaned)) return productionFallback;
    return cleaned;
  }
  if (process.env.VERCEL_URL) {
    const url = process.env.VERCEL_URL;
    return url.startsWith("http") ? url.replace(/\/$/, "") : `https://${url}`;
  }
  // Production'da asla localhost'a düşme.
  if (isProd) return productionFallback;
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
  const callbackUrl = `${siteUrl}/auth/callback`;

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
  const callbackUrl = `${siteUrl}/auth/callback`;

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

function resolveProvisionRole(user, { isFirstUser = false, hasAdminProfile = true } = {}) {
  if (isAdminUser(user) || isFirstUser || !hasAdminProfile) {
    return ANNVERO_ROLES.ADMIN;
  }

  const metadataRole = getAnnveroRoleFromUser(user);
  if (metadataRole && ANNVERO_ROLE_LABELS[metadataRole]) {
    return metadataRole;
  }

  return ANNVERO_ROLES.ACCOUNTING;
}

async function countUserProfiles() {
  const { supabase, adminUnavailable, schemaMissing } = getAdminClient();
  if (adminUnavailable || schemaMissing || !supabase) return -1;

  const { count, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("id", { count: "exact", head: true });

  if (error) {
    logSupabaseQueryError("auth:profiles:count", error, USER_PROFILES_TABLE);
    return -1;
  }

  return count ?? 0;
}

async function hasAdminProfileInDb() {
  const { supabase, adminUnavailable, schemaMissing } = getAdminClient();
  if (adminUnavailable || schemaMissing || !supabase) return false;

  const { count, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("role", ANNVERO_ROLES.ADMIN);

  if (error) {
    logSupabaseQueryError("auth:profiles:has-admin", error, USER_PROFILES_TABLE);
    return false;
  }

  return (count ?? 0) > 0;
}

function buildOwnerProfileDraft(user, overrides = {}) {
  const role = ANNVERO_ROLES.ADMIN;
  return {
    id: user.id,
    email: String(user.email).trim().toLowerCase(),
    displayName:
      overrides.displayName ||
      user.user_metadata?.display_name ||
      user.user_metadata?.full_name ||
      user.email,
    role,
    permissions: getDefaultPermissionsForRole(role),
    companyIds: [],
    teamId: user.user_metadata?.team_id || "",
    isActive: true,
    lastLoginAt: new Date().toISOString(),
    ...overrides,
  };
}

async function getFirstProfileEmail() {
  const { supabase, adminUnavailable, schemaMissing } = getAdminClient();
  if (adminUnavailable || schemaMissing || !supabase) return "";

  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("email")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    logSupabaseQueryError("auth:profiles:first-email", error, USER_PROFILES_TABLE);
    return "";
  }

  return String(data?.email || "").trim().toLowerCase();
}

function shouldPromoteToOwner(user, profileCount, hasAdminProfile, firstProfileEmail = "") {
  const email = String(user?.email || "").trim().toLowerCase();
  if (isAdminUser(user) || isOwnerEmail(email)) return true;
  if (profileCount === 0) return true;
  if (!hasAdminProfile) return true;
  if (firstProfileEmail && firstProfileEmail === email) return true;
  return false;
}

function applyOwnerPromotion(profile) {
  const role = ANNVERO_ROLES.ADMIN;
  return {
    ...profile,
    role,
    permissions: getDefaultPermissionsForRole(role),
    companyIds: [],
  };
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

  const profileCount = await countUserProfiles();
  const hasAdminProfile = await hasAdminProfileInDb();
  const isFirstUser = profileCount === 0;
  const firstProfileEmail = await getFirstProfileEmail();
  const bootstrapOwner = shouldPromoteToOwner(
    user,
    profileCount,
    hasAdminProfile,
    firstProfileEmail
  );

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
    let linked = {
      ...existing.profile,
      id: user.id,
      email: String(user.email).trim().toLowerCase(),
      displayName:
        existing.profile.displayName ||
        user.user_metadata?.display_name ||
        user.email,
      lastLoginAt: new Date().toISOString(),
    };

    if (bootstrapOwner) {
      linked = applyOwnerPromotion(linked);
    }

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
  const role = resolveProvisionRole(user, { isFirstUser, hasAdminProfile });
  const draft = bootstrapOwner
    ? buildOwnerProfileDraft(user)
    : {
        id: user.id,
        email: String(user.email).trim().toLowerCase(),
        displayName:
          user.user_metadata?.display_name || user.user_metadata?.full_name || user.email,
        role,
        permissions: getDefaultPermissionsForRole(role),
        companyIds: [],
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
