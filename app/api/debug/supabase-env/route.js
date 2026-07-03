import { NextResponse } from "next/server";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";
import { getSupabaseEnvSafeDiagnostics } from "@/src/lib/supabase/serverAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await getServerSupabaseUser();
  if (!user) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  return NextResponse.json(getSupabaseEnvSafeDiagnostics());
}
