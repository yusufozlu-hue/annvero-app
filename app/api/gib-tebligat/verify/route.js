import { NextResponse } from "next/server";
import { getGibAutomationGuardResponse } from "@/src/lib/gibAutomationRouteGuard";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";
import { getGibEncryptionKeyGuardResponse } from "@/src/lib/gibCredentialsRouteGuard";
import {
  getGibSupabaseAdmin,
  getGibSupabaseGuardResponse,
  logGibSupabaseDiagnostics,
} from "@/src/lib/supabase/gibSupabase";
import { verifyCompanyGibQuery } from "@/src/server/gibQueryService";
import { validateVerificationCode } from "@/src/utils/gibTebligatEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request) {
  const { user } = await getServerSupabaseUser();
  if (!user) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  const encryptionKeyError = getGibEncryptionKeyGuardResponse();
  if (encryptionKeyError) return encryptionKeyError;

  const automationGuard = getGibAutomationGuardResponse();
  if (automationGuard) return automationGuard;

  const supabaseGuard = getGibSupabaseGuardResponse("gib-tebligat:verify");
  if (supabaseGuard) return supabaseGuard;

  const supabase = getGibSupabaseAdmin();
  logGibSupabaseDiagnostics("gib-tebligat:verify");

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
