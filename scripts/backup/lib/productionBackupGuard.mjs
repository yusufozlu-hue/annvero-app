/**
 * Production Storage backup hedef kilidi.
 * Yalnız production ref kabul edilir; staging ve diğer ref'ler fail-closed.
 */

export const PRODUCTION_PROJECT_REF = "ttxigznwcjvrlzuppbro";
export const STAGING_PROJECT_REF = "bveipjvbopbkvojfdpmo";
export const PRODUCTION_S3_PREFIX = "production";
export const PRODUCTION_SOURCE_METADATA = "annvero-production";
export const IMMUTABLE_RETENTION_DAYS = 35;

export function normalize(value = "") {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

export function extractSupabaseProjectRef(supabaseUrl = "") {
  try {
    const host = new URL(supabaseUrl).hostname;
    return host.match(/^([a-z0-9-]+)\.supabase\.co$/i)?.[1]?.toLowerCase() || "";
  } catch {
    return "";
  }
}

export function assertProductionBackupTarget({
  supabaseUrl = "",
  projectRef = "",
  mode = "dry-run",
} = {}) {
  const normalizedMode = normalize(mode).toLowerCase() || "dry-run";
  const ref =
    normalize(projectRef).toLowerCase() ||
    extractSupabaseProjectRef(supabaseUrl);

  if (!["dry-run", "inventory", "live"].includes(normalizedMode)) {
    return {
      ok: false,
      blocked: true,
      code: "INVALID_MODE",
      projectRef: ref,
      mode: normalizedMode,
    };
  }

  if (normalizedMode === "dry-run" && !ref) {
    return {
      ok: true,
      blocked: false,
      code: "PASS",
      projectRef: "(synthetic)",
      mode: normalizedMode,
    };
  }

  if (!ref) {
    return {
      ok: false,
      blocked: true,
      code: "PRODUCTION_REF_REQUIRED",
      projectRef: "",
      mode: normalizedMode,
    };
  }
  if (ref === STAGING_PROJECT_REF) {
    return {
      ok: false,
      blocked: true,
      code: "STAGING_REF_FORBIDDEN",
      projectRef: ref,
      mode: normalizedMode,
    };
  }
  if (ref !== PRODUCTION_PROJECT_REF) {
    return {
      ok: false,
      blocked: true,
      code: "NON_PRODUCTION_REF_FORBIDDEN",
      projectRef: ref,
      mode: normalizedMode,
    };
  }

  return {
    ok: true,
    blocked: false,
    code: "PASS",
    projectRef: ref,
    mode: normalizedMode,
  };
}

export function redactSecrets(text = "") {
  return String(text)
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "sb_secret_[REDACTED]")
    .replace(
      /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[JWT_REDACTED]"
    )
    .replace(
      /(service_role|apikey|authorization)["']?\s*[:=]\s*["'][^"']+/gi,
      "$1=[REDACTED]"
    );
}

export function encodePathPart(value) {
  return Buffer.from(normalize(value), "utf8").toString("base64url");
}

export function safeLocalObjectPath(root, bucket, objectPath) {
  const bucketPart = encodePathPart(bucket);
  const objectPart = encodePathPart(objectPath);
  if (!bucketPart || !objectPart) throw new Error("invalid source object path");
  return `${root}/objects/${bucketPart}/${objectPart}.bin`;
}
