import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  buildSafeLearningMemoryPayload,
  isLearningMemorySchemaError,
  LEARNING_MEMORY_SCHEMA_MESSAGE,
} from "@/src/utils/learningMemorySafePayload";

function buildRecordPayload(record = {}) {
  return buildSafeLearningMemoryPayload(record);
}

export async function GET(request) {
  const companyId = request.nextUrl.searchParams.get("companyId");
  const includeInactive =
    request.nextUrl.searchParams.get("includeInactive") === "1";
  const supabase = getSupabaseClient();

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase istemcisi yapılandırılmamış." },
      { status: 500 }
    );
  }

  let query = supabase
    .from("learning_memory")
    .select("*")
    .order("usage_count", { ascending: false });

  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  if (!includeInactive) {
    query = query.eq("is_active", true);
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
    return NextResponse.json(
      { error: "Supabase istemcisi yapılandırılmamış." },
      { status: 500 }
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const record = body?.record;

  if (!record?.company_id || !record?.keyword) {
    return NextResponse.json(
      { error: "Firma ID ve anahtar kelime zorunludur." },
      { status: 400 }
    );
  }

  const insertPayload = buildSafeLearningMemoryPayload({
    ...record,
    keyword: String(record.keyword).trim(),
    document_type: record.document_type || "DK",
    learned_at: record.learned_at || new Date().toISOString(),
    status: record.status || "active",
  });

  console.log("learning memory safe payload", insertPayload);

  let { data, error } = await supabase
    .from("learning_memory")
    .insert([insertPayload])
    .select("*")
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: isLearningMemorySchemaError(error)
          ? LEARNING_MEMORY_SCHEMA_MESSAGE
          : error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ data });
}

export async function PATCH(request) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase istemcisi yapılandırılmamış." },
      { status: 500 }
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const updates = Array.isArray(body?.updates) ? body.updates : [];
  const record = body?.record;

  if (record?.id) {
    const payload = buildRecordPayload(record);

    if (!Object.keys(payload).length) {
      return NextResponse.json({ data: null, skipped: true });
    }

    let { data, error } = await supabase
      .from("learning_memory")
      .update(payload)
      .eq("id", record.id)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error(error);
      return NextResponse.json(
        {
          error: isLearningMemorySchemaError(error)
            ? LEARNING_MEMORY_SCHEMA_MESSAGE
            : error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "Güncellenecek kayıt yok." }, { status: 400 });
  }

  const results = [];

  for (const item of updates) {
    const id = item?.id;
    const increment = Number(item?.increment ?? 1);

    if (!id || increment <= 0) continue;
    results.push({ id, increment, skipped: true });
  }

  return NextResponse.json({ updated: results });
}

export async function DELETE(request) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase istemcisi yapılandırılmamış." },
      { status: 500 }
    );
  }

  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Kayıt ID gerekli." }, { status: 400 });
  }

  const { error } = await supabase.from("learning_memory").delete().eq("id", id);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
