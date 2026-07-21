import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/src/lib/auth/admin";
import {
  ANNVERO_RETURN_TO_COOKIE,
  getReturnToCookieOptions,
  getSafeNextPath,
} from "@/src/utils/authRedirect";
import { getSupabaseConfig } from "@/src/lib/supabase/config";

function isProtectedPath(pathname) {
  return (
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
  return response;
}

export async function updateSession(request) {
  const config = getSupabaseConfig();

  if (!config) {
    return NextResponse.next({ request });
  }

  const { pathname, searchParams } = request.nextUrl;

  // Public /login: asla Supabase getUser / token refresh bekleme.
  // Oturumlu yönlendirme istemci tarafında; ?next= istemci + return-to API.
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

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(config.supabaseUrl, config.anonKey, {
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
