/**
 * Basit rate limit — Güvenlik Faz 2.
 * In-memory sliding window (serverless instance başına).
 *
 * Production için Redis / Upstash önerilir:
 * - Vercel serverless'ta instance'lar arası paylaşılmaz.
 * - Kritik endpoint'lerde Upstash Ratelimit veya @upstash/redis ile
 *   `rateLimit:{route}:{userId}` anahtarı kullanın.
 */

import { NextResponse } from "next/server";
import {
  checkRateLimit,
  buildRateLimitKey,
  resetRateLimitBuckets,
} from "@/src/lib/security/rateLimitCore";

export { checkRateLimit, buildRateLimitKey, resetRateLimitBuckets };

export function jsonRateLimited(retryAfterMs = 60_000) {
  const retrySeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    {
      error: `Çok fazla istek gönderildi. Lütfen ${retrySeconds} saniye sonra tekrar deneyin.`,
      code: "RATE_LIMITED",
      retryAfterSeconds: retrySeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retrySeconds),
      },
    }
  );
}

/**
 * Rate limit uygular; engellenirse NextResponse döner, aksi halde null.
 */
export function enforceRateLimit(request, session, routeKey, options = {}) {
  const userId = session?.user?.id || session?.user?.email || "";
  const key = buildRateLimitKey(request, routeKey, userId);
  const result = checkRateLimit(key, options);

  if (!result.allowed) {
    return jsonRateLimited(result.retryAfterMs);
  }

  return null;
}
