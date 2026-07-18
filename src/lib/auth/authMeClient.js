/**
 * /api/auth/me istemci önbelleği — tek in-flight, unauthenticated cache yok.
 */

const DEFAULT_TTL_MS = 45_000;

let cache = null;
let cacheAt = 0;
let inFlight = null;

export function invalidateAuthMeCache() {
  cache = null;
  cacheAt = 0;
  inFlight = null;
}

/** Senkron önbellek okuma — loading flicker'ını önlemek için. */
export function peekAuthMeCache() {
  if (!cache) return null;
  if (Date.now() - cacheAt >= DEFAULT_TTL_MS) return null;
  return cache;
}

/**
 * @param {{ force?: boolean, ttlMs?: number }} options
 * @returns {Promise<{ response: Response, data: object }>}
 */
export async function fetchAuthMe({ force = false, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (inFlight) {
    return inFlight;
  }

  const now = Date.now();
  if (!force && cache && now - cacheAt < ttlMs) {
    return cache;
  }

  if (force) {
    cache = null;
    cacheAt = 0;
  }

  inFlight = fetch("/api/auth/me", { cache: "no-store", credentials: "include" })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      const result = { response, data };
      if (data?.authenticated) {
        cache = result;
        cacheAt = Date.now();
      } else {
        cache = null;
        cacheAt = 0;
      }
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
