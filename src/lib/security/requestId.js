/**
 * Request / correlation ID yardımcıları.
 */

import { randomUUID } from "crypto";

export const REQUEST_ID_HEADER = "x-request-id";

export function createRequestId() {
  return randomUUID();
}

export function getOrCreateRequestId(request) {
  const incoming =
    request?.headers?.get?.(REQUEST_ID_HEADER) ||
    request?.headers?.get?.("x-correlation-id") ||
    "";
  const cleaned = String(incoming).trim().slice(0, 64);
  if (cleaned && /^[A-Za-z0-9._:-]+$/.test(cleaned)) {
    return cleaned;
  }
  return createRequestId();
}

export function withRequestIdHeaders(headers = {}, requestId = "") {
  const id = String(requestId || createRequestId());
  const next = new Headers(headers);
  next.set(REQUEST_ID_HEADER, id);
  return { headers: next, requestId: id };
}
