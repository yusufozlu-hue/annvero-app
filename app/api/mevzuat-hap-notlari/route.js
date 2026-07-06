import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { requireAdminUser } from "@/src/lib/supabase/serverAuth";
import {
  fromMevzuatHapNotuDbRow,
  mapMevzuatHapNotuRows,
  normalizeMevzuatCategory,
  normalizeMevzuatSource,
  toMevzuatHapNotuDbRow,
} from "@/src/utils/mevzuatHapNotlariSchema";

const TABLE_NAME = "mevzuat_hap_notlari";
const TABLE_MISSING_MESSAGE =
  "Mevzuat hap notları tablosu henüz oluşturulmamış. Supabase migration çalıştırılmalı.";

function isMissingTableError(error) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /schema cache/i.test(text) ||
    /relation .* does not exist/i.test(text) ||
    /could not find .* table/i.test(text)
  );
}

function adminErrorResponse(error) {
  if (error === "unauthenticated") {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  if (error === "forbidden") {
    return NextResponse.json(
      { error: "Bu işlem için admin yetkisi gerekli." },
      { status: 403 }
    );
  }

  return null;
}

export async function GET(request) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({
      data: [],
      meta: { notice: "Supabase yapılandırılmamış." },
    });
  }

  const category = request.nextUrl.searchParams.get("category");
  const source = request.nextUrl.searchParams.get("source");
  const search = request.nextUrl.searchParams.get("search");
  const includeInactive =
    request.nextUrl.searchParams.get("includeInactive") === "1";
  const limit = Number(request.nextUrl.searchParams.get("limit") || 100);

  let query = supabase
    .from(TABLE_NAME)
    .select("*")
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 100);

  if (!includeInactive) query = query.eq("is_active", true);
  if (category) query = query.eq("category", normalizeMevzuatCategory(category));
  if (source) query = query.eq("source", normalizeMevzuatSource(source));
  if (search) {
    const safeSearch = String(search).replaceAll("%", "").replaceAll(",", " ");
    query = query.or(`title.ilike.%${safeSearch}%,summary.ilike.%${safeSearch}%`);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({
        data: [],
        meta: { notice: TABLE_MISSING_MESSAGE },
      });
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: mapMevzuatHapNotuRows(data || []) });
}

export async function POST(request) {
  const { supabase, error } = await requireAdminUser();
  const authResponse = adminErrorResponse(error);
  if (authResponse) return authResponse;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  if (!body?.title || !body?.summary) {
    return NextResponse.json(
      { error: "Başlık ve kısa not zorunludur." },
      { status: 400 }
    );
  }

  const { data, error: insertError } = await supabase
    .from(TABLE_NAME)
    .insert([toMevzuatHapNotuDbRow(body)])
    .select("*")
    .maybeSingle();

  if (insertError) {
    return NextResponse.json(
      {
        error: isMissingTableError(insertError)
          ? TABLE_MISSING_MESSAGE
          : insertError.message,
      },
      { status: isMissingTableError(insertError) ? 503 : 500 }
    );
  }

  return NextResponse.json({ data: fromMevzuatHapNotuDbRow(data) });
}

export async function PATCH(request) {
  const { supabase, error } = await requireAdminUser();
  const authResponse = adminErrorResponse(error);
  if (authResponse) return authResponse;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  if (!body?.id) {
    return NextResponse.json({ error: "id zorunludur." }, { status: 400 });
  }

  const payload = {};
  if (body.title !== undefined) payload.title = String(body.title || "").trim();
  if (body.source !== undefined) payload.source = normalizeMevzuatSource(body.source);
  if (body.sourceUrl !== undefined || body.source_url !== undefined) {
    payload.source_url = String(body.sourceUrl || body.source_url || "").trim() || null;
  }
  if (body.category !== undefined) {
    payload.category = normalizeMevzuatCategory(body.category);
  }
  if (body.summary !== undefined) payload.summary = String(body.summary || "").trim();
  if (body.publishedAt !== undefined || body.published_at !== undefined) {
    payload.published_at = body.publishedAt || body.published_at || new Date().toISOString();
  }
  if (body.isPinned !== undefined || body.is_pinned !== undefined) {
    payload.is_pinned = Boolean(body.isPinned ?? body.is_pinned);
  }
  if (body.isActive !== undefined || body.is_active !== undefined) {
    payload.is_active = Boolean(body.isActive ?? body.is_active);
  }

  if (!Object.keys(payload).length) {
    return NextResponse.json({ error: "Güncellenecek alan yok." }, { status: 400 });
  }

  const { data, error: updateError } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq("id", body.id)
    .select("*")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json(
      {
        error: isMissingTableError(updateError)
          ? TABLE_MISSING_MESSAGE
          : updateError.message,
      },
      { status: isMissingTableError(updateError) ? 503 : 500 }
    );
  }

  return NextResponse.json({ data: fromMevzuatHapNotuDbRow(data) });
}

export async function DELETE(request) {
  const { supabase, error } = await requireAdminUser();
  const authResponse = adminErrorResponse(error);
  if (authResponse) return authResponse;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id zorunludur." }, { status: 400 });
  }

  const { error: deleteError } = await supabase.from(TABLE_NAME).delete().eq("id", id);
  if (deleteError) {
    return NextResponse.json(
      {
        error: isMissingTableError(deleteError)
          ? TABLE_MISSING_MESSAGE
          : deleteError.message,
      },
      { status: isMissingTableError(deleteError) ? 503 : 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
