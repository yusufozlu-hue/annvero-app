import { NextResponse } from "next/server";
import { requireApiSession, getApiSupabase } from "@/src/lib/auth/apiGuard";

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const { supabase, guard } = getApiSupabase("push-subscriptions:post", "push_subscriptions");
  if (guard) return guard;

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
          user_id: session.user.id,
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
