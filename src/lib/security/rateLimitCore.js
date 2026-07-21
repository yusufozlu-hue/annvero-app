/**
 * Rate limit çekirdeği — Next.js bağımlılığı yok (test edilebilir).
 */

const buckets = new Map();

const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanupExpired(now) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, entry] of buckets.entries()) {
    if (entry.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

/**
 * @param {string} key
 * @param {{ limit?: number, windowMs?: number }} options
 */
export function checkRateLimit(key, { limit = 30, windowMs = 300_000 } = {}) {
  const now = Date.now();
  cleanupExpired(now);

  const bucketKey = String(key || "anonymous");
  let entry = buckets.get(bucketKey);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(bucketKey, entry);
  }

  entry.count += 1;

  if (entry.count > limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterMs: Math.max(0, entry.resetAt - now),
      resetAt: entry.resetAt,
    };
  }

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfterMs: 0,
    resetAt: entry.resetAt,
  };
}

export function buildRateLimitKey(request, routeKey, userId = "") {
  const ip =
    request?.headers?.get?.("x-forwarded-for")?.split(",")?.[0]?.trim() ||
    request?.headers?.get?.("x-real-ip") ||
    "unknown";
  const actor = String(userId || "").trim() || `ip:${ip}`;
  return `${routeKey}:${actor}`;
}

export function resetRateLimitBuckets() {
  buckets.clear();
  lastCleanup = Date.now();
}
