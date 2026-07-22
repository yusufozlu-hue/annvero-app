import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ANNVERO_RETURN_TO_COOKIE,
  getReturnToCookieOptions,
  getSafeNextPath,
} from "@/src/utils/authRedirect";
import { getSupabaseConfig } from "@/src/lib/supabase/config";
import { createAnnveroServerSupabase } from "@/src/lib/supabase/createServerSupabase";
import {
  buildLoginEventContextFromRequest,
  LOGIN_EVENT_TYPES,
  writeLoginEvent,
} from "@/src/lib/audit/loginEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolvePublicOrigin(request) {
  const requestUrl = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    requestUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (requestUrl.protocol === "https:" ? "https" : "http");

  if (!host || host.includes("localhost") || host.includes("127.0.0.1")) {
    if (process.env.NODE_ENV === "production") {
      return "https://www.annvero.com";
    }
  }

  return `${proto}://${host}`.replace(/\/$/, "");
}

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = resolvePublicOrigin(request);

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_missing_code`);
  }

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.redirect(`${origin}/login?error=supabase_config_missing`);
  }

  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(ANNVERO_RETURN_TO_COOKIE)?.value;
  const next = getSafeNextPath(
    fromCookie || requestUrl.searchParams.get("next"),
    "/dashboard"
  );

  const supabase = createAnnveroServerSupabase({
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value, options }) => {
        cookieStore.set(name, value, options);
      });
    },
  });

  if (!supabase) {
    return NextResponse.redirect(`${origin}/login?error=supabase_config_missing`);
  }

  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback]", error.message);
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const user = sessionData?.session?.user;
  if (user) {
    void writeLoginEvent({
      ...buildLoginEventContextFromRequest(request, user),
      eventType: LOGIN_EVENT_TYPES.OAUTH_CALLBACK,
      success: true,
      metadata: { source: "auth_callback" },
    });
  }

  try {
    await fetch(`${origin}/api/auth/me`, {
      headers: { cookie: request.headers.get("cookie") || "" },
      cache: "no-store",
    });
  } catch {
    // fallback: oturum oluştu, profil senkronu sonraki istekte tamamlanır
  }

  const response = NextResponse.redirect(`${origin}${next}`);
  response.cookies.set(
    ANNVERO_RETURN_TO_COOKIE,
    "",
    getReturnToCookieOptions({ clear: true })
  );
  return response;
}
