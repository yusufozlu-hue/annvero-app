/**
 * Webhook kimlik doğrulama — HMAC + timestamp + constant-time.
 * Replay claim bu modülde yazılmaz (stateless); bkz. webhookReplay.js.
 */

import { createHmac, timingSafeEqual, createHash } from "crypto";
import {
  isLocalDevOrTestEnv,
  requiresStrictRuntimeSecrets,
  resolveAnnveroAppEnv,
} from "@/src/lib/security/envGuard";
import { N8N_FLOW_DEFINITIONS } from "@/src/config/n8nOtomasyonDefaults";

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;
const REPLAY_TTL_MS = 10 * 60 * 1000;

const KNOWN_FLOW_IDS = new Set(N8N_FLOW_DEFINITIONS.map((f) => f.id));
const PAYLOAD_SIGNAL_KEYS = ["fileName", "subject", "sender", "documentType", "bankName"];

/** Yalnız local/test memory yardımcıları + kritik-route statik envanter. */
const replayStore = globalThis.__annveroWebhookReplay || new Map();
globalThis.__annveroWebhookReplay = replayStore;

function readEnv(name) {
  return String(process.env[name] ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

export function safeEqualString(a = "", b = "") {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    const fill = Buffer.alloc(left.length);
    timingSafeEqual(left, fill);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * İmza girdisi: exact `${timestampMs}.${rawBody}` — timestamp Unix epoch milliseconds.
 */
export function computeWebhookSignature(secret, timestamp, rawBody) {
  const payload = `${timestamp}.${rawBody}`;
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function pruneReplay(now) {
  for (const [key, expires] of replayStore.entries()) {
    if (expires <= now) replayStore.delete(key);
  }
}

/** Local/test memory claim — production/staging güvenlik kaynağı değildir. */
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

function webhookUnavailable(message = "Webhook HMAC secret yapılandırılmamış.") {
  return {
    ok: false,
    code: "WEBHOOK_SECRET_MISSING",
    message,
  };
}

export function readWebhookEventIdHeader(request) {
  return (
    request.headers.get("x-annvero-event-id") ||
    request.headers.get("x-idempotency-key") ||
    ""
  );
}

/**
 * Replay/idempotency anahtarı — ham değer loglanmamalı.
 */
export function resolveWebhookEventKey(request, rawBody, timestamp) {
  const eventId = String(readWebhookEventIdHeader(request) || "").slice(0, 200);
  if (eventId) return eventId;
  return createHash("sha256")
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex")
    .slice(0, 40);
}

/**
 * Mevcut n8n tüketici sözleşmesi: bilinen flowId veya resolveFlowFromPayload sinyal alanları.
 * Boş `{}` / primitive / array → reddedilir (varsayılan mail-to-pool enqueue yok).
 */
export function validateWebhookPayloadBody(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      message: "Webhook gövdesi JSON nesnesi olmalıdır.",
    };
  }

  const flowId = typeof body.flowId === "string" ? body.flowId.trim() : "";
  if (flowId) {
    if (!KNOWN_FLOW_IDS.has(flowId)) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        message: "Bilinmeyen veya desteklenmeyen flowId.",
      };
    }
    return { ok: true };
  }

  const hasSignal = PAYLOAD_SIGNAL_KEYS.some((key) => {
    const value = body[key];
    return value != null && String(value).trim() !== "";
  });

  if (hasSignal || body.scheduled === true) {
    return { ok: true };
  }

  return {
    ok: false,
    code: "INVALID_PAYLOAD",
    message: "Webhook payload yetersiz (flowId veya tanıma sinyali gerekli).",
  };
}

/**
 * Stateless HMAC/timestamp doğrulama — replay yazmaz.
 * @returns {{ ok: boolean, code?: string, message?: string, eventId?: string, timestamp?: string }}
 */
export function verifyWebhookRequest(request, rawBody, {
  toleranceMs = DEFAULT_TOLERANCE_MS,
} = {}) {
  const appEnv = resolveAnnveroAppEnv();
  const strict = requiresStrictRuntimeSecrets(appEnv);
  const localDev = isLocalDevOrTestEnv(appEnv);

  const bearerSecret = readEnv("N8N_AUTOMATION_WEBHOOK_SECRET");
  const hmacSecret = readEnv("N8N_AUTOMATION_WEBHOOK_HMAC_SECRET");
  const effectiveHmac = hmacSecret || (!strict ? bearerSecret : "");

  if (!effectiveHmac) {
    if (strict) {
      return webhookUnavailable();
    }
    if (localDev && !bearerSecret) {
      return { ok: true, code: "DEV_OPEN", eventId: "dev" };
    }
    if (!bearerSecret) {
      return webhookUnavailable();
    }
  }

  const signatureHeader =
    request.headers.get("x-annvero-signature") ||
    request.headers.get("x-hub-signature-256") ||
    "";
  const timestampHeader = request.headers.get("x-annvero-timestamp") || "";

  const hasHmacHeaders = Boolean(signatureHeader && timestampHeader);

  if (strict && !hasHmacHeaders) {
    return {
      ok: false,
      code: "HMAC_REQUIRED",
      message: "Staging/preview/production webhook HMAC (imza + timestamp) zorunludur.",
    };
  }

  if (hasHmacHeaders && effectiveHmac) {
    const ts = Number(timestampHeader);
    if (!Number.isFinite(ts)) {
      return { ok: false, code: "INVALID_TIMESTAMP", message: "Geçersiz timestamp." };
    }
    const skew = Math.abs(Date.now() - ts);
    if (skew > toleranceMs) {
      return { ok: false, code: "TIMESTAMP_EXPIRED", message: "Timestamp toleransı aşıldı." };
    }

    const expected = computeWebhookSignature(effectiveHmac, String(ts), rawBody);
    const provided = signatureHeader.replace(/^sha256=/i, "").trim();
    if (!safeEqualString(expected, provided)) {
      return { ok: false, code: "INVALID_SIGNATURE", message: "İmza geçersiz." };
    }

    const eventId = resolveWebhookEventKey(request, rawBody, String(ts));
    return { ok: true, eventId, timestamp: String(ts) };
  }

  if (!localDev) {
    return {
      ok: false,
      code: "HMAC_REQUIRED",
      message: "Legacy Bearer webhook yalnız local development/test için geçerlidir.",
    };
  }

  const header = request.headers.get("authorization") || "";
  const apiKey = request.headers.get("x-api-key") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const matchBearer = bearerSecret && safeEqualString(bearer, bearerSecret);
  const matchKey = bearerSecret && safeEqualString(apiKey, bearerSecret);

  if (!matchBearer && !matchKey) {
    return { ok: false, code: "UNAUTHORIZED", message: "Yetkisiz webhook isteği." };
  }

  const eventId = resolveWebhookEventKey(request, rawBody, String(Date.now()));
  return { ok: true, eventId: eventId || "legacy" };
}
