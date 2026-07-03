import { GIB_QUERY_STATUS } from "@/src/config/gibQueryStatuses";
import {
  logGibTechnicalError,
  toGibUserFacingError,
} from "@/src/utils/gibUserMessages";

function throwGibQueryError(context, body, fallbackStatus) {
  const technicalDetail = body.error || body.resultStatus || fallbackStatus;
  const resultStatus = body.resultStatus || fallbackStatus;
  logGibTechnicalError(context, technicalDetail, { body });
  throw new Error(toGibUserFacingError(technicalDetail, resultStatus));
}

export async function fetchGibCompanyRows() {
  const response = await fetch("/api/gib-tebligat/companies", { cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Firma sorgu listesi yüklenemedi.");
  }
  const body = await response.json();
  return body.data || [];
}

export async function fetchGibCredentials(companyId) {
  const search = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
  const response = await fetch(`/api/gib-credentials${search}`, { cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "GİB bilgileri yüklenemedi.");
  }
  const body = await response.json();
  return body.data || [];
}

export async function saveGibCredentials(payload) {
  const response = await fetch("/api/gib-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "GİB bilgileri kaydedilemedi.");
  }

  const body = await response.json();
  return body.data;
}

export async function startGibQuery(companyId) {
  const response = await fetch("/api/gib-tebligat/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId }),
  });

  const body = await response.json();
  if (!response.ok) {
    throwGibQueryError("api-query", body, GIB_QUERY_STATUS.SYSTEM_ERROR);
  }

  return body;
}

export async function verifyGibQuery(sessionId, verificationCode) {
  const response = await fetch("/api/gib-tebligat/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, verificationCode }),
  });

  const body = await response.json();
  if (!response.ok) {
    throwGibQueryError("api-verify", body, GIB_QUERY_STATUS.SYSTEM_ERROR);
  }

  return body;
}
