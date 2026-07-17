import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/src/lib/auth/admin";
import { ANNVERO_ROLES } from "@/src/config/annveroRoles";
import { fetchProfileByEmail } from "@/src/lib/auth/profileService";
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

function hasLikelyAuthCookie(request) {
  return request.cookies
    .getAll()
    .some(
      (cookie) =>
        cookie.name.startsWith("sb-") ||
        cookie.name.includes("auth-token") ||
        cookie.name.includes("supabase")
    );
}

async function canAccessAdminArea(user) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;

  const { profile, schemaMissing } = await fetchProfileByEmail(user.email);
  if (!schemaMissing && profile?.isActive !== false) {
    return (
      profile.role === ANNVERO_ROLES.ADMIN || profile.role === ANNVERO_ROLES.PARTNER
    );
  }

  const metaRole =
    user.user_metadata?.annvero_role ||
    user.user_metadata?.role ||
    user.app_metadata?.annvero_role ||
    "";
  return metaRole === ANNVERO_ROLES.ADMIN || metaRole === ANNVERO_ROLES.PARTNER;
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

function clearReturnToCookie(response) {
  response.cookies.set(
    ANNVERO_RETURN_TO_COOKIE,
    "",
    getReturnToCookieOptions({ clear: true })
  );
  return response;
}

export async function updateSession(request) {
  const config = getSupabaseConfig();

  if (!config) {
    return NextResponse.next({ request });
  }

  const { pathname, searchParams } = request.nextUrl;

  // Login sayfasında oturum çerezi yoksa Supabase getUser çağrısını atla —
  // document TTFB'yi şişirmesin; form hemen gelsin.
  if (pathname === "/login" && !hasLikelyAuthCookie(request)) {
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

  if (pathname === "/login") {
    const legacyNext = searchParams.get("next");

    // Eski ?next= bağlantısı: cookie'ye aktar, adresi temizle.
    if (legacyNext && !user) {
      const cleanUrl = request.nextUrl.clone();
      cleanUrl.pathname = "/login";
      cleanUrl.search = "";
      const response = NextResponse.redirect(cleanUrl);
      setReturnToCookie(response, legacyNext);
      return withSupabaseCookies(supabaseResponse, response);
    }

    if (user) {
      const fromCookie = request.cookies.get(ANNVERO_RETURN_TO_COOKIE)?.value;
      const target = getSafeNextPath(fromCookie || legacyNext, "/dashboard");
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = target.split("?")[0];
      redirectUrl.search = "";
      const response = NextResponse.redirect(redirectUrl);
      clearReturnToCookie(response);
      return withSupabaseCookies(supabaseResponse, response);
    }
  }

  return supabaseResponse;
}
