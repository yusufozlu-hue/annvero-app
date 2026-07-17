import { NextResponse } from "next/server";
import { isGoogleDriveOAuthConfigured } from "@/src/lib/googleDrive/tokenPolicy";
import { requireApiSession, assertCompanyAccess } from "@/src/lib/auth/apiGuard";
import { exchangeAuthorizationCode, fetchGoogleAccountEmail, verifyOAuthState } from "@/src/lib/googleDrive/oauth";
import { saveGoogleDriveConnection } from "@/src/lib/googleDrive/connectionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google Drive OAuth callback iskeleti (V1).
 * Production secret yokken 501 döner — gerçek token işleme yok.
 * GET /api/google-drive/oauth/callback?code=...&state=...
 */
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const stateCookie = request.cookies.get("annvero_drive_oauth_state")?.value;

  const redirect = (params) => {
    const target = new URL("/muhasebe/firma-yonetimi", request.url);
    target.searchParams.set("tab", "cloudStorage");
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    const response = NextResponse.redirect(target);
    response.cookies.delete("annvero_drive_oauth_state");
    return response;
  };

  if (error) {
    return redirect({ drive_error: error });
  }

  if (!isGoogleDriveOAuthConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        code: "GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED",
        message:
          "Google Drive OAuth ortam değişkenleri tanımlı değil. Token alınmadı.",
        hasCode: Boolean(code),
      },
      { status: 501 }
    );
  }

  try {
    const session = await requireApiSession();
    if (session.error) return session.error;
    if (!code) return redirect({ drive_error: "missing_code" });
    const verified = verifyOAuthState(state, stateCookie);
    if (String(verified.userId) !== String(session.user.id)) throw new Error("OAuth kullanıcısı uyuşmuyor.");
    const access = assertCompanyAccess(session.access, verified.companyId, { required: true });
    if (!access.ok) return access.response;
    const tokens = await exchangeAuthorizationCode(code);
    const accountEmail = await fetchGoogleAccountEmail(tokens.access_token);
    await saveGoogleDriveConnection({ userId: session.user.id, accountEmail, tokens });
    return redirect({ drive_connected: "1", companyId: verified.companyId });
  } catch {
    return redirect({ drive_error: "oauth_callback_failed" });
  }
}
