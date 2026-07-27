/**
 * Supabase invite / magic-link sonrası redirect için güvenli origin allowlist.
 * Amaç: localhost/unknown origin üzerinden token sızıntısını engellemek.
 */

export const ANNVERO_STAGING_SAFE_INVITE_ORIGIN =
  "https://annvero-staging-git-feature-dri-52eed5-yusufozlu-4225s-projects.vercel.app";

// Staging / Vercel Preview gibi "token'ların üretildiği" ortamlar için.
export const ANNVERO_INVITE_REDIRECT_ORIGINS = Object.freeze({
  staging: Object.freeze([ANNVERO_STAGING_SAFE_INVITE_ORIGIN]),
});

export function isAllowedInviteOrigin(origin = "") {
  try {
    const normalized = String(origin).trim();
    if (!normalized) return false;
    const u = new URL(normalized);
    const candidateOrigin = u.origin;
    return ANNVERO_INVITE_REDIRECT_ORIGINS.staging.includes(candidateOrigin);
  } catch {
    return false;
  }
}

