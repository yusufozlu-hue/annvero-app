/**
 * ANNVERO API güvenlik katmanı — Güvenlik Faz 1
 * Tüm /api/* route'larında oturum + firma erişim kontrolü için ortak yardımcılar.
 */

import { NextResponse } from "next/server";
import {
  getServerSupabaseUser,
  requireAdminUser,
  requireManagementUser,
} from "@/src/lib/supabase/serverAuth";
import { fetchProfileByEmail } from "@/src/lib/auth/profileService";
import { mergeProfileWithAuth, createUserAccess } from "@/src/lib/auth/userAccess";
import { ANNVERO_ROLES } from "@/src/config/annveroRoles";
import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
} from "@/src/lib/supabase/serverAdmin";

export function jsonUnauthorized(message = "Oturum gerekli.") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function jsonForbidden(message = "Yetkisiz erişim.") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function jsonBadRequest(message = "Geçersiz istek.") {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function resolveCompanyId(source = {}) {
  if (!source) return "";
  return String(
    source.companyId ||
      source.company_id ||
      source.firmaId ||
      ""
  ).trim();
}

export function isElevatedCompanyLister(access = {}) {
  return (
    access.isManagementUser ||
    access.role === ANNVERO_ROLES.ADMIN ||
    access.role === ANNVERO_ROLES.PARTNER
  );
}

/** Admin/partner tüm firmaları görebilir; diğerleri yalnızca companyIds */
export function getAccessibleCompanyIds(access = {}) {
  if (isElevatedCompanyLister(access)) return null;
  return Array.isArray(access.companyIds) ? access.companyIds : [];
}

export function assertCompanyAccess(access, companyId, { required = true } = {}) {
  if (!companyId) {
    if (required) {
      return {
        ok: false,
        response: jsonBadRequest("companyId zorunludur."),
      };
    }
    return { ok: true, companyId: "" };
  }

  if (!access?.canAccessCompany?.(companyId)) {
    return {
      ok: false,
      response: jsonForbidden("Bu firmaya erişim yetkiniz yok."),
    };
  }

  return { ok: true, companyId };
}

/**
 * Oturum + profil + access nesnesi.
 * @returns {{ error: NextResponse|null, user, profile, access, supabaseAuth }}
 */
export async function requireApiSession() {
  const { supabase, user } = await getServerSupabaseUser();

  if (!user) {
    return { error: jsonUnauthorized(), user: null, profile: null, access: null, supabaseAuth: null };
  }

  const profileResult = await fetchProfileByEmail(user.email);
  const profile = mergeProfileWithAuth(user, profileResult.profile);
  const access = createUserAccess(profile);

  if (!access.isActive) {
    return {
      error: jsonForbidden("Hesabınız pasif durumda."),
      user,
      profile,
      access,
      supabaseAuth: supabase,
    };
  }

  return { error: null, user, profile, access, supabaseAuth: supabase };
}

/**
 * Service role Supabase istemcisi (API yazma/okuma — RLS bypass, erişim API'de kontrol edilir).
 */
export function getApiSupabase(context, table) {
  const guard = getServerSupabaseAdminGuardResponse(context, table);
  if (guard) {
    return { supabase: null, guard };
  }

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  if (!supabase) {
    return {
      supabase: null,
      guard: NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY yapılandırılmamış." },
        { status: 500 }
      ),
    };
  }

  return { supabase, guard: null };
}

/**
 * Oturum + opsiyonel companyId doğrulaması + service role client.
 */
export async function requireAuthenticatedApi(context, table, options = {}) {
  const session = await requireApiSession();
  if (session.error) {
    return { ...session, supabase: null, companyId: "" };
  }

  const companyId = resolveCompanyId(options);

  if (companyId) {
    const check = assertCompanyAccess(session.access, companyId, { required: true });
    if (!check.ok) {
      return {
        ...session,
        error: check.response,
        supabase: null,
        companyId: "",
      };
    }
  }

  const { supabase, guard } = getApiSupabase(context, table);
  if (guard) {
    return { ...session, error: guard, supabase: null, companyId };
  }

  return { ...session, error: null, supabase, companyId };
}

/** Liste sorgularına firma filtresi uygular (admin/partner: tümü veya tek firma). */
export function applyCompanyScopeToQuery(query, access, companyId = "") {
  if (companyId) {
    return query.eq("company_id", companyId);
  }

  const ids = getAccessibleCompanyIds(access);
  if (ids === null) {
    return query;
  }

  if (!ids.length) {
    return null;
  }

  return query.in("company_id", ids);
}

/** companies tablosu için id sütunu scope */
export function applyCompanyIdScopeToQuery(query, access, companyId = "") {
  if (companyId) {
    return query.eq("id", companyId);
  }

  const ids = getAccessibleCompanyIds(access);
  if (ids === null) {
    return query;
  }

  if (!ids.length) {
    return null;
  }

  return query.in("id", ids);
}

export async function requireRecordCompanyAccess(supabase, table, idColumn, recordId, access) {
  const { data, error } = await supabase
    .from(table)
    .select(`company_id, ${idColumn}`)
    .eq(idColumn, recordId)
    .maybeSingle();

  if (error) {
    return { ok: false, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  }

  if (!data) {
    return { ok: false, response: NextResponse.json({ error: "Kayıt bulunamadı." }, { status: 404 }) };
  }

  const companyId = data.company_id || data.id || "";
  const check = assertCompanyAccess(access, companyId, { required: true });
  if (!check.ok) {
    return { ok: false, response: check.response };
  }

  return { ok: true, record: data, companyId: check.companyId };
}

export async function requireCompaniesRecordAccess(supabase, companyId, access) {
  const check = assertCompanyAccess(access, companyId, { required: true });
  if (!check.ok) {
    return { ok: false, response: check.response };
  }

  const { data, error } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();

  if (error) {
    return { ok: false, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  }

  if (!data) {
    return { ok: false, response: NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 }) };
  }

  return { ok: true, companyId };
}

/**
 * Yönetim yetkisi (admin / partner / mudur) + oturum.
 */
export async function requireManagementApi(context = "management", table = null) {
  const session = await requireApiSession();
  if (session.error) {
    return { ...session, supabase: null, companyId: "" };
  }

  if (!session.access?.isManagementUser) {
    return {
      ...session,
      error: jsonForbidden("Bu işlem için yönetim yetkisi gerekli."),
      supabase: null,
      companyId: "",
    };
  }

  if (!table) {
    return { ...session, error: null, supabase: null, companyId: "" };
  }

  const { supabase, guard } = getApiSupabase(context, table);
  if (guard) {
    return { ...session, error: guard, supabase: null, companyId: "" };
  }

  return { ...session, error: null, supabase, companyId: "" };
}

export { requireAdminUser, requireManagementUser };
