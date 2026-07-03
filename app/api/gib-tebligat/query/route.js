import { NextResponse } from "next/server";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";
import { getGibEncryptionKeyGuardResponse } from "@/src/lib/gibCredentialsRouteGuard";
import {
  getGibSupabaseAdmin,
  getGibSupabaseGuardResponse,
  logGibSupabaseDiagnostics,
} from "@/src/lib/supabase/gibSupabase";
import { startCompanyGibQuery } from "@/src/server/gibQueryService";

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

  const supabaseGuard = getGibSupabaseGuardResponse("gib-tebligat:query");
  if (supabaseGuard) return supabaseGuard;

  const supabase = getGibSupabaseAdmin();
  logGibSupabaseDiagnostics("gib-tebligat:query");

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
