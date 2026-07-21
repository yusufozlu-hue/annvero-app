/**
 * Ortam ayrımı ve production/staging ref fail-closed koruması.
 * Server-only kullanım için tasarlandı; gerçek secret içermez.
 */

export const ANNVERO_KNOWN_PROJECT_REFS = Object.freeze({
  production: "ttxigznwcjvrlzuppbro",
  staging: "bveipjvbopbkvojfdpmo",
});

export const ANNVERO_APP_ENVS = Object.freeze({
  DEVELOPMENT: "development",
  TEST: "test",
  STAGING: "staging",
  PRODUCTION: "production",
});

function normalize(value = "") {
  return String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

export function extractSupabaseProjectRef(supabaseUrl = "") {
  try {
    const host = new URL(supabaseUrl).hostname;
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

/**
 * Uygulama ortamı. Vercel/Railway NODE_ENV=production olsa bile
 * ANNVERO_APP_ENV ile staging ayrılabilir.
 */
export function resolveAnnveroAppEnv() {
  const explicit = normalize(process.env.ANNVERO_APP_ENV).toLowerCase();
  if (Object.values(ANNVERO_APP_ENVS).includes(explicit)) {
    return explicit;
  }

  const vercelEnv = normalize(process.env.VERCEL_ENV).toLowerCase();
  if (vercelEnv === "production") return ANNVERO_APP_ENVS.PRODUCTION;
  if (vercelEnv === "preview") return ANNVERO_APP_ENVS.STAGING;

  const nodeEnv = normalize(process.env.NODE_ENV).toLowerCase();
  if (nodeEnv === "test") return ANNVERO_APP_ENVS.TEST;
  if (nodeEnv === "production") return ANNVERO_APP_ENVS.PRODUCTION;
  return ANNVERO_APP_ENVS.DEVELOPMENT;
}

export function isLocalLikeAppEnv(appEnv = resolveAnnveroAppEnv()) {
  return (
    appEnv === ANNVERO_APP_ENVS.DEVELOPMENT ||
    appEnv === ANNVERO_APP_ENVS.TEST
  );
}

/** Vercel Preview deployment (branch preview). */
export function isVercelPreviewEnv() {
  return normalize(process.env.VERCEL_ENV).toLowerCase() === "preview";
}

/**
 * Production / staging / Vercel Preview — secret’sız fail-open yasak.
 * NODE_ENV=production tek başına yeterli değildir; merkezî ortam çözümlemesi + Preview.
 * Yerel development/test (Preview değil) hariç tutulur.
 */
export function requiresStrictRuntimeSecrets(appEnv = resolveAnnveroAppEnv()) {
  if (isVercelPreviewEnv()) return true;
  return (
    appEnv === ANNVERO_APP_ENVS.PRODUCTION ||
    appEnv === ANNVERO_APP_ENVS.STAGING
  );
}

/**
 * Gerçek local development/test (Vercel Preview değil).
 * DEV_OPEN / recovery default-on yalnız burada.
 */
export function isLocalDevOrTestEnv(appEnv = resolveAnnveroAppEnv()) {
  return isLocalLikeAppEnv(appEnv) && !isVercelPreviewEnv();
}

export function isKnownRemoteProjectRef(projectRef = "") {
  const ref = normalize(projectRef).toLowerCase();
  return (
    ref === ANNVERO_KNOWN_PROJECT_REFS.production ||
    ref === ANNVERO_KNOWN_PROJECT_REFS.staging
  );
}

export function isRemoteSupabaseOverrideAllowed() {
  return normalize(process.env.ANNVERO_ALLOW_REMOTE_SUPABASE) === "1";
}

/**
 * Development/test ortamında production veya staging Supabase ref'i
 * kullanılırsa fail-closed. Override yalnızca açık env ile.
 */
export function assertSafeSupabaseProjectRef({
  supabaseUrl = "",
  projectRef = "",
  appEnv = resolveAnnveroAppEnv(),
} = {}) {
  const ref =
    normalize(projectRef).toLowerCase() ||
    extractSupabaseProjectRef(supabaseUrl).toLowerCase();

  if (!ref) {
    return { ok: true, projectRef: "", appEnv, blocked: false };
  }

  const remote = isKnownRemoteProjectRef(ref);
  if (!remote || !isLocalLikeAppEnv(appEnv)) {
    return { ok: true, projectRef: ref, appEnv, blocked: false };
  }

  if (isRemoteSupabaseOverrideAllowed()) {
    return {
      ok: true,
      projectRef: ref,
      appEnv,
      blocked: false,
      override: true,
      warning:
        "ANNVERO_ALLOW_REMOTE_SUPABASE=1 ile bilinen remote Supabase ref'ine izin verildi.",
    };
  }

  const kind =
    ref === ANNVERO_KNOWN_PROJECT_REFS.production ? "production" : "staging";

  return {
    ok: false,
    projectRef: ref,
    appEnv,
    blocked: true,
    code: "REMOTE_SUPABASE_REF_BLOCKED",
    message: `Yerel/test ortamında bilinen ${kind} Supabase project ref kullanılamaz (${ref}). Yerel bir proje kullanın veya ANNVERO_ALLOW_REMOTE_SUPABASE=1 ile bilinçli override yapın.`,
  };
}

/** Public env'de asla bulunmaması gereken isimler */
export const FORBIDDEN_PUBLIC_ENV_NAMES = Object.freeze([
  "SUPABASE_SERVICE_ROLE_KEY",
  "GIB_CREDENTIALS_ENCRYPTION_KEY",
  "GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY",
  "GIB_AUTOMATION_SERVICE_TOKEN",
  "N8N_AUTOMATION_WEBHOOK_SECRET",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "SUPABASE_DB_PASSWORD",
]);

export function findForbiddenPublicEnvLeaks(envSource = process.env) {
  const leaks = [];
  for (const name of FORBIDDEN_PUBLIC_ENV_NAMES) {
    const publicName = `NEXT_PUBLIC_${name}`;
    if (normalize(envSource[publicName])) {
      leaks.push(publicName);
    }
  }

  // NEXT_PUBLIC_* içinde service/secret pattern
  for (const [key, value] of Object.entries(envSource || {})) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    const v = normalize(value);
    if (!v) continue;
    if (
      v.startsWith("sb_secret_") ||
      /service[_-]?role/i.test(key) ||
      /encryption[_-]?key/i.test(key) ||
      /password/i.test(key) ||
      /private[_-]?key/i.test(key)
    ) {
      leaks.push(key);
    }
  }

  return [...new Set(leaks)];
}

export function validateAnnveroRuntimeEnv({
  supabaseUrl = normalize(process.env.NEXT_PUBLIC_SUPABASE_URL),
  throwOnError = false,
} = {}) {
  const appEnv = resolveAnnveroAppEnv();
  const projectRef = extractSupabaseProjectRef(supabaseUrl);
  const refCheck = assertSafeSupabaseProjectRef({ supabaseUrl, projectRef, appEnv });
  const publicLeaks = findForbiddenPublicEnvLeaks();

  const errors = [];
  if (!refCheck.ok) errors.push(refCheck.message);
  if (publicLeaks.length) {
    errors.push(
      `Public ortam değişkenlerinde sunucu secret'ı tespit edildi: ${publicLeaks.join(", ")}`
    );
  }

  const result = {
    ok: errors.length === 0,
    appEnv,
    projectRef,
    refCheck,
    publicLeaks,
    errors,
  };

  if (!result.ok && throwOnError) {
    throw new Error(errors.join(" | "));
  }

  return result;
}
