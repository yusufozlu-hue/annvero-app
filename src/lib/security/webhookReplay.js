/**
 * Durable webhook event replay claim.
 * Migration 024 `annvero_rate_limit_consume` (limit=1, ~10 dk pencere) yeniden kullanılır.
 * Namespace genel webhook rate-limit'ten ayrıdır.
 */

import {
  checkDurableRateLimit,
  hashRateLimitBucketKey,
  RATE_LIMIT_BACKENDS,
} from "@/src/lib/security/rateLimitDurable";

export const WEBHOOK_REPLAY_WINDOW_MS = 10 * 60 * 1000;
export const WEBHOOK_REPLAY_NAMESPACE = "webhook:replay";

/**
 * Ham event-id / body loglanmaz — durable store'a giden material namespace'li string;
 * supabase yolunda ayrıca SHA-256 hex'e çevrilir.
 */
export function buildWebhookReplayRateLimitKey(eventKey = "") {
  return `${WEBHOOK_REPLAY_NAMESPACE}:${String(eventKey || "").slice(0, 200)}`;
}

/**
 * Server-only service client — dinamik import (test/browser bundle'a statik sızmaz).
 * Route dosyasında getServerSupabaseAdmin yazılmaz (HMAC webhook oturum guard'ı değil).
 */
export async function getWebhookDurableSupabase() {
  const { getServerSupabaseAdmin } = await import("@/src/lib/supabase/serverAdmin");
  return getServerSupabaseAdmin({ requireServiceRole: true });
}

/**
 * @returns {Promise<{ok:boolean, code?:string, unavailable?:boolean, backend?:string}>}
 */
export async function claimWebhookReplayEvent(eventKey, { supabase = null } = {}) {
  const key = buildWebhookReplayRateLimitKey(eventKey);
  const result = await checkDurableRateLimit(
    key,
    { limit: 1, windowMs: WEBHOOK_REPLAY_WINDOW_MS },
    { supabase }
  );

  if (result.unavailable) {
    return {
      ok: false,
      code: "REPLAY_BACKEND_UNAVAILABLE",
      unavailable: true,
      backend: result.backend || RATE_LIMIT_BACKENDS.UNAVAILABLE,
    };
  }

  if (!result.allowed) {
    return {
      ok: false,
      code: "REPLAY",
      backend: result.backend,
    };
  }

  return {
    ok: true,
    code: "CLAIMED",
    backend: result.backend,
    bucketKeyFingerprint: hashRateLimitBucketKey(key).slice(0, 12),
  };
}
