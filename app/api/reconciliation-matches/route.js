import { NextResponse } from "next/server";
import {
  applyCompanyScopeToQuery,
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
  requireAuthenticatedApi,
  requireRecordCompanyAccess,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import { buildSoftDeletePatch, excludeSoftDeleted } from "@/src/lib/softDelete";

const TABLE = "reconciliation_matches";

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });

  const ctx = await requireAuthenticatedApi("reconciliation-matches:get", TABLE, { companyId });
  if (ctx.error) return ctx.error;

  let query = ctx.supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  query = excludeSoftDeleted(query);
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

  const records = Array.isArray(body?.records) ? body.records : [body];
  const payload = records
    .filter((item) => item?.company_id)
    .map((item) => ({
      company_id: item.company_id,
      bank_id: item.bank_id || null,
      bank_transaction_id: item.bank_transaction_id || null,
      ledger_transaction_id: item.ledger_transaction_id || null,
      match_type: item.match_type || "manual",
      match_score: Number(item.match_score || 0),
      status: item.status || "matched",
      difference_amount: Number(item.difference_amount || 0),
      matched_by: item.matched_by || "user",
      bank_snapshot: item.bank_snapshot || null,
      ledger_snapshot: item.ledger_snapshot || null,
      matched_at: item.matched_at || new Date().toISOString(),
    }));

  if (!payload.length) {
    return NextResponse.json({ error: "Kayıt verisi zorunludur." }, { status: 400 });
  }

  for (const row of payload) {
    const check = assertCompanyAccess(session.access, row.company_id, { required: true });
    if (!check.ok) return check.response;
  }

  const { supabase, guard } = getApiSupabase("reconciliation-matches:post", TABLE);
  if (guard) return guard;

  const { data, error } = await supabase.from(TABLE).insert(payload).select();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] });
}

export async function DELETE(request) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id zorunludur." }, { status: 400 });
  }

  const session = await requireApiSession();
  if (session.error) return session.error;

  const { supabase, guard } = getApiSupabase("reconciliation-matches:delete", TABLE);
  if (guard) return guard;

  const accessCheck = await requireRecordCompanyAccess(
    supabase,
    TABLE,
    "id",
    id,
    session.access
  );
  if (!accessCheck.ok) return accessCheck.response;

  const { error } = await supabase
    .from(TABLE)
    .update(buildSoftDeletePatch(session.user))
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
