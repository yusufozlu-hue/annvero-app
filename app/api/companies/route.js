import { NextResponse } from "next/server";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";
import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryDiagnostics,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMPANIES_TABLE = "companies";

function buildSupabaseErrorResponse(context, error) {
  logSupabaseQueryError(context, error, COMPANIES_TABLE, {
    usedKeyType: "service_role",
  });

  return NextResponse.json(
    {
      error: error?.message || "Firma kaydı işlenemedi.",
      code: error?.code || null,
      details: error?.details || null,
      hint: error?.hint || null,
    },
    { status: 500 }
  );
}

export async function POST(request) {
  const { user } = await getServerSupabaseUser();
  if (!user) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
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

  return NextResponse.json({ data: saved });
}

export async function DELETE(request) {
  const { user } = await getServerSupabaseUser();
  if (!user) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  const supabaseGuard = getServerSupabaseAdminGuardResponse("companies:delete", COMPANIES_TABLE);
  if (supabaseGuard) return supabaseGuard;

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  logSupabaseQueryDiagnostics("companies:delete", COMPANIES_TABLE);

  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunludur." }, { status: 400 });
  }

  const { error } = await supabase.from(COMPANIES_TABLE).delete().eq("id", companyId);

  if (error) {
    return buildSupabaseErrorResponse("companies:delete", error);
  }

  return NextResponse.json({ ok: true });
}
