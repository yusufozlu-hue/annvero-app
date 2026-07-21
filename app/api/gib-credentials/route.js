import { NextResponse } from "next/server";
import { assertCompanyAccess, requireApiSession } from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { encryptSecret, maskSecret } from "@/src/lib/gibCredentialsCrypto";
import { getGibEncryptionKeyGuardResponse } from "@/src/lib/gibCredentialsRouteGuard";
import {
  GIB_CREDENTIALS_TABLE,
  GIB_QUERY_STATE_TABLE,
  getGibSupabaseAdmin,
  getGibSupabaseGuardResponse,
  logGibSupabaseDiagnostics,
  logGibSupabaseConnectionError,
} from "@/src/lib/supabase/gibSupabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const rateLimited = enforceRateLimit(request, session, "gib-credentials", {
    limit: 40,
    windowMs: 300_000,
  });
  if (rateLimited) return rateLimited;

  const encryptionKeyError = getGibEncryptionKeyGuardResponse();
  if (encryptionKeyError) return encryptionKeyError;

  const supabaseGuard = getGibSupabaseGuardResponse("gib-credentials:get");
  if (supabaseGuard) return supabaseGuard;

  const supabase = getGibSupabaseAdmin();
  logGibSupabaseDiagnostics("gib-credentials:get", GIB_CREDENTIALS_TABLE);

  const companyId = request.nextUrl.searchParams.get("companyId");
  if (companyId) {
    const check = assertCompanyAccess(session.access, companyId, { required: true });
    if (!check.ok) return check.response;
  }

  let credentialsQuery = supabase.from(GIB_CREDENTIALS_TABLE).select("*");
  if (companyId) credentialsQuery = credentialsQuery.eq("company_id", companyId);

  let stateQuery = supabase.from(GIB_QUERY_STATE_TABLE).select("*");
  if (companyId) {
    stateQuery = stateQuery.eq("company_id", companyId);
  }

  const [{ data: credentials, error }, { data: queryStates, error: stateError }] =
    await Promise.all([credentialsQuery, stateQuery]);

  if (error) {
    logGibSupabaseConnectionError("gib-credentials:get", error, GIB_CREDENTIALS_TABLE);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (stateError) {
    logGibSupabaseConnectionError("gib-credentials:get", stateError, GIB_QUERY_STATE_TABLE);
    return NextResponse.json({ error: stateError.message }, { status: 500 });
  }

  const stateMap = new Map(
    (queryStates || [])
      .filter((row) => session.access.canAccessCompany(row.company_id))
      .map((row) => [row.company_id, row])
  );

  const payload = (credentials || [])
    .filter((row) => session.access.canAccessCompany(row.company_id))
    .map((row) => ({
    companyId: row.company_id,
    gibUserCode: row.gib_user_code,
    hasPassword: Boolean(row.encrypted_password),
    hasParola: Boolean(row.encrypted_parola),
    passwordMasked: row.encrypted_password ? maskSecret("secret") : "",
    parolaMasked: row.encrypted_parola ? maskSecret("secret") : "",
    isActive: row.is_active !== false,
    lastQueryAt: stateMap.get(row.company_id)?.last_query_at || null,
    resultStatus: stateMap.get(row.company_id)?.result_status || null,
    lastError: stateMap.get(row.company_id)?.last_error || null,
  }));

  return NextResponse.json({ data: payload });
}

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const rateLimited = enforceRateLimit(request, session, "gib-credentials", {
    limit: 40,
    windowMs: 300_000,
  });
  if (rateLimited) return rateLimited;

  const encryptionKeyError = getGibEncryptionKeyGuardResponse();
  if (encryptionKeyError) return encryptionKeyError;

  const supabaseGuard = getGibSupabaseGuardResponse("gib-credentials:post");
  if (supabaseGuard) return supabaseGuard;

  const supabase = getGibSupabaseAdmin();
  logGibSupabaseDiagnostics("gib-credentials:post", GIB_CREDENTIALS_TABLE);

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const companyId = String(body?.company_id || body?.companyId || "").trim();
  const gibUserCode = String(body?.gib_user_code || body?.gibUserCode || "").trim();
  const password = String(body?.password || "");
  const parola = String(body?.parola || "");
  const isActive = body?.is_active !== false && body?.isActive !== false;
  const keepExistingSecrets = body?.keepExistingSecrets === true;

  if (!companyId || !gibUserCode) {
    return NextResponse.json(
      { error: "companyId ve gibUserCode zorunludur." },
      { status: 400 }
    );
  }

  const accessCheck = assertCompanyAccess(session.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const { data: existing, error: existingError } = await supabase
    .from(GIB_CREDENTIALS_TABLE)
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (existingError) {
    logGibSupabaseConnectionError("gib-credentials:post", existingError, GIB_CREDENTIALS_TABLE);
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  if (!password && !existing?.encrypted_password && !keepExistingSecrets) {
    return NextResponse.json({ error: "GİB şifresi zorunludur." }, { status: 400 });
  }

  const payload = {
    company_id: companyId,
    gib_user_code: gibUserCode,
    encrypted_password: password
      ? encryptSecret(password)
      : existing?.encrypted_password,
    encrypted_parola: parola
      ? encryptSecret(parola)
      : existing?.encrypted_parola || null,
    is_active: isActive,
    updated_by: session.user.email || session.user.id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(GIB_CREDENTIALS_TABLE)
    .upsert([payload], { onConflict: "company_id" })
    .select()
    .single();

  if (error) {
    logGibSupabaseConnectionError("gib-credentials:post", error, GIB_CREDENTIALS_TABLE);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      companyId: data.company_id,
      gibUserCode: data.gib_user_code,
      hasPassword: Boolean(data.encrypted_password),
      hasParola: Boolean(data.encrypted_parola),
      passwordMasked: data.encrypted_password ? maskSecret("secret") : "",
      parolaMasked: data.encrypted_parola ? maskSecret("secret") : "",
      isActive: data.is_active !== false,
    },
  });
}

export async function DELETE(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const supabaseGuard = getGibSupabaseGuardResponse("gib-credentials:delete");
  if (supabaseGuard) return supabaseGuard;

  const supabase = getGibSupabaseAdmin();
  logGibSupabaseDiagnostics("gib-credentials:delete", GIB_CREDENTIALS_TABLE);

  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunludur." }, { status: 400 });
  }

  const accessCheck = assertCompanyAccess(session.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const { error } = await supabase
    .from(GIB_CREDENTIALS_TABLE)
    .delete()
    .eq("company_id", companyId);

  if (error) {
    logGibSupabaseConnectionError("gib-credentials:delete", error, GIB_CREDENTIALS_TABLE);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
