import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export async function GET(request) {
  const companyId = request.nextUrl.searchParams.get("companyId");
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
    .eq("is_active", true)
    .order("usage_count", { ascending: false });

  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] });
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
