import { NextResponse } from "next/server";
import { buildJobFromWebhookPayload } from "@/src/utils/n8nOtomasyonEngine";
import { enforceDurableRateLimit } from "@/src/lib/security/rateLimitDurable";
import { getOrCreateRequestId, REQUEST_ID_HEADER } from "@/src/lib/security/requestId";
import {
  verifyWebhookRequest,
  validateWebhookPayloadBody,
} from "@/src/lib/security/webhookAuth";
import { claimWebhookReplayEvent, getWebhookDurableSupabase } from "@/src/lib/security/webhookReplay";
import { enforceJsonContentType, enforceBodySizeLimit } from "@/src/lib/security/requestGuards";

const globalQueue = globalThis.__annveroN8nWebhookQueue || [];
globalThis.__annveroN8nWebhookQueue = globalQueue;

const MAX_WEBHOOK_BYTES = 256_000;

function withRequestId(response, requestId) {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export async function POST(request) {
  const requestId = getOrCreateRequestId(request);

  const typeError = enforceJsonContentType(request);
  if (typeError) {
    return withRequestId(typeError, requestId);
  }

  const sizeError = enforceBodySizeLimit(request, MAX_WEBHOOK_BYTES);
  if (sizeError) {
    return withRequestId(sizeError, requestId);
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
      return NextResponse.json(
        { error: "İstek gövdesi çok büyük.", requestId },
        { status: 413, headers: { [REQUEST_ID_HEADER]: requestId } }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Gövde okunamadı.", requestId },
      { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }

  // 3) Timestamp + HMAC — stateless (replay yazılmaz)
  const auth = verifyWebhookRequest(request, rawBody);
  if (!auth.ok) {
    console.warn("[automation/webhook] rejected", {
      requestId,
      code: auth.code,
    });
    return NextResponse.json(
      { error: auth.message || "Yetkisiz webhook isteği.", code: auth.code, requestId },
      { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }

  // 4) JSON parse — replay/queue öncesi
  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json(
      { error: "Geçersiz JSON gövdesi.", code: "INVALID_JSON", requestId },
      { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }

  // 5) Minimum payload — replay/queue öncesi
  const payloadCheck = validateWebhookPayloadBody(body);
  if (!payloadCheck.ok) {
    return NextResponse.json(
      {
        error: payloadCheck.message || "Geçersiz webhook payload.",
        code: payloadCheck.code || "INVALID_PAYLOAD",
        requestId,
      },
      { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }

  const supabase = await getWebhookDurableSupabase();

  // 6) Durable genel rate-limit
  const rateLimited = await enforceDurableRateLimit(
    request,
    { user: { id: "webhook" } },
    "automation:webhook",
    { limit: 60, windowMs: 300_000 },
    { supabase }
  );
  if (rateLimited) {
    return withRequestId(rateLimited, requestId);
  }

  // 7) Durable atomik replay claim (DEV_OPEN hariç — local açık kapı)
  if (auth.code !== "DEV_OPEN") {
    const claim = await claimWebhookReplayEvent(auth.eventId, { supabase });
    if (claim.unavailable) {
      return NextResponse.json(
        {
          error: "Replay backend kullanılamıyor.",
          code: "REPLAY_BACKEND_UNAVAILABLE",
          requestId,
        },
        { status: 503, headers: { [REQUEST_ID_HEADER]: requestId, "Retry-After": "60" } }
      );
    }
    if (!claim.ok) {
      return NextResponse.json(
        {
          error: "Tekrarlanan webhook olayı.",
          code: "REPLAY",
          requestId,
        },
        { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } }
      );
    }
  }

  // 8–9) Job + queue
  const job = buildJobFromWebhookPayload(body);
  globalQueue.unshift(job);
  if (globalQueue.length > 200) globalQueue.length = 200;

  return NextResponse.json(
    {
      accepted: true,
      jobId: job?.id || null,
      eventId: auth.eventId || null,
      message: "İş kuyruğa alındı.",
      requestId,
    },
    { status: 202, headers: { [REQUEST_ID_HEADER]: requestId } }
  );
}

export async function GET(request) {
  const requestId = getOrCreateRequestId(request);
  const auth = verifyWebhookRequest(request, "");
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message || "Yetkisiz istek.", code: auth.code, requestId },
      { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }

  const supabase = await getWebhookDurableSupabase();

  const rateLimited = await enforceDurableRateLimit(
    request,
    { user: { id: "webhook" } },
    "automation:webhook:get",
    { limit: 60, windowMs: 300_000 },
    { supabase }
  );
  if (rateLimited) {
    return withRequestId(rateLimited, requestId);
  }

  if (auth.code !== "DEV_OPEN") {
    const claim = await claimWebhookReplayEvent(`get:${auth.eventId}`, { supabase });
    if (claim.unavailable) {
      return NextResponse.json(
        {
          error: "Replay backend kullanılamıyor.",
          code: "REPLAY_BACKEND_UNAVAILABLE",
          requestId,
        },
        { status: 503, headers: { [REQUEST_ID_HEADER]: requestId, "Retry-After": "60" } }
      );
    }
    if (!claim.ok) {
      return NextResponse.json(
        { error: "Tekrarlanan webhook olayı.", code: "REPLAY", requestId },
        { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } }
      );
    }
  }

  const peek = request.nextUrl.searchParams.get("peek") === "1";
  const jobs = peek ? [...globalQueue] : globalQueue.splice(0, globalQueue.length);

  return NextResponse.json(
    {
      count: jobs.length,
      jobIds: jobs.map((j) => j?.id || null),
      requestId,
    },
    { headers: { [REQUEST_ID_HEADER]: requestId } }
  );
}
