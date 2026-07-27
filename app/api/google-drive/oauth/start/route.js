import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  jsonForbidden,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { buildGoogleAuthorizeUrl, createOAuthState } from "@/src/lib/googleDrive/oauth";
import { isGoogleDriveOAuthConfigured } from "@/src/lib/googleDrive/tokenPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;
  if (!session.access?.isManagementUser) {
    return jsonForbidden("Google Drive bağlantısı yalnız ofis yönetimi tarafından kurulur.");
  }
  const limited = enforceRateLimit(request, session, "google-drive-oauth-start", { limit: 10, windowMs: 300_000 });
  if (limited) return limited;
  if (!isGoogleDriveOAuthConfigured()) return NextResponse.json({ error: "Google Drive OAuth yapılandırılmamış." }, { status: 503 });
  const companyId = String(request.nextUrl.searchParams.get("companyId") || "");
  const access = assertCompanyAccess(session.access, companyId, { required: true });
  if (!access.ok) return access.response;
  const state = createOAuthState({ userId: session.user.id, companyId });
  const response = NextResponse.redirect(buildGoogleAuthorizeUrl(state));
  response.cookies.set("annvero_drive_oauth_state", state, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/api/google-drive/oauth/callback", maxAge: 600,
  });
  return response;
}
