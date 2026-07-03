import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";
import {
  encryptSecret,
  hasEncryptionKeyConfigured,
  maskSecret,
} from "@/src/lib/gibCredentialsCrypto";

export async function GET(request) {
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

  const companyId = request.nextUrl.searchParams.get("companyId");

  let credentialsQuery = supabase.from("company_gib_credentials").select("*");
  if (companyId) credentialsQuery = credentialsQuery.eq("company_id", companyId);

  const [{ data: credentials, error }, { data: queryStates }] = await Promise.all([
    credentialsQuery,
    supabase.from("gib_company_query_state").select("*"),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stateMap = new Map((queryStates || []).map((row) => [row.company_id, row]));

  const payload = (credentials || []).map((row) => ({
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

  const { data: existing } = await supabase
    .from("company_gib_credentials")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

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
    updated_by: user.email || user.id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("company_gib_credentials")
    .upsert([payload], { onConflict: "company_id" })
    .select()
    .single();

  if (error) {
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
  const { user } = await getServerSupabaseUser();
  if (!user) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase yapılandırılmamış." }, { status: 500 });
  }

  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunludur." }, { status: 400 });
  }

  const { error } = await supabase
    .from("company_gib_credentials")
    .delete()
    .eq("company_id", companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
