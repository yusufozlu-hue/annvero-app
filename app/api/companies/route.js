import { NextResponse } from "next/server";
import {
  applyCompanyIdScopeToQuery,
  requireAuthenticatedApi,
  requireManagementUser,
} from "@/src/lib/auth/apiGuard";
import {
  buildAuditContextFromRequest,
  writeAuditEvent,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
} from "@/src/lib/audit/auditEvents";
import { buildSoftDeletePatch } from "@/src/lib/softDelete";
import {
  COMPANIES_TABLE,
  getCompaniesSchemaErrorMessage,
  isCompaniesSchemaCacheError,
} from "@/src/lib/supabase/companiesSchema";
import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryDiagnostics,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildSupabaseErrorResponse(context, error) {
  logSupabaseQueryError(context, error, COMPANIES_TABLE, {
    usedKeyType: "service_role",
  });

  const schemaCacheError = isCompaniesSchemaCacheError(error);

  return NextResponse.json(
    {
      error: schemaCacheError
        ? getCompaniesSchemaErrorMessage()
        : error?.message || "Firma kaydı işlenemedi.",
      code: error?.code || null,
      details: error?.details || null,
      hint: schemaCacheError
        ? "supabase/migrations/007_companies_table.sql"
        : error?.hint || null,
    },
    { status: 500 }
  );
}

export async function GET() {
  const api = await requireAuthenticatedApi("companies:get", COMPANIES_TABLE);
  if (api.error) return api.error;

  logSupabaseQueryDiagnostics("companies:get", COMPANIES_TABLE);

  let query = api.supabase
    .from(COMPANIES_TABLE)
    .select("id, company_name, data, created_at")
    .order("company_name", { ascending: true });

  query = applyCompanyIdScopeToQuery(query, api.access);
  if (!query) {
    return NextResponse.json({ data: [] });
  }

  const { data, error } = await query;
  if (error) {
    return buildSupabaseErrorResponse("companies:get", error);
  }

  return NextResponse.json({ data: data || [] });
}

export async function POST(request) {
  const mgmt = await requireManagementUser();
  if (mgmt.error === "unauthenticated") {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }
  if (mgmt.error === "forbidden") {
    return NextResponse.json({ error: "Yetkisiz erişim." }, { status: 403 });
  }

  const supabaseGuard = getServerSupabaseAdminGuardResponse("companies:post", COMPANIES_TABLE);
  if (supabaseGuard) return supabaseGuard;

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  logSupabaseQueryDiagnostics("companies:post", COMPANIES_TABLE);

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const id = String(body?.id || "").trim();
  const companyName = String(body?.company_name || body?.companyName || "").trim();
  const data = body?.data ?? body?.company ?? null;

  if (!id) {
    return NextResponse.json({ error: "Firma id zorunludur." }, { status: 400 });
  }

  if (!companyName) {
    return NextResponse.json({ error: "Firma adı zorunludur." }, { status: 400 });
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "Firma data alanı geçersiz." }, { status: 400 });
  }

  const record = {
    id,
    company_name: companyName,
    data,
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error } = await supabase
    .from(COMPANIES_TABLE)
    .upsert([record], { onConflict: "id" })
    .select()
    .single();

  if (error) {
    return buildSupabaseErrorResponse("companies:post", error);
  }

  void writeAuditEvent({
    ...buildAuditContextFromRequest(request, { user: mgmt.user }),
    companyId: id,
    entityType: AUDIT_ENTITY_TYPES.COMPANY,
    entityId: id,
    action: AUDIT_ACTIONS.CREATE,
    afterState: saved,
  });

  return NextResponse.json({ data: saved });
}

export async function DELETE(request) {
  const mgmt = await requireManagementUser();
  if (mgmt.error === "unauthenticated") {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }
  if (mgmt.error === "forbidden") {
    return NextResponse.json({ error: "Yetkisiz erişim." }, { status: 403 });
  }

  const supabaseGuard = getServerSupabaseAdminGuardResponse("companies:delete", COMPANIES_TABLE);
  if (supabaseGuard) return supabaseGuard;

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  logSupabaseQueryDiagnostics("companies:delete", COMPANIES_TABLE);

  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunludur." }, { status: 400 });
  }

  const softPatch = buildSoftDeletePatch(mgmt.user);
  const { error } = await supabase
    .from(COMPANIES_TABLE)
    .update(softPatch)
    .eq("id", companyId);

  if (error) {
    return buildSupabaseErrorResponse("companies:delete", error);
  }

  void writeAuditEvent({
    ...buildAuditContextFromRequest(request, { user: mgmt.user }),
    companyId,
    entityType: AUDIT_ENTITY_TYPES.COMPANY,
    entityId: companyId,
    action: AUDIT_ACTIONS.SOFT_DELETE,
    afterState: softPatch,
  });

  return NextResponse.json({ ok: true });
}
