import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";
import {
  isAuthUserUuid,
  normalizeCompanyIds,
  selectActiveMembershipCompanyIds,
} from "@/src/lib/auth/companyAccessPolicy";

export const COMPANY_MEMBERS_TABLE = "annvero_company_members";
export const COMPANY_MEMBERS_RPC = "annvero_sync_company_membership";

export { normalizeCompanyIds, selectActiveMembershipCompanyIds };

export class CompanyMembershipError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = "CompanyMembershipError";
    this.code = code;
  }
}

function sanitizeMembershipError(error) {
  const code = error?.code || "";
  if (code === "23503") {
    return "Firma erişimi atanamadı: bir veya daha fazla firma bulunamadı.";
  }
  if (code === "42501") {
    return "Firma erişimi atanamadı: yetki hatası.";
  }
  return "Firma erişimi güncellenemedi.";
}

/**
 * Service-role: yalnız target auth_user_id için aktif membership company_id listesi.
 * Hata YUTULMAZ — çağıran legacy profile.company_ids'e düşmemeli.
 */
export async function fetchActiveMembershipCompanyIds(authUserId) {
  const uid = String(authUserId || "").trim();
  if (!isAuthUserUuid(uid)) {
    return {
      ok: false,
      companyIds: [],
      rows: [],
      error: new CompanyMembershipError("auth_user_id gerekli.", "missing_auth_user_id"),
    };
  }

  const guard = getServerSupabaseAdminGuardResponse(
    "auth:membership:fetch",
    COMPANY_MEMBERS_TABLE
  );
  if (guard) {
    return {
      ok: false,
      companyIds: [],
      rows: [],
      error: new CompanyMembershipError(
        "Firma üyeliği okunamadı: yönetim servisi kullanılamıyor."
      ),
    };
  }

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  if (!supabase) {
    return {
      ok: false,
      companyIds: [],
      rows: [],
      error: new CompanyMembershipError(
        "Firma üyeliği okunamadı: yönetim servisi kullanılamıyor."
      ),
    };
  }

  const { data, error } = await supabase
    .from(COMPANY_MEMBERS_TABLE)
    .select("company_id, user_id, is_active")
    .eq("user_id", uid)
    .eq("is_active", true);

  if (error) {
    logSupabaseQueryError("auth:membership:fetch", error, COMPANY_MEMBERS_TABLE);
    return {
      ok: false,
      companyIds: [],
      rows: [],
      error: new CompanyMembershipError(
        "Firma üyeliği okunamadı.",
        error?.code || null
      ),
    };
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    ok: true,
    companyIds: selectActiveMembershipCompanyIds(rows, uid),
    rows,
    error: null,
  };
}

/**
 * annvero_company_members'i admin'in verdiği companyIds ile ATOMİK senkronize eder.
 */
export async function syncCompanyMembership(authUserId, companyIds = [], actorId = null) {
  const uid = String(authUserId || "").trim();
  if (!isAuthUserUuid(uid)) {
    return { ok: false, skipped: "no_auth_user" };
  }

  const guard = getServerSupabaseAdminGuardResponse(
    "auth:membership:sync",
    COMPANY_MEMBERS_TABLE
  );
  if (guard) {
    throw new CompanyMembershipError(
      "Firma erişimi güncellenemedi: yönetim servisi kullanılamıyor."
    );
  }

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  if (!supabase) {
    throw new CompanyMembershipError(
      "Firma erişimi güncellenemedi: yönetim servisi kullanılamıyor."
    );
  }

  const desired = normalizeCompanyIds(companyIds);
  const actor = actorId && isAuthUserUuid(String(actorId)) ? String(actorId) : null;

  const { error } = await supabase.rpc(COMPANY_MEMBERS_RPC, {
    target_user_id: uid,
    target_company_ids: desired,
    actor_user_id: actor,
  });

  if (error) {
    logSupabaseQueryError("auth:membership:sync", error, COMPANY_MEMBERS_TABLE);
    throw new CompanyMembershipError(
      sanitizeMembershipError(error),
      error?.code || null
    );
  }

  return { ok: true, active: desired.length };
}
