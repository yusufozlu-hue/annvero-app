import { NextResponse } from "next/server";
import {
  applyCompanyScopeToQuery,
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import { computeNextCheckAt } from "@/src/utils/gibTebligatEngine";

const TABLE = "gib_check_reminders";

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });

  const ctx = await requireAuthenticatedApi("gib-check-reminders:get", TABLE, { companyId });
  if (ctx.error) return ctx.error;

  let query = ctx.supabase
    .from(TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (companyId) {
    query = query.eq("company_id", companyId);
  } else {
    const scoped = applyCompanyScopeToQuery(query, ctx.access, "");
    if (!scoped) {
      return NextResponse.json({ data: [] });
    }
    query = scoped;
  }

  const { data, error } = await query;
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

  const companyId = resolveCompanyId(body) || null;
  if (companyId) {
    const check = assertCompanyAccess(session.access, companyId, { required: true });
    if (!check.ok) return check.response;
  }

  const { supabase, guard } = getApiSupabase("gib-check-reminders:post", TABLE);
  if (guard) return guard;

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

  let query = supabase.from(TABLE).select("*");

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
      .from(TABLE)
      .update(payload)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  }

  const { data, error } = await supabase.from(TABLE).insert([payload]).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
