import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAnonKeyType, getSupabaseConfig } from "@/src/lib/supabase/config";
import { redactDeep } from "@/src/lib/security/redact";

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

export function getSupabaseApiKeyFormat(apiKey = "") {
  const key = String(apiKey);
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("eyJ")) return "jwt";
  return "unknown";
}

export function getSupabaseKeyPrefixType(prefix = "") {
  if (prefix.startsWith("sb_secret_")) return "sb_secret_";
  if (prefix.startsWith("eyJ")) return "eyJhbGci";
  if (prefix.startsWith("sb_publishable_")) return "sb_publishable_";
  return "other";
}

export function getSupabaseEnvSafeDiagnostics() {
  const runtimeUrl = readServerEnv(SUPABASE_URL_ENV);
  const serviceRoleKey = readServerEnv(SERVICE_ROLE_ENV);
  const config = getSupabaseConfig();
  const anonKey = config?.anonKey || readServerEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return {
    hasNextPublicSupabaseUrl: Boolean(runtimeUrl),
    projectRef: extractSupabaseProjectRef(config?.supabaseUrl || runtimeUrl),
    hasSupabaseServiceRoleKey: Boolean(serviceRoleKey),
    serviceRoleKeyConfigured: Boolean(serviceRoleKey),
    serviceRoleKeyFormat: getSupabaseApiKeyFormat(serviceRoleKey),
    hasAnonKey: Boolean(anonKey),
    anonKeyConfigured: Boolean(anonKey),
    anonKeyFormat: getSupabaseApiKeyFormat(anonKey),
  };
}

function isInvalidApiKeyError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("invalid api key");
}

function createSupabaseServerFetch(apiKey) {
  const keyFormat = getSupabaseApiKeyFormat(apiKey);

  return async (input, init = {}) => {
    const headers = new Headers(init.headers);

    // New sb_* keys must not be sent as Authorization Bearer.
    // supabase-js adds Bearer automatically; strip it for non-JWT keys.
    if (keyFormat === "secret" || keyFormat === "publishable") {
      headers.delete("Authorization");
    }

    return fetch(input, { ...init, headers });
  };
}

export function getSupabaseConnectionDiagnostics({ table = null, apiKey = null, keyType = null } = {}) {
  const config = getSupabaseConfig();
  const runtimeUrl = readServerEnv(SUPABASE_URL_ENV);
  const serviceRoleKey = readServerEnv(SERVICE_ROLE_ENV);
  const resolvedKey = apiKey || serviceRoleKey || config?.anonKey || "";
  const resolvedKeyFormat = getSupabaseApiKeyFormat(resolvedKey);
  const resolvedKeyType =
    keyType || (serviceRoleKey ? "service_role" : "anon");

  return {
    supabaseUrl: config?.supabaseUrl || runtimeUrl || "",
    runtimeUrl,
    projectRef: extractSupabaseProjectRef(config?.supabaseUrl || runtimeUrl),
    table,
    keyType: resolvedKeyType,
    keyFormat: resolvedKeyFormat,
    hasServiceRoleKey: Boolean(serviceRoleKey),
    anonKeyType: config ? getSupabaseAnonKeyType(config.anonKey) : "unknown",
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
  const keyFormat = getSupabaseApiKeyFormat(apiKey);
  const signature = `${config.supabaseUrl}:service_role:${keyFormat}:${apiKey.slice(0, 20)}`;

  if (!cachedClient || cachedSignature !== signature) {
    cachedClient = createClient(config.supabaseUrl, apiKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: createSupabaseServerFetch(apiKey),
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

  const serviceRoleKey = readServerEnv(SERVICE_ROLE_ENV);
  const keyFormat = getSupabaseApiKeyFormat(serviceRoleKey);
  if (keyFormat !== "secret" && keyFormat !== "jwt") {
    console.error(`[${context}] Unsupported SUPABASE_SERVICE_ROLE_KEY format`, diagnostics);
    return Response.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY geçersiz. sb_secret_... veya legacy eyJ... service role anahtarı kullanın.",
      },
      { status: 500 }
    );
  }

  return null;
}

export function logSupabaseQueryError(context, error, table, options = {}) {
  const diagnostics = getSupabaseConnectionDiagnostics({ table });
  const payload = redactDeep({
    message: error?.message || String(error),
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
    diagnostics: {
      projectRef: diagnostics.projectRef,
      table: diagnostics.table,
      keyType: diagnostics.keyType,
      keyFormat: diagnostics.keyFormat,
      hasServiceRoleKey: diagnostics.hasServiceRoleKey,
      anonKeyType: diagnostics.anonKeyType,
    },
  });

  if (isInvalidApiKeyError(error)) {
    console.error(`[${context}] Supabase Invalid API key`, {
      ...payload,
      invalidApiKeyDiagnostics: {
        usedKeyType: options.usedKeyType || diagnostics.keyType,
        usedKeyFormat: diagnostics.keyFormat,
        projectRef: diagnostics.projectRef,
        table,
      },
    });
    return;
  }

  console.error(`[${context}] Supabase query failed`, payload);
}
