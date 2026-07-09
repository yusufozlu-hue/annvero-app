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
import {
  fromOfficialNotificationDbRow,
  mapOfficialNotificationRows,
  normalizeOfficialNotificationSource,
  toOfficialNotificationDbRow,
} from "@/src/utils/officialNotificationSchema";

const TABLE = "official_notifications";

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });
  const channel = request.nextUrl.searchParams.get("channel");
  const source = request.nextUrl.searchParams.get("source");
  const status = request.nextUrl.searchParams.get("status");

  const ctx = await requireAuthenticatedApi("official-notifications:get", TABLE, { companyId });
  if (ctx.error) return ctx.error;

  let query = ctx.supabase
    .from(TABLE)
    .select("*")
    .order("served_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const resolvedSource = source || channel;
  if (resolvedSource) {
    query = query.eq("source", normalizeOfficialNotificationSource(resolvedSource));
  }
  if (status) query = query.eq("status", status);

  const scoped = applyCompanyScopeToQuery(query, ctx.access, companyId);
  if (!scoped) {
    return NextResponse.json({ data: [] });
  }

  const { data, error } = await scoped;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: mapOfficialNotificationRows(data || []) });
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
    .filter((item) => item?.company_id && (item?.source || item?.channel) && item?.title)
    .map((item) => toOfficialNotificationDbRow(item));

  if (!payload.length) {
    return NextResponse.json({ error: "Kayıt verisi zorunludur." }, { status: 400 });
  }

  for (const row of payload) {
    const check = assertCompanyAccess(session.access, row.company_id, { required: true });
    if (!check.ok) return check.response;
  }

  const { supabase, guard } = getApiSupabase("official-notifications:post", TABLE);
  if (guard) return guard;

  const { data, error } = await supabase.from(TABLE).insert(payload).select();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: mapOfficialNotificationRows(data || []) });
}

export async function PATCH(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  if (!body?.id) {
    return NextResponse.json({ error: "id zorunludur." }, { status: 400 });
  }

  const { supabase, guard } = getApiSupabase("official-notifications:patch", TABLE);
  if (guard) return guard;

  const accessCheck = await requireRecordCompanyAccess(
    supabase,
    TABLE,
    "id",
    body.id,
    session.access
  );
  if (!accessCheck.ok) return accessCheck.response;

  const patch = {
    updated_at: new Date().toISOString(),
  };

  if (body.status) patch.status = body.status;
  if (body.title !== undefined) patch.title = body.title;
  if (body.description !== undefined) patch.description = body.description;
  if (body.summary !== undefined) patch.description = body.summary;
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.file_url !== undefined) patch.file_url = body.file_url;
  if (body.due_date !== undefined) patch.due_date = body.due_date;

  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", body.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: fromOfficialNotificationDbRow(data) });
}
