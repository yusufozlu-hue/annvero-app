import { NextResponse } from "next/server";
import { assertCompanyAccess, requireApiSession } from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { getGibAutomationGuardResponse } from "@/src/lib/gibAutomationRouteGuard";
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
  const session = await requireApiSession();
  if (session.error) return session.error;

  const rateLimited = enforceRateLimit(request, session, "gib-tebligat:query", {
    limit: 10,
    windowMs: 600_000,
  });
  if (rateLimited) return rateLimited;

  const encryptionKeyError = getGibEncryptionKeyGuardResponse();
  if (encryptionKeyError) return encryptionKeyError;

  const automationGuard = getGibAutomationGuardResponse();
  if (automationGuard) return automationGuard;

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

  const accessCheck = assertCompanyAccess(session.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const result = await startCompanyGibQuery(supabase, companyId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
