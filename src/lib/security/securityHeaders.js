/**
 * Güvenlik header'ları — Next.js headers() için sabitler.
 * CSP mevcut uygulamayı bozmayacak şekilde kuruldu; unsafe-inline/eval raporlanır.
 */

export function buildContentSecurityPolicy({ isDev = false } = {}) {
  const scriptSrc = [
    "'self'",
    // Next.js / React hydration için mevcut stack'te gerekli
    "'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    "https://*.supabase.co",
  ];

  const connectSrc = [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://www.tcmb.gov.tr",
    ...(isDev ? ["ws:", "http://localhost:*", "http://127.0.0.1:*"] : []),
  ];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
  ];

  if (!isDev) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export function buildSecurityHeaders({ isDev = false } = {}) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy({ isDev }),
    },
  ];

  if (!isDev) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}

/** CSP içinde bilinçli unsafe-* kullanım envanteri */
export const CSP_UNSAFE_USAGE_REPORT = Object.freeze([
  {
    directive: "script-src",
    value: "'unsafe-inline'",
    reason: "Next.js App Router hydration / inline boot scripts",
    remediation: "Nonce/hash tabanlı CSP'ye geçiş (Faz 2 hardening)",
  },
  {
    directive: "script-src",
    value: "'unsafe-eval'",
    reason: "Yalnız development (HMR / turbopack)",
    remediation: "Production CSP'de yok",
  },
  {
    directive: "style-src",
    value: "'unsafe-inline'",
    reason: "Tailwind / runtime style attributes",
    remediation: "Mümkün olduğunda stil hash/nonce",
  },
]);
