import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";
import { hasEncryptionKeyConfigured } from "@/src/lib/gibCredentialsCrypto";
import { startCompanyGibQuery } from "@/src/server/gibQueryService";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request) {
  const { user } = await getServerSupabaseUser();
  if (!user) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  if (!hasEncryptionKeyConfigured()) {
    return NextResponse.json(
      { error: "GIB_CREDENTIALS_ENCRYPTION_KEY yapılandırılmamış." },
      { status: 500 }
    );
  }

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

  const companyId = String(body?.company_id || body?.companyId || "").trim();
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunludur." }, { status: 400 });
  }

  const result = await startCompanyGibQuery(supabase, companyId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
