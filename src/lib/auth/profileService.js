import { isAdminUser, getAnnveroRoleFromUser } from "@/src/lib/auth/admin";
import { getDefaultPermissionsForRole } from "@/src/lib/auth/permissions";
import { ANNVERO_ROLES } from "@/src/config/annveroRoles";
import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
} from "@/src/lib/supabase/serverAdmin";
import {
  mapProfileRow,
  mapProfileToRecord,
  USER_PROFILES_TABLE,
  isUserProfilesSchemaCacheError,
} from "@/src/lib/supabase/userProfilesSchema";

function getAdminClient() {
  const guard = getServerSupabaseAdminGuardResponse("auth:profiles", USER_PROFILES_TABLE);
  if (guard) return { supabase: null, schemaMissing: true };
  return {
    supabase: getServerSupabaseAdmin({ requireServiceRole: true }),
    schemaMissing: false,
  };
}

export async function fetchProfileByEmail(email = "") {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return { profile: null, schemaMissing: false, error: null };

  const { supabase, schemaMissing } = getAdminClient();
  if (schemaMissing) return { profile: null, schemaMissing: true, error: null };
  if (!supabase) return { profile: null, schemaMissing: true, error: null };

  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("*")
    .ilike("email", normalized)
    .maybeSingle();

  if (error) {
    if (isUserProfilesSchemaCacheError(error)) {
      return { profile: null, schemaMissing: true, error: null };
    }
    return { profile: null, schemaMissing: false, error };
  }

  return { profile: data ? mapProfileRow(data) : null, schemaMissing: false, error: null };
}

export async function upsertProfile(profile = {}) {
  const { supabase, schemaMissing } = getAdminClient();
  if (schemaMissing || !supabase) {
    return { profile: null, schemaMissing: true, error: new Error("Profil tablosu kullanılamıyor.") };
  }

  const record = mapProfileToRecord(profile);
  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .upsert(record, { onConflict: "email" })
    .select("*")
    .single();

  if (error) return { profile: null, schemaMissing: false, error };
  return { profile: mapProfileRow(data), schemaMissing: false, error: null };
}

export async function syncAnnveroUserMetadata(authUserId = "", profile = {}) {
  if (!authUserId || !profile?.email) return { ok: false };

  const { supabase, schemaMissing } = getAdminClient();
  if (schemaMissing || !supabase) return { ok: false };

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
  const { supabase, schemaMissing } = getAdminClient();
  if (schemaMissing || !supabase) {
    return { invited: false, schemaMissing: true, error: new Error("Supabase admin kullanılamıyor.") };
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
  const { supabase, schemaMissing } = getAdminClient();
  if (schemaMissing || !supabase) {
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

export async function provisionProfileForUser(user) {
  if (!user?.email) {
    return { profile: null, schemaMissing: false, created: false, needsInvite: false };
  }

  const existing = await fetchProfileByEmail(user.email);
  if (existing.schemaMissing) {
    return { profile: null, schemaMissing: true, created: false, needsInvite: false };
  }

  if (existing.profile) {
    const linked = {
      ...existing.profile,
      id: user.id,
      lastLoginAt: new Date().toISOString(),
    };
    const saved = await upsertProfile(linked);
    if (saved.profile) await syncAnnveroUserMetadata(user.id, saved.profile);
    return { profile: saved.profile || linked, schemaMissing: false, created: false, needsInvite: false };
  }

  const metadataRole = getAnnveroRoleFromUser(user);
  const canAutoProvision = isAdminUser(user) || (metadataRole && metadataRole !== "");

  if (!canAutoProvision) {
    return { profile: null, schemaMissing: false, created: false, needsInvite: true };
  }

  const role = isAdminUser(user)
    ? ANNVERO_ROLES.ADMIN
    : metadataRole;

  const draft = {
    id: user.id,
    email: user.email,
    displayName: user.user_metadata?.display_name || user.email,
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
  if (saved.profile) await syncAnnveroUserMetadata(user.id, saved.profile);
  return {
    profile: saved.profile || draft,
    schemaMissing: false,
    created: true,
    needsInvite: false,
    error: saved.error,
  };
}

export async function touchLastLogin(user, profile) {
  if (!user?.id || !profile?.email) return;
  await upsertProfile({
    ...profile,
    id: user.id,
    email: user.email,
    lastLoginAt: new Date().toISOString(),
  });
}
