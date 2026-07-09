/**
 * /api/auth/me istemci önbelleği — Güvenlik Faz 2 performans.
 * Shell + sidebar + company list aynı oturumda tekrar tekrar çağırmasın.
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

/**
 * @param {{ force?: boolean, ttlMs?: number }} options
 * @returns {Promise<{ response: Response, data: object }>}
 */
export async function fetchAuthMe({ force = false, ttlMs = DEFAULT_TTL_MS } = {}) {
  const now = Date.now();

  if (!force && cache && now - cacheAt < ttlMs) {
    return cache;
  }

  if (!force && inFlight) {
    return inFlight;
  }

  inFlight = fetch("/api/auth/me", { cache: "no-store", credentials: "include" })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      const result = { response, data };
      cache = result;
      cacheAt = Date.now();
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
