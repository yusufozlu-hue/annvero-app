import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/src/lib/auth/admin";
import { ANNVERO_ROLES } from "@/src/config/annveroRoles";
import { fetchProfileByEmail } from "@/src/lib/auth/profileService";
import { getSafeNextPath } from "@/src/utils/authRedirect";
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
    pathname.startsWith("/platform")
  );
}

function isAdminPath(pathname) {
  return pathname.startsWith("/admin");
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

export async function updateSession(request) {
  const config = getSupabaseConfig();

  if (!config) {
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

  const { pathname } = request.nextUrl;

  if (isProtectedPath(pathname) && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return withSupabaseCookies(
      supabaseResponse,
      NextResponse.redirect(loginUrl)
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

  if (pathname === "/login" && user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = getSafeNextPath(
      redirectUrl.searchParams.get("next")
    );
    redirectUrl.search = "";
    return withSupabaseCookies(
      supabaseResponse,
      NextResponse.redirect(redirectUrl)
    );
  }

  return supabaseResponse;
}
