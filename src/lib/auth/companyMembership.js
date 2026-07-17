import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";

export const COMPANY_MEMBERS_TABLE = "annvero_company_members";
export const COMPANY_MEMBERS_RPC = "annvero_sync_company_membership";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CompanyMembershipError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = "CompanyMembershipError";
    this.code = code;
  }
}

function normalizeCompanyIds(companyIds) {
  const list = Array.isArray(companyIds) ? companyIds : [];
  return Array.from(
    new Set(list.map((value) => String(value || "").trim()).filter(Boolean))
  );
}

// Kullanıcıya iç detay sızdırmadan güvenli mesaj üret.
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
 * annvero_company_members'i profilin companyIds değeriyle ATOMİK olarak senkronize eder.
 *
 * Güvenlik:
 * - DB doğruluk kaynağı membership'tir (023). user_metadata/app_metadata yetki için kullanılmaz.
 * - Erişimi sessizce genişletmez; kaynak admin'in açıkça verdiği companyIds'tir.
 * - Best-effort/no-op DEĞİLDİR: hata YUTULMAZ. Başarısızlıkta CompanyMembershipError fırlatır;
 *   çağıran (admin route) işlemi başarısız saymalı ve hata dönmelidir.
 * - Tüm senkron tek atomik RPC (annvero_sync_company_membership) içinde yapılır; geçersiz
 *   firma ID'sinde tüm işlem rollback olur, mevcut membership korunur.
 *
 * @returns {{ ok: true, active: number } | { ok: false, skipped: "no_auth_user" }}
 * @throws {CompanyMembershipError} servis kullanılamıyorsa veya RPC hata verirse
 */
export async function syncCompanyMembership(authUserId, companyIds = [], actorId = null) {
  const uid = String(authUserId || "").trim();
  // Pending kullanıcı (gerçek auth kullanıcısı yok): membership yazma; çağıran raporlar.
  if (!UUID_RE.test(uid)) {
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
  const actor = actorId && UUID_RE.test(String(actorId)) ? String(actorId) : null;

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
