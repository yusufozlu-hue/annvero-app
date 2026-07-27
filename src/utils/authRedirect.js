/**
 * Güvenli login dönüş yolu ve temiz /login adresi yardımcıları.
 * Open-redirect koruması: yalnız relative application path kabul edilir.
 */

export const ANNVERO_RETURN_TO_COOKIE = "annvero_return_to";
/**
 * Yalnız "özel dönüş yolu var mı?" işareti — path/token/e-posta taşımaz.
 * httpOnly değildir (istemci okur); gerçek yol httpOnly cookie'de kalır.
 */
export const ANNVERO_RETURN_TO_HINT_COOKIE = "annvero_return_to_hint";
/**
 * "Beni hatırla" tek tercih kaynağı: yalnız normalize edilmiş e-posta.
 * Şifre / token / session / yetki bilgisi kesinlikle yazılmaz.
 * Kayıt varsa tercih açık, yoksa kapalı sayılır (ayrı bayrak tutulmaz).
 */
export const ANNVERO_REMEMBERED_EMAIL_KEY = "annvero_remembered_email";
/** Geriye uyum: eski boolean bayrağı okunmaz, yalnız temizlenir. */
const LEGACY_REMEMBER_ME_KEY = "annvero_remember_me";
export const RETURN_TO_COOKIE_MAX_AGE_SEC = 60 * 10; // 10 dakika

export function normalizeRememberedEmail(email) {
  if (!email || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function dropLegacyRememberFlag() {
  try {
    window.localStorage.removeItem(LEGACY_REMEMBER_ME_KEY);
  } catch {
    // ignore
  }
}

/**
 * Tek anahtar, üç durum:
 *  - anahtar yok        → tercih belirtilmemiş (varsayılan: hatırla açık)
 *  - anahtar ""         → kullanıcı bilinçli olarak hatırlamayı kapattı
 *  - anahtar "a@b.com"  → yalnız e-posta hatırlanıyor
 * Yalnız client; SSR'de nötr değer döner (hydration güvenli).
 */
export function readRememberedEmailState() {
  if (typeof window === "undefined") {
    return { email: "", optedOut: false };
  }
  dropLegacyRememberFlag();
  try {
    const raw = window.localStorage.getItem(ANNVERO_REMEMBERED_EMAIL_KEY);
    if (raw == null) return { email: "", optedOut: false };

    const normalized = normalizeRememberedEmail(raw);
    if (!normalized) return { email: "", optedOut: true };

    if (raw !== normalized) {
      window.localStorage.setItem(ANNVERO_REMEMBERED_EMAIL_KEY, normalized);
    }
    return { email: normalized, optedOut: false };
  } catch {
    return { email: "", optedOut: false };
  }
}

export function readRememberedEmail() {
  return readRememberedEmailState().email;
}

/** Boş değer "hatırlamayı kapat" işaretidir. Dönüş: saklanan e-posta. */
export function writeRememberedEmail(email) {
  if (typeof window === "undefined") return "";
  const normalized = normalizeRememberedEmail(email);
  dropLegacyRememberFlag();
  try {
    window.localStorage.setItem(ANNVERO_REMEMBERED_EMAIL_KEY, normalized);
  } catch {
    // Storage kapalıysa giriş akışı etkilenmez.
  }
  return normalized;
}

export function clearRememberedEmail() {
  return writeRememberedEmail("");
}

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

/** Marker cookie: httpOnly değil (istemci okur), değer yalnız "1". */
export function getReturnToHintCookieOptions({
  maxAge = RETURN_TO_COOKIE_MAX_AGE_SEC,
  clear = false,
} = {}) {
  return {
    ...getReturnToCookieOptions({ maxAge, clear }),
    httpOnly: false,
  };
}

/** İstemci: özel dönüş yolu işareti var mı? Değer yolu içermez. */
export function hasReturnToHint() {
  if (typeof document === "undefined") return false;
  try {
    return document.cookie
      .split(";")
      .some(
        (part) => part.split("=")[0]?.trim() === ANNVERO_RETURN_TO_HINT_COOKIE
      );
  } catch {
    return false;
  }
}

const RETURN_TO_BUDGET_MS = 100;

/**
 * Return-to httpOnly cookie'yi okur (GET siler). Open-redirect: getSafeNextPath.
 * Marker cookie yoksa özel hedef de yoktur → endpoint hiç çağrılmaz.
 */
export async function consumeReturnToPathClient(
  defaultPath = "/dashboard",
  budgetMs = RETURN_TO_BUDGET_MS
) {
  if (typeof window === "undefined") return defaultPath;
  if (!hasReturnToHint()) return defaultPath;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), budgetMs);
  try {
    const res = await fetch("/api/auth/return-to", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (res.ok) {
      const data = await res.json();
      return getSafeNextPath(data?.path, defaultPath);
    }
  } catch {
    // abort / network → güvenli varsayılan
  } finally {
    window.clearTimeout(timeoutId);
  }

  void fetch("/api/auth/return-to", {
    method: "DELETE",
    credentials: "include",
    keepalive: true,
  }).catch(() => undefined);

  return defaultPath;
}
