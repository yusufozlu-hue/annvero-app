import { NextResponse } from "next/server";
import { requireApiSession } from "@/src/lib/auth/apiGuard";
import {
  buildLoginEventContextFromRequest,
  LOGIN_EVENT_TYPES,
  writeLoginEvent,
} from "@/src/lib/audit/loginEvents";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const rateLimited = enforceRateLimit(request, session, "auth:login-event", {
    limit: 20,
    windowMs: 3_600_000,
  });
  if (rateLimited) return rateLimited;

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const context = buildLoginEventContextFromRequest(request, session.user);
  const result = await writeLoginEvent({
    ...context,
    eventType: body.event_type || body.eventType || LOGIN_EVENT_TYPES.LOGIN,
    success: body.success !== false,
    metadata: {
      source: body.source || "client",
      role: session.access?.role || session.profile?.role || "",
    },
  });

  if (!result.ok && !result.skipped) {
    return NextResponse.json(
      { error: result.error?.message || "Login event yazılamadı." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    id: result.id || null,
    skipped: Boolean(result.skipped),
  });
}
