/**
 * @supabase/ssr cookie sözleşmesi — browser/server aynı seçenekler.
 * Custom document.cookie session kopyası yok; token loglanmaz.
 */

export const SUPABASE_SSR_COOKIE_PATH = "/";
export const SUPABASE_SSR_COOKIE_SAME_SITE = /** @type {const} */ ("lax");

/** Staging/prod HTTPS; local http'de Secure yazılmaz. */
export function shouldUseSecureAuthCookies() {
  if (typeof window !== "undefined") {
    return window.location.protocol === "https:";
  }
  if (process.env.VERCEL === "1") return true;
  return process.env.NODE_ENV === "production";
}

/**
 * createBrowserClient / createServerClient cookieOptions.
 * maxAge: "beni hatırla" açıkken kalıcı; kapalıyken session cookie (maxAge yok).
 * Not: @supabase/ssr setItem içinde DEFAULT maxAge zorlayabilir; tercih yine de
 * cookieOptions ile iletilir (resmi API).
 * @param {{ rememberMe?: boolean }} [opts]
 * @returns {{ path: string, sameSite: "lax", secure: boolean, maxAge?: number }}
 */
export function getSupabaseSsrCookieOptions({ rememberMe = true } = {}) {
  /** @type {{ path: string, sameSite: "lax", secure: boolean, maxAge?: number }} */
  const options = {
    path: SUPABASE_SSR_COOKIE_PATH,
    sameSite: SUPABASE_SSR_COOKIE_SAME_SITE,
    secure: shouldUseSecureAuthCookies(),
  };

  if (rememberMe) {
    options.maxAge = 60 * 60 * 24 * 400;
  }

  return options;
}

/** document.cookie'de sb-*-auth-token ipucu — değer okunmaz / loglanmaz. */
export function hasSupabaseAuthCookieHint() {
  if (typeof document === "undefined") return false;
  try {
    return document.cookie.split(";").some((part) => {
      const name = part.split("=")[0]?.trim() || "";
      return (
        name.startsWith("sb-") &&
        (name.includes("auth-token") || name.includes("auth-token."))
      );
    });
  } catch {
    return false;
  }
}

/**
 * Çıkış sonrası kalan sb-* çerezlerini path=/ ile düşür.
 * Session JSON yazmaz; yalnız isim bazlı Max-Age=0.
 */
export function clearSupabaseAuthCookieHints() {
  if (typeof document === "undefined") return;
  try {
    const secure = shouldUseSecureAuthCookies() ? "; Secure" : "";
    const parts = document.cookie.split(";");
    for (const part of parts) {
      const name = part.split("=")[0]?.trim();
      if (
        !name ||
        !(
          name.startsWith("sb-") ||
          name.includes("auth-token") ||
          name.includes("supabase")
        )
      ) {
        continue;
      }
      document.cookie = `${name}=; Max-Age=0; path=/${secure}; SameSite=Lax`;
    }
  } catch {
    // ignore
  }
}
