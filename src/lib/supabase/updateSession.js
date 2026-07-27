import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/src/lib/auth/admin";
import {
  isOfficeRoutePath,
  isTaxpayerAuthUser,
  TAXPAYER_HOME_PATH,
} from "@/src/config/annveroTaxpayerPortal";
import {
  ANNVERO_RETURN_TO_COOKIE,
  ANNVERO_RETURN_TO_HINT_COOKIE,
  getReturnToCookieOptions,
  getReturnToHintCookieOptions,
  getSafeNextPath,
} from "@/src/utils/authRedirect";
import { getSupabaseConfig } from "@/src/lib/supabase/config";
import { getSupabaseSsrCookieOptions } from "@/src/lib/supabase/ssrCookies";

function isProtectedPath(pathname) {
  return (
    pathname.startsWith("/mukellef") ||
    pathname.startsWith("/muhasebe") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/ofis-takip") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/sistem-loglari") ||
    pathname.startsWith("/otomasyon") ||
    pathname.startsWith("/ai-ofis-asistani") ||
    pathname.startsWith("/evrak-havuzu") ||
    pathname.startsWith("/ik-personel") ||
    pathname.startsWith("/platform") ||
    pathname.startsWith("/ticaret-sicil")
  );
}

function isAdminPath(pathname) {
  return pathname.startsWith("/admin");
}

/**
 * getUser/refresh atlanır:
 * - HMAC webhook (ayrı fail-closed auth)
 * - return-to: yalnız httpOnly cookie oku/yaz + getSafeNextPath; oturum doğrulaması gerekmez.
 *   Login kritik yolunda getUser beklemesi ~1s abort'a çarpıyordu.
 */
function shouldSkipSessionRefresh(pathname) {
  return (
    pathname === "/api/automation/webhook" ||
    pathname.startsWith("/api/automation/webhook/") ||
    pathname === "/api/auth/return-to"
  );
}

/** Admin alanı: yalnız trusted AND platform admin (P0). DB/metadata role yetmez. */
async function canAccessAdminArea(user) {
  return isPlatformAdmin(user);
}

function withSupabaseCookies(supabaseResponse, response) {
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  return response;
}

function setReturnToCookie(response, path) {
  const safe = getSafeNextPath(path, "/dashboard");
  response.cookies.set(
    ANNVERO_RETURN_TO_COOKIE,
    safe,
    getReturnToCookieOptions()
  );
  // İstemci "özel dönüş yolu var mı?" bilgisini bu marker ile okur;
  // yol değeri httpOnly cookie'de kalır.
  response.cookies.set(
    ANNVERO_RETURN_TO_HINT_COOKIE,
    "1",
    getReturnToHintCookieOptions()
  );
  return response;
}

export async function updateSession(request) {
  const config = getSupabaseConfig();

  if (!config) {
    return NextResponse.next({ request });
  }

  const { pathname, searchParams } = request.nextUrl;

  if (shouldSkipSessionRefresh(pathname)) {
    return NextResponse.next({ request });
  }

  if (pathname === "/login") {
    const legacyNext = searchParams.get("next");
    if (legacyNext) {
      const cleanUrl = request.nextUrl.clone();
      cleanUrl.pathname = "/login";
      cleanUrl.search = "";
      const response = NextResponse.redirect(cleanUrl);
      setReturnToCookie(response, legacyNext);
      return response;
    }
    return NextResponse.next({ request });
  }

  if (pathname === "/auth/callback" || pathname === "/auth/set-password") {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(config.supabaseUrl, config.anonKey, {
    cookieOptions: getSupabaseSsrCookieOptions({ rememberMe: true }),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        supabaseResponse = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtectedPath(pathname) && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const response = NextResponse.redirect(loginUrl);
    setReturnToCookie(response, pathname);
    return withSupabaseCookies(supabaseResponse, response);
  }

  // Mükellef (JWT metadata hint) — ofis/admin route'larını /mukellef'e yönlendir. DB yok.
  if (user && isTaxpayerAuthUser(user) && isOfficeRoutePath(pathname)) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = TAXPAYER_HOME_PATH;
    homeUrl.search = "";
    return withSupabaseCookies(
      supabaseResponse,
      NextResponse.redirect(homeUrl)
    );
  }

  if (isAdminPath(pathname) && user && !(await canAccessAdminArea(user))) {
    const deniedUrl = request.nextUrl.clone();
    deniedUrl.pathname = "/dashboard";
    deniedUrl.search = "";
    deniedUrl.searchParams.set("error", "admin_required");
    return withSupabaseCookies(
      supabaseResponse,
      NextResponse.redirect(deniedUrl)
    );
  }

  return supabaseResponse;
}
