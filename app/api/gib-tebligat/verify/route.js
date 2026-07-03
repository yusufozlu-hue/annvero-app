import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";
import { hasEncryptionKeyConfigured } from "@/src/lib/gibCredentialsCrypto";
import { verifyCompanyGibQuery } from "@/src/server/gibQueryService";
import { validateVerificationCode } from "@/src/utils/gibTebligatEngine";

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

  const sessionId = String(body?.session_id || body?.sessionId || "").trim();
  const verificationCode = body?.verification_code || body?.verificationCode || "";

  const validation = validateVerificationCode(verificationCode);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId zorunludur." }, { status: 400 });
  }

  const result = await verifyCompanyGibQuery(supabase, sessionId, validation.value);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
