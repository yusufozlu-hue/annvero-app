import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export async function GET(request) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase yapılandırılmamış." }, { status: 500 });
  }

  const channel = request.nextUrl.searchParams.get("channel");
  const companyId = request.nextUrl.searchParams.get("companyId");
  const status = request.nextUrl.searchParams.get("status");

  let query = supabase
    .from("official_notifications")
    .select("*")
    .order("notification_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (channel) query = query.eq("channel", channel);
  if (companyId) query = query.eq("company_id", companyId);
  if (status) query = query.eq("status", status);

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
    .filter((item) => item?.company_id && item?.channel && item?.title)
    .map((item) => ({
      company_id: item.company_id,
      channel: item.channel,
      title: item.title,
      summary: item.summary || null,
      reference_no: item.reference_no || null,
      notification_date: item.notification_date || null,
      status: item.status || "unread",
      metadata: item.metadata || {},
      checked_at: item.checked_at || null,
      updated_at: new Date().toISOString(),
    }));

  if (!payload.length) {
    return NextResponse.json({ error: "Kayıt verisi zorunludur." }, { status: 400 });
  }

  const { data, error } = await supabase.from("official_notifications").insert(payload).select();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] });
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
  if (body.summary !== undefined) patch.summary = body.summary;
  if (body.title !== undefined) patch.title = body.title;

  const { data, error } = await supabase
    .from("official_notifications")
    .update(patch)
    .eq("id", body.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
