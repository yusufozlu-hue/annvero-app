import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  fromOfficialNotificationDbRow,
  mapOfficialNotificationRows,
  normalizeOfficialNotificationSource,
  toOfficialNotificationDbRow,
} from "@/src/utils/officialNotificationSchema";

export async function GET(request) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase yapılandırılmamış." }, { status: 500 });
  }

  const channel = request.nextUrl.searchParams.get("channel");
  const source = request.nextUrl.searchParams.get("source");
  const companyId = request.nextUrl.searchParams.get("companyId");
  const status = request.nextUrl.searchParams.get("status");

  let query = supabase
    .from("official_notifications")
    .select("*")
    .order("served_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const resolvedSource = source || channel;
  if (resolvedSource) query = query.eq("source", normalizeOfficialNotificationSource(resolvedSource));
  if (companyId) query = query.eq("company_id", companyId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: mapOfficialNotificationRows(data || []) });
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
    .filter((item) => item?.company_id && (item?.source || item?.channel) && item?.title)
    .map((item) => toOfficialNotificationDbRow(item));

  if (!payload.length) {
    return NextResponse.json({ error: "Kayıt verisi zorunludur." }, { status: 400 });
  }

  const { data, error } = await supabase.from("official_notifications").insert(payload).select();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: mapOfficialNotificationRows(data || []) });
}

export async function PATCH(request) {
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

  if (!body?.id) {
    return NextResponse.json({ error: "id zorunludur." }, { status: 400 });
  }

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
    .from("official_notifications")
    .update(patch)
    .eq("id", body.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: fromOfficialNotificationDbRow(data) });
}
