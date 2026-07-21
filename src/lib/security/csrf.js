/**
 * Cookie tabanlı mutating istekler için same-origin / CSRF koruması.
 * Fail-closed: Origin/Referer yoksa ve güvenli override yoksa reddeder.
 */

import { NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizeOrigin(value = "") {
  try {
    const url = new URL(String(value).trim());
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return "";
  }
}

export function getAllowedOrigins() {
  const origins = new Set();

  const site = String(process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (site) {
    const n = normalizeOrigin(site);
    if (n) origins.add(n);
  }

  const vercel = String(process.env.VERCEL_URL || "").trim();
  if (vercel) {
    const withProto = vercel.startsWith("http") ? vercel : `https://${vercel}`;
    const n = normalizeOrigin(withProto);
    if (n) origins.add(n);
  }

  const extra = String(process.env.ANNVERO_ALLOWED_ORIGINS || "")
    .split(/[,;\s]+/)
    .map((v) => normalizeOrigin(v))
    .filter(Boolean);
  for (const o of extra) origins.add(o);

  // Yerel geliştirme
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return origins;
}

export function extractRequestOrigin(request) {
  const origin = normalizeOrigin(request?.headers?.get?.("origin") || "");
  if (origin) return origin;

  const referer = String(request?.headers?.get?.("referer") || "").trim();
  if (referer) return normalizeOrigin(referer);

  return "";
}

/**
 * Mutating cookie isteklerinde same-origin doğrular.
 * @returns {NextResponse|null} Engellenirse response, aksi halde null
 */
export function enforceSameOriginCsrf(request, { required = true } = {}) {
  const method = String(request?.method || "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return null;

  // Bearer / API key ile çağrılan otomasyonlar Origin taşımayabilir
  const auth = String(request?.headers?.get?.("authorization") || "");
  const apiKey = String(request?.headers?.get?.("x-api-key") || "");
  if (auth.startsWith("Bearer ") || apiKey) {
    return null;
  }

  const allowed = getAllowedOrigins();
  const requestOrigin = extractRequestOrigin(request);

  if (!requestOrigin) {
    if (!required) return null;
    // Production'da Origin yoksa fail-closed; local'de gevşek kalabilir
    if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
      return NextResponse.json(
        { error: "CSRF koruması: Origin/Referer gerekli.", code: "CSRF_ORIGIN_MISSING" },
        { status: 403 }
      );
    }
    return null;
  }

  if (allowed.size === 0) {
    // Allowlist boşsa host header ile karşılaştır
    const host = String(request?.headers?.get?.("host") || "").toLowerCase();
    try {
      const parsed = new URL(requestOrigin);
      if (parsed.host.toLowerCase() === host) return null;
    } catch {
      // fall through
    }
    return NextResponse.json(
      { error: "CSRF koruması: origin allowlist yapılandırılmamış.", code: "CSRF_ORIGIN_DENIED" },
      { status: 403 }
    );
  }

  if (!allowed.has(requestOrigin)) {
    return NextResponse.json(
      { error: "CSRF koruması: origin izinli değil.", code: "CSRF_ORIGIN_DENIED" },
      { status: 403 }
    );
  }

  return null;
}
