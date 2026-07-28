/**
 * Supabase invite / magic-link sonrası redirect için güvenli origin allowlist.
 * Amaç: localhost/unknown origin üzerinden token sızıntısını engellemek.
 */

export const ANNVERO_STAGING_SAFE_INVITE_ORIGIN =
  "https://annvero-staging-git-feature-dri-52eed5-yusufozlu-4225s-projects.vercel.app";

export const ANNVERO_INVITE_CALLBACK_PATH = "/auth/callback";

export const ANNVERO_INVITE_REDIRECT_ORIGINS = Object.freeze({
  staging: Object.freeze([ANNVERO_STAGING_SAFE_INVITE_ORIGIN]),
});

export function isLocalHostHostname(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]"
  );
}

export function isAllowedInviteOrigin(origin = "") {
  try {
    const normalized = String(origin).trim();
    if (!normalized) return false;
    const u = new URL(normalized);
    if (u.protocol !== "https:") return false;
    if (isLocalHostHostname(u.hostname)) return false;
    return ANNVERO_INVITE_REDIRECT_ORIGINS.staging.includes(u.origin);
  } catch {
    return false;
  }
}

/**
 * Yalnız sabit staging alias + /auth/callback kabul edilir.
 * Aksi halde false.
 */
export function isAllowedInviteCallbackUrl(value = "") {
  try {
    const cleaned = String(value || "").trim().replace(/\/$/, "");
    if (!cleaned) return false;
    const u = new URL(cleaned);
    if (!isAllowedInviteOrigin(u.origin)) return false;
    return u.pathname === ANNVERO_INVITE_CALLBACK_PATH;
  } catch {
    return false;
  }
}

export function buildStagingInviteCallbackUrl() {
  return `${ANNVERO_STAGING_SAFE_INVITE_ORIGIN}${ANNVERO_INVITE_CALLBACK_PATH}`;
}
