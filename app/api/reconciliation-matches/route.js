import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export async function GET(request) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase yapılandırılmamış." }, { status: 500 });
  }

  const companyId = request.nextUrl.searchParams.get("companyId");
  let query = supabase
    .from("reconciliation_matches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] });
}

export async function POST(request) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase yapılandırılmamış." }, { status: 500 });
  }

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

  const { data, error } = await supabase.from("reconciliation_matches").insert(payload).select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] });
}

export async function DELETE(request) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase yapılandırılmamış." }, { status: 500 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id zorunludur." }, { status: 400 });
  }

  const { error } = await supabase.from("reconciliation_matches").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
