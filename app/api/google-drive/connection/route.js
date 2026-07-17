import { NextResponse } from "next/server";
import { requireApiSession } from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { disconnectGoogleDrive, getGoogleDriveConnection } from "@/src/lib/googleDrive/connectionStore";
import { sanitizeConnectionPublicView } from "@/src/lib/googleDrive/tokenPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(request, action) {
  const session = await requireApiSession();
  if (session.error) return { response: session.error };
  const limited = enforceRateLimit(request, session, `google-drive-connection-${action}`, { limit: 30, windowMs: 300_000 });
  return limited ? { response: limited } : { session };
}

export async function GET(request) {
  const checked = await guard(request, "get");
  if (checked.response) return checked.response;
  const connection = await getGoogleDriveConnection(checked.session.user.id);
  return NextResponse.json({ connection: sanitizeConnectionPublicView(connection ? {
    status: connection.status, accountEmail: connection.account_email,
    provider: connection.provider, connectedAt: connection.connected_at,
  } : {}) });
}

export async function DELETE(request) {
  const checked = await guard(request, "delete");
  if (checked.response) return checked.response;
  await disconnectGoogleDrive(checked.session.user.id);
  return NextResponse.json({ ok: true });
}
