import { createClient } from "@supabase/supabase-js";
import { getSupabaseAnonKeyType, getSupabaseConfig } from "@/src/lib/supabase/config";

const SERVICE_ROLE_ENV = "SUPABASE_SERVICE_ROLE_KEY";
const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";

function readServerEnv(name) {
  return String(process.env[name] ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

export function extractSupabaseProjectRef(supabaseUrl = "") {
  try {
    const host = new URL(supabaseUrl).hostname;
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1] || host;
  } catch {
    return "unknown";
  }
}

function decodeJwtPayload(token = "") {
  try {
    const parts = String(token).split(".");
    if (parts.length < 2) return null;
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function validateSupabaseProjectMatch(supabaseUrl, apiKey) {
  const urlRef = extractSupabaseProjectRef(supabaseUrl);
  const payload = decodeJwtPayload(apiKey);
  const keyRef = payload?.ref || null;

  if (!keyRef) {
    return { ok: true, urlRef, keyRef: null };
  }

  if (keyRef !== urlRef) {
    return { ok: false, urlRef, keyRef };
  }

  return { ok: true, urlRef, keyRef };
}

export function getSupabaseConnectionDiagnostics({ table = null, apiKey = null, keyType = null } = {}) {
  const config = getSupabaseConfig();
  const runtimeUrl = readServerEnv(SUPABASE_URL_ENV);
  const serviceRoleKey = readServerEnv(SERVICE_ROLE_ENV);
  const resolvedKeyType = keyType || (serviceRoleKey ? "service_role" : "anon");
  const resolvedKey = apiKey || serviceRoleKey || config?.anonKey || "";

  return {
    supabaseUrl: config?.supabaseUrl || runtimeUrl || "",
    runtimeUrl,
    projectRef: extractSupabaseProjectRef(config?.supabaseUrl || runtimeUrl),
    table,
    keyType: resolvedKeyType,
    hasServiceRoleKey: Boolean(serviceRoleKey),
    anonKeyType: config ? getSupabaseAnonKeyType(config.anonKey) : "unknown",
    projectMatch: config
      ? validateSupabaseProjectMatch(config.supabaseUrl, resolvedKey)
      : { ok: false, urlRef: "unknown", keyRef: null },
  };
}

export function logSupabaseQueryDiagnostics(context, table) {
  const diagnostics = getSupabaseConnectionDiagnostics({ table });
  console.info(`[${context}] Supabase query diagnostics`, diagnostics);
  return diagnostics;
}

let cachedClient = null;
let cachedSignature = null;

export function getServerSupabaseAdmin({ requireServiceRole = false } = {}) {
  const config = getSupabaseConfig();
  if (!config) {
    return null;
  }

  const serviceRoleKey = readServerEnv(SERVICE_ROLE_ENV);
  if (requireServiceRole && !serviceRoleKey) {
    return null;
  }

  const apiKey = serviceRoleKey || config.anonKey;
  const keyType = serviceRoleKey ? "service_role" : "anon";
  const signature = `${config.supabaseUrl}:${keyType}:${apiKey.slice(0, 16)}`;

  if (!cachedClient || cachedSignature !== signature) {
    cachedClient = createClient(config.supabaseUrl, apiKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    cachedSignature = signature;
  }

  return cachedClient;
}

export function getServerSupabaseAdminGuardResponse(context, table) {
  const diagnostics = logSupabaseQueryDiagnostics(context, table);
  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });

  if (!supabase) {
    console.error(`[${context}] Missing SUPABASE_SERVICE_ROLE_KEY`, diagnostics);
    return Response.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY yapılandırılmamış." },
      { status: 500 }
    );
  }

  if (!diagnostics.projectMatch.ok) {
    console.error(`[${context}] Supabase project mismatch`, diagnostics);
    return Response.json(
      {
        error: `Supabase proje uyumsuzluğu: URL ref=${diagnostics.projectMatch.urlRef}, key ref=${diagnostics.projectMatch.keyRef}`,
      },
      { status: 500 }
    );
  }

  return null;
}

export function logSupabaseQueryError(context, error, table) {
  const diagnostics = getSupabaseConnectionDiagnostics({ table });
  console.error(`[${context}] Supabase query failed`, {
    message: error?.message || String(error),
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
    diagnostics,
  });
}
