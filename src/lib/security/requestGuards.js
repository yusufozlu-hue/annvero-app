/**
 * API request yardımcıları — body boyutu, content-type, request id, CSRF.
 */

import { NextResponse } from "next/server";
import { enforceSameOriginCsrf } from "@/src/lib/security/csrf";
import { getOrCreateRequestId, REQUEST_ID_HEADER } from "@/src/lib/security/requestId";
import { safeErrorMessage } from "@/src/lib/security/redact";

export const DEFAULT_MAX_JSON_BYTES = 1_000_000; // 1 MiB
export const DEFAULT_MAX_FORM_BYTES = 20_000_000;

function contentLength(request) {
  const raw = request?.headers?.get?.("content-length");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function enforceJsonContentType(request) {
  const ct = String(request?.headers?.get?.("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type application/json olmalı.", code: "INVALID_CONTENT_TYPE" },
      { status: 415 }
    );
  }
  return null;
}

export function enforceBodySizeLimit(request, maxBytes = DEFAULT_MAX_JSON_BYTES) {
  const len = contentLength(request);
  if (len != null && len > maxBytes) {
    return NextResponse.json(
      { error: "İstek gövdesi çok büyük.", code: "PAYLOAD_TOO_LARGE" },
      { status: 413 }
    );
  }
  return null;
}

/**
 * Mutating JSON API için ortak ön kontroller.
 */
export async function parseJsonBodySecure(request, { maxBytes = DEFAULT_MAX_JSON_BYTES, csrf = true } = {}) {
  const requestId = getOrCreateRequestId(request);

  if (csrf) {
    const csrfError = enforceSameOriginCsrf(request);
    if (csrfError) {
      csrfError.headers.set(REQUEST_ID_HEADER, requestId);
      return { error: csrfError, body: null, requestId };
    }
  }

  const typeError = enforceJsonContentType(request);
  if (typeError) {
    typeError.headers.set(REQUEST_ID_HEADER, requestId);
    return { error: typeError, body: null, requestId };
  }

  const sizeError = enforceBodySizeLimit(request, maxBytes);
  if (sizeError) {
    sizeError.headers.set(REQUEST_ID_HEADER, requestId);
    return { error: sizeError, body: null, requestId };
  }

  try {
    const body = await request.json();
    return { error: null, body, requestId };
  } catch (error) {
    const response = NextResponse.json(
      { error: safeErrorMessage(error, "Geçersiz JSON gövdesi."), code: "INVALID_JSON" },
      { status: 400 }
    );
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return { error: response, body: null, requestId };
  }
}

export function attachRequestId(response, requestId) {
  if (response?.headers && requestId) {
    response.headers.set(REQUEST_ID_HEADER, requestId);
  }
  return response;
}

/**
 * Client'tan gelen role/isAdmin alanlarını yok say.
 */
export function stripClientPrivilegeClaims(body = {}) {
  if (!body || typeof body !== "object") return body;
  const {
    role: _r,
    isAdmin: _a,
    is_admin: _ia,
    isManagementUser: _m,
    is_management_user: _imu,
    permissions: _p,
    ...rest
  } = body;
  void _r;
  void _a;
  void _ia;
  void _m;
  void _imu;
  void _p;
  return rest;
}
