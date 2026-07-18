/**
 * AuthGate modül önbelleği — bileşenden ayrı tutulur (circular import yok).
 */

/** @type {"loading"|"authenticated"|"unauthenticated"} */
let cachedAuthStatus = "loading";

export function getCachedAuthStatus() {
  return cachedAuthStatus;
}

export function setCachedAuthStatus(next) {
  cachedAuthStatus = next;
}

export function resetAuthGateCache() {
  cachedAuthStatus = "loading";
}

export const ANNVERO_AUTH_INVALID_EVENT = "annvero:auth-invalid";

export function emitAuthInvalid() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(ANNVERO_AUTH_INVALID_EVENT));
  } catch {
    // ignore
  }
}
