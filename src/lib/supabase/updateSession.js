import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { isAdminUser } from "@/src/lib/auth/admin";
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
    pathname.startsWith("/ik-personel")
  );
}

function isAdminPath(pathname) {
  return pathname.startsWith("/admin");
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

  if (isAdminPath(pathname) && user && !isAdminUser(user)) {
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
