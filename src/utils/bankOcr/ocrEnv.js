/**
 * OCR ortam anahtarları — değerleri loglama / istemciye sızdırma.
 * Drive OAuth secret’ları OCR credential olarak kullanılmaz.
 */

export const OCR_PROVIDER_GOOGLE_VISION = "google-vision";
export const OCR_PROVIDER_LOCAL_TEST = "local-test";
export const OCR_PROVIDER_NONE = "none";

export const OCR_ENV_KEYS = Object.freeze({
  provider: "ANNVERO_OCR_PROVIDER",
  projectId: "ANNVERO_OCR_GCP_PROJECT_ID",
  clientEmail: "ANNVERO_OCR_GCP_CLIENT_EMAIL",
  privateKey: "ANNVERO_OCR_GCP_PRIVATE_KEY",
  /** Opsiyonel tek JSON (service account) — değer asla loglanmaz */
  saJson: "ANNVERO_OCR_GCP_SA_JSON",
});

function readEnv(env, key) {
  if (env && typeof env === "object" && env[key] != null) {
    return String(env[key]).trim();
  }
  if (typeof process !== "undefined" && process.env?.[key] != null) {
    return String(process.env[key]).trim();
  }
  return "";
}

function parseSaJson(raw) {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * Google Vision için credential parçalarını oku (değerleri dışarı sızdırma).
 * @returns {{ projectId: string, clientEmail: string, privateKey: string } | null}
 */
export function resolveGoogleVisionCredentials(env) {
  const sa = parseSaJson(readEnv(env, OCR_ENV_KEYS.saJson));
  const projectId =
    readEnv(env, OCR_ENV_KEYS.projectId) ||
    String(sa?.project_id || "").trim();
  const clientEmail =
    readEnv(env, OCR_ENV_KEYS.clientEmail) ||
    String(sa?.client_email || "").trim();
  let privateKey =
    readEnv(env, OCR_ENV_KEYS.privateKey) ||
    String(sa?.private_key || "").trim();
  if (privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }
  if (!projectId || !clientEmail || !privateKey) return null;
  // Drive OAuth secret’ını OCR olarak reddet (yanlış env bağlama)
  if (
    clientEmail === readEnv(env, "GOOGLE_DRIVE_CLIENT_ID") ||
    privateKey === readEnv(env, "GOOGLE_DRIVE_CLIENT_SECRET")
  ) {
    return null;
  }
  return { projectId, clientEmail, privateKey };
}

export function hasGoogleVisionCredentials(env) {
  return Boolean(resolveGoogleVisionCredentials(env));
}

export function isProductionRuntime(env) {
  const nodeEnv =
    (env && typeof env === "object" ? env.NODE_ENV : "") ||
    (typeof process !== "undefined" ? process.env?.NODE_ENV : "") ||
    "";
  const vercelEnv =
    (env && typeof env === "object" ? env.VERCEL_ENV : "") ||
    (typeof process !== "undefined" ? process.env?.VERCEL_ENV : "") ||
    "";
  return (
    String(nodeEnv).toLowerCase() === "production" ||
    String(vercelEnv).toLowerCase() === "production"
  );
}

/** local-test yalnız non-production (veya açık test) ortamında. */
export function allowLocalTestProvider(env) {
  if (isProductionRuntime(env)) return false;
  const nodeEnv =
    (env && typeof env === "object" ? env.NODE_ENV : "") ||
    (typeof process !== "undefined" ? process.env?.NODE_ENV : "") ||
    "";
  if (String(nodeEnv).toLowerCase() === "test") return true;
  return true;
}
