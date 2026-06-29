import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

const editableFields = [
  "keyword",
  "account_code",
  "account_name",
  "counter_account_code",
  "counter_account_name",
  "document_type",
  "transaction_type",
  "description_format",
  "source_module",
  "is_active",
];

function buildRecordPayload(record = {}) {
  const payload = { updated_at: new Date().toISOString() };

  for (const field of editableFields) {
    if (record[field] !== undefined) {
      payload[field] = record[field];
    }
  }

  return payload;
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

  const insertPayload = {
    company_id: record.company_id,
    keyword: String(record.keyword).trim(),
    account_code: record.account_code || "",
    account_name: record.account_name || "",
    counter_account_code: record.counter_account_code || "",
    counter_account_name: record.counter_account_name || "",
    document_type: record.document_type || "DK",
    transaction_type: record.transaction_type || "",
    description_format: record.description_format || "",
    source_module: record.source_module || "manual",
    usage_count: Number(record.usage_count || 0),
    is_active: record.is_active !== false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("learning_memory")
    .insert([insertPayload])
    .select("*")
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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

    const { data, error } = await supabase
      .from("learning_memory")
      .update(payload)
      .eq("id", record.id)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
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

    const { data: current, error: readError } = await supabase
      .from("learning_memory")
      .select("usage_count")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      console.error(readError);
      continue;
    }

    const { error: updateError } = await supabase
      .from("learning_memory")
      .update({
        usage_count: Number(current?.usage_count || 0) + increment,
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      console.error(updateError);
      continue;
    }

    results.push({ id, increment });
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
