import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

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

  if (!body?.endpoint || !body?.p256dh || !body?.auth) {
    return NextResponse.json({ error: "Push abonelik alanları zorunludur." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("push_subscriptions")
    .upsert(
      [
        {
          user_id: body.user_id || null,
          endpoint: body.endpoint,
          p256dh: body.p256dh,
          auth: body.auth,
        },
      ],
      { onConflict: "endpoint" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
