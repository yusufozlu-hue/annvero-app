import { isAdminEmail, isAdminUser, isOwnerEmail } from "@/src/lib/auth/admin";
import { getDefaultPermissionsForRole } from "@/src/lib/auth/permissions";
import { ANNVERO_ROLES } from "@/src/config/annveroRoles";
import {
  fetchProfileByEmail,
  upsertProfile,
  syncAnnveroUserMetadata,
} from "@/src/lib/auth/profileService";
import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";
import { USER_PROFILES_TABLE } from "@/src/lib/supabase/userProfilesSchema";

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

export function isBootstrapOwnerEmail(email = "") {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return isAdminEmail(normalized) || isOwnerEmail(normalized);
}

function getAdminClient() {
  const guard = getServerSupabaseAdminGuardResponse("auth:bootstrap", USER_PROFILES_TABLE);
  if (guard) return null;
  return getServerSupabaseAdmin({ requireServiceRole: true });
}

async function hasAdminProfileInDb() {
  const supabase = getAdminClient();
  if (!supabase) return false;

  const { count, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("role", ANNVERO_ROLES.ADMIN);

  if (error) {
    logSupabaseQueryError("auth:bootstrap:has-admin", error, USER_PROFILES_TABLE);
    return false;
  }

  return (count ?? 0) > 0;
}

async function getFirstProfileEmail() {
  const supabase = getAdminClient();
  if (!supabase) return "";

  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("email")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    logSupabaseQueryError("auth:bootstrap:first-profile", error, USER_PROFILES_TABLE);
    return "";
  }

  return normalizeEmail(data?.email);
}

async function getAllCompanyIds() {
  const supabase = getAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase.from("companies").select("id");
  if (error) {
    logSupabaseQueryError("auth:bootstrap:companies", error, "companies");
    return [];
  }

  return (data || []).map((row) => row.id).filter(Boolean);
}

export async function shouldBootstrapAsAdmin(user, profile = null) {
  const email = normalizeEmail(user?.email);
  if (!email) return false;

  if (isAdminUser(user) || isBootstrapOwnerEmail(email)) return true;

  const role = profile?.role || "";
  if (role === ANNVERO_ROLES.ADMIN || role === ANNVERO_ROLES.PARTNER) return false;

  if (!(await hasAdminProfileInDb())) return true;

  const firstEmail = await getFirstProfileEmail();
  if (firstEmail && firstEmail === email) return true;

  return false;
}

function buildAdminProfile(user, profile = {}) {
  const role = ANNVERO_ROLES.ADMIN;
  return {
    ...profile,
    id: user.id || profile.id,
    email: normalizeEmail(user.email),
    displayName:
      profile.displayName ||
      user.user_metadata?.display_name ||
      user.user_metadata?.full_name ||
      user.email,
    role,
    permissions: getDefaultPermissionsForRole(role),
    // Admin/partner: boş company_ids = tüm firmalara erişim (permissions.js)
    companyIds: [],
    teamId: profile.teamId || user.user_metadata?.team_id || "",
    isActive: true,
    lastLoginAt: new Date().toISOString(),
    source: "database",
  };
}

/**
 * İlk kurulum / owner kullanıcıyı Admin yapar ve metadata senkronlar.
 * company_ids boş bırakılır — admin tüm firmalara erişir.
 */
export async function ensureBootstrapAdmin(user, profile = null) {
  if (!user?.email) return { profile, bootstrapped: false };

  let current = profile;
  if (!current) {
    const fetched = await fetchProfileByEmail(user.email);
    current = fetched.profile;
  }
  if (!current) return { profile: null, bootstrapped: false };

  const shouldPromote = await shouldBootstrapAsAdmin(user, current);
  if (!shouldPromote) return { profile: current, bootstrapped: false };

  if (current.role === ANNVERO_ROLES.ADMIN) {
    return { profile: current, bootstrapped: false };
  }

  const promoted = buildAdminProfile(user, current);
  const saved = await upsertProfile(promoted);

  if (saved.profile) {
    await syncAnnveroUserMetadata(user.id, saved.profile);
    return { profile: saved.profile, bootstrapped: true };
  }

  if (saved.error) {
    console.error("[bootstrapAdmin] upsert failed", saved.error.message);
  }

  await syncAnnveroUserMetadata(user.id, promoted);
  return { profile: promoted, bootstrapped: true };
}

/** Tanılama: mevcut profil durumu */
export async function getProfileDiagnostics(email = "") {
  const normalized = normalizeEmail(email);
  const result = await fetchProfileByEmail(normalized);
  const companyIds = await getAllCompanyIds();

  return {
    email: normalized,
    profile: result.profile,
    profileRole: result.profile?.role || null,
    companyIdsInProfile: result.profile?.companyIds || [],
    companiesInSystem: companyIds.length,
    isBootstrapOwner: isBootstrapOwnerEmail(normalized),
    hasAdminInDb: await hasAdminProfileInDb(),
    firstProfileEmail: await getFirstProfileEmail(),
  };
}
