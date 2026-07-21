/**
 * Webhook kimlik doğrulama — HMAC + timestamp + constant-time + replay koruması.
 */

import { createHmac, timingSafeEqual, createHash } from "crypto";

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;
const REPLAY_TTL_MS = 10 * 60 * 1000;

const replayStore = globalThis.__annveroWebhookReplay || new Map();
globalThis.__annveroWebhookReplay = replayStore;

function readEnv(name) {
  return String(process.env[name] ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function isProductionLike() {
  const app = readEnv("ANNVERO_APP_ENV").toLowerCase();
  const vercel = readEnv("VERCEL_ENV").toLowerCase();
  if (app === "production" || vercel === "production") return true;
  return process.env.NODE_ENV === "production" && vercel !== "preview";
}

export function safeEqualString(a = "", b = "") {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    // uzunluk sızıntısını azaltmak için sabit karşılaştırma
    const fill = Buffer.alloc(left.length);
    timingSafeEqual(left, fill);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function computeWebhookSignature(secret, timestamp, rawBody) {
  const payload = `${timestamp}.${rawBody}`;
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function pruneReplay(now) {
  for (const [key, expires] of replayStore.entries()) {
    if (expires <= now) replayStore.delete(key);
  }
}

export function rememberWebhookEvent(eventKey, { ttlMs = REPLAY_TTL_MS } = {}) {
  const now = Date.now();
  pruneReplay(now);
  const key = String(eventKey || "").slice(0, 200);
  if (!key) return { ok: false, reason: "missing_event_key" };
  if (replayStore.has(key)) {
    return { ok: false, reason: "replay" };
  }
  replayStore.set(key, now + ttlMs);
  return { ok: true };
}

export function resetWebhookReplayStore() {
  replayStore.clear();
}

/**
 * @returns {{ ok: boolean, code?: string, message?: string, eventId?: string }}
 */
export function verifyWebhookRequest(request, rawBody, {
  toleranceMs = DEFAULT_TOLERANCE_MS,
} = {}) {
  const secret = readEnv("N8N_AUTOMATION_WEBHOOK_SECRET");
  const hmacSecret = readEnv("N8N_AUTOMATION_WEBHOOK_HMAC_SECRET") || secret;

  if (!secret && !hmacSecret) {
    if (isProductionLike()) {
      return { ok: false, code: "WEBHOOK_SECRET_MISSING", message: "Webhook secret yapılandırılmamış." };
    }
    return { ok: true, code: "DEV_OPEN", eventId: "dev" };
  }

  const signatureHeader =
    request.headers.get("x-annvero-signature") ||
    request.headers.get("x-hub-signature-256") ||
    "";
  const timestampHeader = request.headers.get("x-annvero-timestamp") || "";
  const eventId =
    request.headers.get("x-annvero-event-id") ||
    request.headers.get("x-idempotency-key") ||
    "";

  // HMAC yolu tercih edilir
  if (signatureHeader && timestampHeader && hmacSecret) {
    const ts = Number(timestampHeader);
    if (!Number.isFinite(ts)) {
      return { ok: false, code: "INVALID_TIMESTAMP", message: "Geçersiz timestamp." };
    }
    const skew = Math.abs(Date.now() - ts);
    if (skew > toleranceMs) {
      return { ok: false, code: "TIMESTAMP_EXPIRED", message: "Timestamp toleransı aşıldı." };
    }

    const expected = computeWebhookSignature(hmacSecret, String(ts), rawBody);
    const provided = signatureHeader.replace(/^sha256=/i, "").trim();
    if (!safeEqualString(expected, provided)) {
      return { ok: false, code: "INVALID_SIGNATURE", message: "İmza geçersiz." };
    }

    const replayKey =
      eventId ||
      createHash("sha256").update(`${ts}.${rawBody}`).digest("hex").slice(0, 40);
    const replay = rememberWebhookEvent(replayKey);
    if (!replay.ok) {
      return { ok: false, code: "REPLAY", message: "Tekrarlanan webhook olayı." };
    }

    return { ok: true, eventId: replayKey };
  }

  // Geriye uyumluluk: Bearer / x-api-key (constant-time)
  const header = request.headers.get("authorization") || "";
  const apiKey = request.headers.get("x-api-key") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const matchBearer = secret && safeEqualString(bearer, secret);
  const matchKey = secret && safeEqualString(apiKey, secret);

  if (!matchBearer && !matchKey) {
    return { ok: false, code: "UNAUTHORIZED", message: "Yetkisiz webhook isteği." };
  }

  if (eventId) {
    const replay = rememberWebhookEvent(eventId);
    if (!replay.ok) {
      return { ok: false, code: "REPLAY", message: "Tekrarlanan webhook olayı." };
    }
  }

  return { ok: true, eventId: eventId || "legacy" };
}
