/**
 * Kalıcı rate limit adapter.
 *
 * Backend seçimi (deterministic):
 * 1. UPSTASH_REDIS_REST_URL + TOKEN → upstash
 * 2. ANNVERO_RATE_LIMIT_BACKEND=supabase → supabase (migration 024 gerekir)
 * 3. local/test → memory
 * 4. production/staging → durable yoksa FAIL-CLOSED (memory kullanılmaz)
 *
 * Migration 024 öncesi supabase backend: tablo yoksa fail-closed (memory'ye düşmez).
 */

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  checkRateLimit as memoryCheck,
  buildRateLimitKey,
} from "@/src/lib/security/rateLimitCore";
import { jsonRateLimited } from "@/src/lib/security/rateLimit";
import {
  resolveAnnveroAppEnv,
  isLocalLikeAppEnv,
  ANNVERO_APP_ENVS,
} from "@/src/lib/security/envGuard";

export const RATE_LIMIT_BACKENDS = Object.freeze({
  MEMORY: "memory",
  UPSTASH: "upstash",
  SUPABASE: "supabase",
  UNAVAILABLE: "unavailable",
});

/** Ham IP/email/token bucket_key olarak yazılmaz — SHA-256 hex. */
export function hashRateLimitBucketKey(key = "") {
  return createHash("sha256")
    .update(String(key || "anonymous"), "utf8")
    .digest("hex");
}

function readEnv(name) {
  return String(process.env[name] ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

export function resolveRateLimitBackend(appEnv = resolveAnnveroAppEnv()) {
  if (readEnv("UPSTASH_REDIS_REST_URL") && readEnv("UPSTASH_REDIS_REST_TOKEN")) {
    return RATE_LIMIT_BACKENDS.UPSTASH;
  }
  if (readEnv("ANNVERO_RATE_LIMIT_BACKEND") === "supabase") {
    return RATE_LIMIT_BACKENDS.SUPABASE;
  }
  if (isLocalLikeAppEnv(appEnv)) {
    return RATE_LIMIT_BACKENDS.MEMORY;
  }
  // production / staging: durable zorunlu
  return RATE_LIMIT_BACKENDS.UNAVAILABLE;
}

export function jsonRateLimitMisconfigured() {
  return NextResponse.json(
    {
      error:
        "Rate limit backend yapılandırılmamış. Production'da Upstash veya ANNVERO_RATE_LIMIT_BACKEND=supabase gerekir.",
      code: "RATE_LIMIT_BACKEND_UNAVAILABLE",
    },
    { status: 503, headers: { "Retry-After": "60" } }
  );
}

async function checkUpstashRateLimit(key, { limit = 30, windowMs = 300_000 } = {}) {
  const url = readEnv("UPSTASH_REDIS_REST_URL").replace(/\/$/, "");
  const token = readEnv("UPSTASH_REDIS_REST_TOKEN");
  const bucketKey = `annvero:rl:${key}`;
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));

  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", bucketKey],
      ["EXPIRE", bucketKey, windowSec],
      ["PTTL", bucketKey],
    ]),
  });

  if (!response.ok) {
    throw new Error(`Upstash rate limit HTTP ${response.status}`);
  }

  const data = await response.json();
  const count = Number(data?.[0]?.result || 0);
  const ttlMs = Number(data?.[2]?.result || windowMs);

  if (count > limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterMs: Math.max(1000, ttlMs > 0 ? ttlMs : windowMs),
      backend: RATE_LIMIT_BACKENDS.UPSTASH,
    };
  }

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterMs: 0,
    backend: RATE_LIMIT_BACKENDS.UPSTASH,
  };
}

function isMissingTableError(error) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    /does not exist/i.test(message) ||
    /could not find.*rate_limit_buckets/i.test(message)
  );
}

async function checkSupabaseRateLimit(supabase, key, { limit = 30, windowMs = 300_000 } = {}) {
  if (!supabase) throw new Error("supabase client missing");

  const bucketKey = hashRateLimitBucketKey(key);
  const { data, error } = await supabase.rpc("annvero_rate_limit_consume", {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_ms: windowMs,
  });

  if (error) {
    if (isMissingTableError(error) || /annvero_rate_limit_consume/i.test(String(error.message || ""))) {
      const err = new Error("rate_limit RPC/table missing — migration 024 required");
      err.code = "RATE_LIMIT_TABLE_MISSING";
      throw err;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  const count = Number(row?.current_count || 0);
  const allowed = Boolean(row?.allowed);
  const resetAt = row?.reset_at ? new Date(row.reset_at).getTime() : Date.now() + windowMs;
  const now = Date.now();

  if (!allowed || count > limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterMs: Math.max(0, resetAt - now),
      backend: RATE_LIMIT_BACKENDS.SUPABASE,
    };
  }

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, Number(row?.remaining ?? limit - count)),
    retryAfterMs: 0,
    backend: RATE_LIMIT_BACKENDS.SUPABASE,
  };
}

/**
 * @returns {Promise<{allowed:boolean, limit:number, remaining:number, retryAfterMs:number, backend:string, unavailable?:boolean}>}
 */
export async function checkDurableRateLimit(key, options = {}, { supabase = null } = {}) {
  const appEnv = resolveAnnveroAppEnv();
  const backend = resolveRateLimitBackend(appEnv);

  if (backend === RATE_LIMIT_BACKENDS.UNAVAILABLE) {
    return {
      allowed: false,
      limit: 0,
      remaining: 0,
      retryAfterMs: 60_000,
      backend,
      unavailable: true,
    };
  }

  try {
    if (backend === RATE_LIMIT_BACKENDS.UPSTASH) {
      return await checkUpstashRateLimit(key, options);
    }
    if (backend === RATE_LIMIT_BACKENDS.SUPABASE) {
      return await checkSupabaseRateLimit(supabase, key, options);
    }
  } catch (error) {
    // Production/staging: durable hata → fail-closed (memory yok)
    if (!isLocalLikeAppEnv(appEnv)) {
      console.error("[rateLimit] durable backend failed (fail-closed)", {
        backend,
        code: error?.code || null,
        message: String(error?.message || error).slice(0, 160),
      });
      return {
        allowed: false,
        limit: 0,
        remaining: 0,
        retryAfterMs: 60_000,
        backend: RATE_LIMIT_BACKENDS.UNAVAILABLE,
        unavailable: true,
      };
    }
    console.warn("[rateLimit] durable backend failed, local memory fallback", {
      backend,
      message: String(error?.message || error).slice(0, 160),
    });
  }

  const result = memoryCheck(key, options);
  return { ...result, backend: RATE_LIMIT_BACKENDS.MEMORY };
}

export async function enforceDurableRateLimit(
  request,
  session,
  routeKey,
  options = {},
  { supabase = null } = {}
) {
  const userId = session?.user?.id || session?.user?.email || "";
  const key = buildRateLimitKey(request, routeKey, userId);
  const result = await checkDurableRateLimit(key, options, { supabase });

  if (result.unavailable) {
    return jsonRateLimitMisconfigured();
  }

  if (!result.allowed) {
    return jsonRateLimited(result.retryAfterMs);
  }

  return null;
}

export { buildRateLimitKey, jsonRateLimited, ANNVERO_APP_ENVS };
