import { NextResponse } from "next/server";
import { buildJobFromWebhookPayload } from "@/src/utils/n8nOtomasyonEngine";
import { enforceDurableRateLimit } from "@/src/lib/security/rateLimitDurable";
import { getOrCreateRequestId, REQUEST_ID_HEADER } from "@/src/lib/security/requestId";
import { verifyWebhookRequest } from "@/src/lib/security/webhookAuth";
import { enforceJsonContentType, enforceBodySizeLimit } from "@/src/lib/security/requestGuards";

const globalQueue = globalThis.__annveroN8nWebhookQueue || [];
globalThis.__annveroN8nWebhookQueue = globalQueue;

const MAX_WEBHOOK_BYTES = 256_000;

export async function POST(request) {
  const requestId = getOrCreateRequestId(request);

  const typeError = enforceJsonContentType(request);
  if (typeError) {
    typeError.headers.set(REQUEST_ID_HEADER, requestId);
    return typeError;
  }

  const sizeError = enforceBodySizeLimit(request, MAX_WEBHOOK_BYTES);
  if (sizeError) {
    sizeError.headers.set(REQUEST_ID_HEADER, requestId);
    return sizeError;
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

  const auth = verifyWebhookRequest(request, rawBody);
  if (!auth.ok) {
    console.warn("[automation/webhook] rejected", {
      requestId,
      code: auth.code,
      // body/secret/token loglanmaz
    });
    return NextResponse.json(
      { error: auth.message || "Yetkisiz webhook isteği.", code: auth.code, requestId },
      { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }

  const rateLimited = await enforceDurableRateLimit(
    request,
    { user: { id: "webhook" } },
    "automation:webhook",
    { limit: 60, windowMs: 300_000 }
  );
  if (rateLimited) {
    rateLimited.headers.set(REQUEST_ID_HEADER, requestId);
    return rateLimited;
  }

  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json(
      { error: "Geçersiz JSON gövdesi.", requestId },
      { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }

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

  const peek = request.nextUrl.searchParams.get("peek") === "1";
  const jobs = peek ? [...globalQueue] : globalQueue.splice(0, globalQueue.length);

  // Hassas payload sızdırma — yalnız sayım/id
  return NextResponse.json(
    {
      count: jobs.length,
      jobIds: jobs.map((j) => j?.id || null),
      requestId,
    },
    { headers: { [REQUEST_ID_HEADER]: requestId } }
  );
}
