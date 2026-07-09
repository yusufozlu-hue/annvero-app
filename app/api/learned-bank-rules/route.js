import { NextResponse } from "next/server";
import {
  applyCompanyScopeToQuery,
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";

const TABLE = "learned_bank_rules";

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });

  const ctx = await requireAuthenticatedApi("learned-bank-rules:get", TABLE, { companyId });
  if (ctx.error) return ctx.error;

  let query = ctx.supabase
    .from(TABLE)
    .select("*")
    .is("deleted_at", null)
    .order("usage_count", { ascending: false })
    .limit(500);

  const scoped = applyCompanyScopeToQuery(query, ctx.access, companyId);
  if (!scoped) {
    return NextResponse.json({ data: [] });
  }

  const { data, error } = await scoped;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] });
}

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const companyId = resolveCompanyId(body);
  const accessCheck = assertCompanyAccess(session.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  if (!body?.bank_description_pattern) {
    return NextResponse.json(
      { error: "company_id ve bank_description_pattern zorunludur." },
      { status: 400 }
    );
  }

  const { supabase, guard } = getApiSupabase("learned-bank-rules:post", TABLE);
  if (guard) return guard;

  const { data: existing, error: findError } = await supabase
    .from(TABLE)
    .select("*")
    .eq("company_id", companyId)
    .eq("bank_description_pattern", body.bank_description_pattern)
    .eq("ledger_account_code", body.ledger_account_code || "")
    .maybeSingle();

  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }

  if (existing?.id) {
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        usage_count: Number(existing.usage_count || 0) + 1,
        last_used_at: new Date().toISOString(),
        ledger_account_name: body.ledger_account_name || existing.ledger_account_name,
        transaction_type: body.transaction_type || existing.transaction_type,
        document_type: body.document_type || existing.document_type,
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert([
      {
        company_id: companyId,
        bank_id: body.bank_id || null,
        bank_description_pattern: body.bank_description_pattern,
        ledger_account_code: body.ledger_account_code || null,
        ledger_account_name: body.ledger_account_name || null,
        transaction_type: body.transaction_type || null,
        document_type: body.document_type || null,
        usage_count: 1,
        last_used_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
