import { NextResponse } from "next/server";
import { buildJobFromWebhookPayload } from "@/src/utils/n8nOtomasyonEngine";

const globalQueue = globalThis.__annveroN8nWebhookQueue || [];
globalThis.__annveroN8nWebhookQueue = globalQueue;

function isAuthorized(request) {
  const secret = process.env.N8N_AUTOMATION_WEBHOOK_SECRET || "";
  if (!secret) return true;
  const header = request.headers.get("authorization") || "";
  const apiKey = request.headers.get("x-api-key") || "";
  return header === `Bearer ${secret}` || apiKey === secret;
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Yetkisiz webhook isteği." }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövdesi." }, { status: 400 });
  }

  const job = buildJobFromWebhookPayload(body);
  globalQueue.unshift(job);
  if (globalQueue.length > 200) globalQueue.length = 200;

  return NextResponse.json(
    {
      accepted: true,
      job,
      message: "İş kuyruğa alındı. Otomasyon Merkezi senkronizasyonu ile işlenebilir.",
    },
    { status: 202 }
  );
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Yetkisiz istek." }, { status: 401 });
  }

  const peek = request.nextUrl.searchParams.get("peek") === "1";
  const jobs = peek ? [...globalQueue] : globalQueue.splice(0, globalQueue.length);

  return NextResponse.json({
    count: jobs.length,
    jobs,
  });
}
