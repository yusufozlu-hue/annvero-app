/**
 * POST/GET /api/google-drive/reconcile
 * Sistem/cron reconcile — saatlik batch + sync retry.
 * Auth: canonical system secret (session/tenant yolu yok).
 */

import { NextResponse } from "next/server";
import { runSystemReconcile } from "@/src/lib/googleDrive/runSystemReconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  const result = await runSystemReconcile(request);
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request) {
  const result = await runSystemReconcile(request);
  return NextResponse.json(result.body, { status: result.status });
}
