import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export async function GET(request) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase yapılandırılmamış." }, { status: 500 });
  }

  const companyId = request.nextUrl.searchParams.get("companyId");
  let query = supabase
    .from("learned_bank_rules")
    .select("*")
    .order("usage_count", { ascending: false })
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

  if (!body?.company_id || !body?.bank_description_pattern) {
    return NextResponse.json(
      { error: "company_id ve bank_description_pattern zorunludur." },
      { status: 400 }
    );
  }

  const { data: existing, error: findError } = await supabase
    .from("learned_bank_rules")
    .select("*")
    .eq("company_id", body.company_id)
    .eq("bank_description_pattern", body.bank_description_pattern)
    .eq("ledger_account_code", body.ledger_account_code || "")
    .maybeSingle();

  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }

  if (existing?.id) {
    const { data, error } = await supabase
      .from("learned_bank_rules")
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
    .from("learned_bank_rules")
    .insert([
      {
        company_id: body.company_id,
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
