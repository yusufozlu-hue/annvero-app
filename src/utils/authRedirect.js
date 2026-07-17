/**
 * Güvenli login dönüş yolu ve temiz /login adresi yardımcıları.
 * Open-redirect koruması: yalnız relative application path kabul edilir.
 */

export const ANNVERO_RETURN_TO_COOKIE = "annvero_return_to";
export const ANNVERO_REMEMBER_ME_KEY = "annvero_remember_me";
export const RETURN_TO_COOKIE_MAX_AGE_SEC = 60 * 10; // 10 dakika

const ALLOWED_PREFIXES = [
  "/dashboard",
  "/muhasebe",
  "/ofis-takip",
  "/admin",
  "/sistem-loglari",
  "/otomasyon",
  "/ai-ofis-asistani",
  "/evrak-havuzu",
  "/ik-personel",
  "/platform",
  "/hesaplama-araclari",
  "/ticaret-sicil",
  "/mevzuat-hap-notlari",
];

function decodePathSafely(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Yalnız güvenli relative path döner. Aksi halde fallback.
 * Reddedilenler: absolute URL, //..., javascript:, localhost, .., scheme'li path.
 */
export function getSafeNextPath(nextPath, fallback = "/dashboard") {
  if (!nextPath || typeof nextPath !== "string") {
    return fallback;
  }

  const raw = nextPath.trim();
  if (!raw) return fallback;

  const decoded = decodePathSafely(raw);
  if (decoded == null) return fallback;

  const path = decoded.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return fallback;
  if (path.includes("\\") || path.includes("..")) return fallback;

  const lower = path.toLowerCase();
  if (
    lower.includes("localhost") ||
    lower.includes("127.0.0.1") ||
    lower.includes("0.0.0.0") ||
    lower.includes("[::1]")
  ) {
    return fallback;
  }

  // Query/hash ayır — prefix kontrolü yalnız pathname üzerinde
  const pathnameOnly = path.split(/[?#]/)[0] || "";
  if (!pathnameOnly.startsWith("/") || pathnameOnly.startsWith("//")) {
    return fallback;
  }

  const allowed = ALLOWED_PREFIXES.some(
    (prefix) =>
      pathnameOnly === prefix || pathnameOnly.startsWith(`${prefix}/`)
  );
  if (!allowed) return fallback;

  return path;
}

/** Adres çubuğunda temiz login — query yok. */
export function buildLoginUrl() {
  return "/login";
}

export function getReturnToCookieOptions({
  maxAge = RETURN_TO_COOKIE_MAX_AGE_SEC,
  clear = false,
} = {}) {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: clear ? 0 : maxAge,
  };
}
