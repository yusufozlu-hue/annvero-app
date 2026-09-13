/**
 * Cookie tabanlı mutating istekler için same-origin / CSRF koruması.
 * Fail-closed: Origin/Referer yoksa ve güvenli override yoksa reddeder.
 * Exact-origin allowlist + Host/proxy exact match; suffix / wildcard yok.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizeOrigin(value = "") {
  try {
    const url = new URL(String(value).trim());
    // Port dahil host; path/query yok — exact origin
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function firstHeaderValue(value = "") {
  return String(value || "")
    .split(",")[0]
    .trim();
}

function trustProxyHeaders() {
  // Vercel edge Host/X-Forwarded-* değerlerini kendisi yazar.
  // Yerelde istemci X-Forwarded-Host sahteciliğine izin verme.
  return (
    Boolean(process.env.VERCEL) ||
    String(process.env.ANNVERO_TRUST_PROXY || "").trim() === "1"
  );
}

function addOriginCandidate(origins, value) {
  const raw = String(value || "").trim();
  if (!raw) return;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const normalized = normalizeOrigin(withProto);
  if (normalized) origins.add(normalized);
}

function jsonForbidden(payload, status = 403) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function getAllowedOrigins() {
  const origins = new Set();

  addOriginCandidate(origins, process.env.NEXT_PUBLIC_SITE_URL);
  addOriginCandidate(origins, process.env.VERCEL_URL);
  addOriginCandidate(origins, process.env.VERCEL_BRANCH_URL);
  addOriginCandidate(origins, process.env.VERCEL_PROJECT_PRODUCTION_URL);

  const extra = String(process.env.ANNVERO_ALLOWED_ORIGINS || "")
    .split(/[,;\s]+/)
    .filter(Boolean);
  for (const o of extra) addOriginCandidate(origins, o);

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
 * İsteğin geldiği Host'tan exact origin üretir.
 * Proxy header'lar yalnızca güvenilir proxy arkasında kullanılır.
 */
export function extractRequestHostOrigin(request) {
  const headers = request?.headers;
  if (!headers?.get) return "";

  const trustProxy = trustProxyHeaders();
  const hostRaw = trustProxy
    ? firstHeaderValue(headers.get("x-forwarded-host")) ||
      firstHeaderValue(headers.get("host"))
    : firstHeaderValue(headers.get("host"));

  if (!hostRaw) return "";

  // Host header'da scheme olmamalı; varsa reddet (exact, gevşek parse yok)
  if (/:\/\//.test(hostRaw)) return "";

  let proto = "https";
  if (trustProxy) {
    const forwardedProto = firstHeaderValue(headers.get("x-forwarded-proto")).toLowerCase();
    if (forwardedProto === "http" || forwardedProto === "https") {
      proto = forwardedProto;
    }
  } else {
    const hostLower = hostRaw.toLowerCase();
    if (
      hostLower.startsWith("localhost") ||
      hostLower.startsWith("127.0.0.1") ||
      hostLower.startsWith("[::1]")
    ) {
      proto = "http";
    }
  }

  return normalizeOrigin(`${proto}://${hostRaw}`);
}

/**
 * Karar mantığı (Response üretmez) — birim testleri için.
 * @returns {{ ok: true } | { ok: false, status: number, code: string, error: string }}
 */
export function evaluateSameOriginCsrf(request, { required = true } = {}) {
  const method = String(request?.method || "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return { ok: true };

  // Bearer / API key ile çağrılan otomasyonlar Origin taşımayabilir
  const auth = String(request?.headers?.get?.("authorization") || "");
  const apiKey = String(request?.headers?.get?.("x-api-key") || "");
  if (auth.startsWith("Bearer ") || apiKey) {
    return { ok: true };
  }

  const allowed = getAllowedOrigins();
  const requestOrigin = extractRequestOrigin(request);

  if (!requestOrigin) {
    if (!required) return { ok: true };
    if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
      return {
        ok: false,
        status: 403,
        code: "CSRF_ORIGIN_MISSING",
        error: "CSRF koruması: Origin/Referer gerekli.",
      };
    }
    return { ok: true };
  }

  // 1) Exact allowlist
  if (allowed.has(requestOrigin)) {
    return { ok: true };
  }

  // 2) Exact same-origin: Origin === Host/(güvenilir) proxy Host
  const hostOrigin = extractRequestHostOrigin(request);
  if (hostOrigin && requestOrigin === hostOrigin) {
    return { ok: true };
  }

  if (allowed.size === 0 && !hostOrigin) {
    return {
      ok: false,
      status: 403,
      code: "CSRF_ORIGIN_DENIED",
      error: "CSRF koruması: origin allowlist yapılandırılmamış.",
    };
  }

  return {
    ok: false,
    status: 403,
    code: "CSRF_ORIGIN_DENIED",
    error: "CSRF koruması: origin izinli değil.",
  };
}

/**
 * Mutating cookie isteklerinde same-origin doğrular.
 * @returns {Response|null} Engellenirse response, aksi halde null
 */
export function enforceSameOriginCsrf(request, { required = true } = {}) {
  const result = evaluateSameOriginCsrf(request, { required });
  if (result.ok) return null;
  return jsonForbidden(
    { error: result.error, code: result.code },
    result.status
  );
}
