import { getDefaultPermissionsForRole } from "@/src/lib/auth/permissions";
import { ANNVERO_ROLES } from "@/src/config/annveroRoles";
import { shouldBootstrapAsAdmin } from "@/src/lib/auth/profileProvisionPolicy";
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

export {
  isBootstrapOwnerEmail,
  shouldBootstrapAsAdmin,
} from "@/src/lib/auth/profileProvisionPolicy";

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
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
    companyIds: [],
    teamId: profile.teamId || user.user_metadata?.team_id || "",
    isActive: true,
    lastLoginAt: new Date().toISOString(),
    source: "database",
  };
}

/**
 * Profil senkronu yalnız isAdminUser (AND) için.
 * Auto-promotion / owner-email / first-user yok.
 * Elevated app_metadata login'de yazılmaz (syncAnnveroUserMetadata skip eder);
 * zaten AND admin olan kullanıcının app_metadata'sı ops tarafından set edilmiştir.
 */
export async function ensureBootstrapAdmin(user, profile = null) {
  if (!user?.email) {
    return { profile, bootstrapped: false, upsertOk: false, error: null };
  }

  if (!shouldBootstrapAsAdmin(user)) {
    return { profile, bootstrapped: false, upsertOk: false, error: null };
  }

  let current = profile;
  if (!current) {
    const fetched = await fetchProfileByEmail(user.email);
    current = fetched.profile;
  }

  if (!current) {
    current = buildAdminProfile(user, {});
  }

  if (current.role === ANNVERO_ROLES.ADMIN) {
    return { profile: current, bootstrapped: false, upsertOk: true, error: null };
  }

  const promoted = buildAdminProfile(user, current);
  const saved = await upsertProfile(promoted);

  if (saved.profile) {
    // Elevated skip — app_metadata zaten ops tarafından set
    await syncAnnveroUserMetadata(user.id, saved.profile);
    return {
      profile: { ...saved.profile, role: ANNVERO_ROLES.ADMIN, source: "database" },
      bootstrapped: true,
      upsertOk: true,
      error: null,
    };
  }

  const error = saved.error || new Error("bootstrap upsert failed");
  console.error("[bootstrapAdmin] upsert failed", error.message);

  return {
    profile: current,
    bootstrapped: false,
    upsertOk: false,
    error,
  };
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
    companiesInSystem: Array.isArray(companyIds) ? companyIds.length : 0,
    isBootstrapOwner: false,
    hasAdminInDb: await hasAdminProfileInDb(),
    firstProfileEmail: await getFirstProfileEmail(),
  };
}
