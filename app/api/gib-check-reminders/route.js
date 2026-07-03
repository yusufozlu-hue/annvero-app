import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { computeNextCheckAt } from "@/src/utils/gibTebligatEngine";

export async function GET(request) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase yapılandırılmamış." }, { status: 500 });
  }

  const companyId = request.nextUrl.searchParams.get("companyId");

  let query = supabase
    .from("gib_check_reminders")
    .select("*")
    .order("updated_at", { ascending: false })
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

  const companyId = body?.company_id || body?.companyId || null;
  const intervalDays = Number(body?.interval_days || body?.intervalDays || 1);
  const reminderTime = body?.reminder_time || body?.reminderTime || "09:00";
  const enabled = body?.enabled !== false;
  const pushEnabled = body?.push_enabled !== false && body?.pushEnabled !== false;

  const lastCheckAt = body?.last_check_at || body?.lastCheckAt || null;
  const nextCheckAt =
    body?.next_check_at ||
    body?.nextCheckAt ||
    computeNextCheckAt(lastCheckAt || new Date().toISOString(), intervalDays);

  const payload = {
    company_id: companyId,
    enabled,
    interval_days: intervalDays,
    reminder_time: reminderTime,
    last_check_at: lastCheckAt,
    next_check_at: nextCheckAt,
    push_enabled: pushEnabled,
    updated_at: new Date().toISOString(),
  };

  let query = supabase.from("gib_check_reminders").select("*");

  if (companyId) {
    query = query.eq("company_id", companyId);
  } else {
    query = query.is("company_id", null);
  }

  const { data: existing, error: findError } = await query.maybeSingle();
  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }

  if (existing?.id) {
    const { data, error } = await supabase
      .from("gib_check_reminders")
      .update(payload)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  }

  const { data, error } = await supabase
    .from("gib_check_reminders")
    .insert([payload])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
