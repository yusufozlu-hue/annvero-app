/**
 * Varsayılan kapalı, allowlist tabanlı CORS.
 * Tarayıcı same-origin kullanımında ekstra header gerekmez.
 */

import { NextResponse } from "next/server";
import { getAllowedOrigins } from "@/src/lib/security/csrf";

function normalizeOrigin(value = "") {
  try {
    const url = new URL(String(value).trim());
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return "";
  }
}

export function resolveCorsAllowOrigin(request) {
  const origin = normalizeOrigin(request?.headers?.get?.("origin") || "");
  if (!origin) return null;

  const allowed = getAllowedOrigins();
  if (allowed.has(origin)) return origin;
  return null;
}

/**
 * CORS header'ları uygular. Allowlist dışı origin için header eklenmez (kapalı).
 */
export function applyCorsHeaders(response, request, { allowCredentials = true } = {}) {
  const allowOrigin = resolveCorsAllowOrigin(request);
  if (!allowOrigin || !response?.headers) return response;

  response.headers.set("Access-Control-Allow-Origin", allowOrigin);
  response.headers.set("Vary", "Origin");
  if (allowCredentials) {
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Request-Id, X-Api-Key"
  );
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  return response;
}

export function corsPreflightResponse(request) {
  const response = new NextResponse(null, { status: 204 });
  applyCorsHeaders(response, request);
  if (!response.headers.get("Access-Control-Allow-Origin")) {
    return NextResponse.json({ error: "CORS origin izinli değil." }, { status: 403 });
  }
  return response;
}
