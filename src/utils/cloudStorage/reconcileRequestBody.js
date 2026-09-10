/**
 * Reconcile POST body doğrulama — authority client alanlarından alınmaz.
 */

import {
  RECONCILE_MAX_COMPANIES_PER_RUN,
} from "@/src/utils/cloudStorage/reconcileBatch.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const RECONCILE_BODY_ERROR = Object.freeze({
  INVALID_JSON: "INVALID_JSON",
  INVALID_CONTENT_TYPE: "INVALID_CONTENT_TYPE",
  INVALID_COMPANY_ID: "INVALID_COMPANY_ID",
  INVALID_CURSOR: "INVALID_CURSOR",
  INVALID_LIMIT: "INVALID_LIMIT",
});

export function isCanonicalReconcileId(value = "") {
  const id = String(value || "").trim();
  if (!id || id.length > 36) return false;
  return UUID_RE.test(id);
}

/**
 * Yalnız companyId/cursor/limit okunur.
 * role/isAdmin/__proto__/constructor vb. authority değildir (yok sayılır).
 * @returns {{ ok: true, value: { companyId: string, cursor: string, limit: number } } | { ok: false, code: string, message: string }}
 */
export function normalizeReconcileBody(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      code: RECONCILE_BODY_ERROR.INVALID_JSON,
      message: "Geçersiz JSON gövdesi.",
    };
  }

  const hasCompanyId = Object.prototype.hasOwnProperty.call(raw, "companyId");
  const hasCursor = Object.prototype.hasOwnProperty.call(raw, "cursor");
  const hasLimit = Object.prototype.hasOwnProperty.call(raw, "limit");

  let companyId = "";
  if (hasCompanyId) {
    if (typeof raw.companyId !== "string") {
      return {
        ok: false,
        code: RECONCILE_BODY_ERROR.INVALID_COMPANY_ID,
        message: "Geçersiz companyId.",
      };
    }
    companyId = raw.companyId.trim();
    if (!companyId || !isCanonicalReconcileId(companyId)) {
      return {
        ok: false,
        code: RECONCILE_BODY_ERROR.INVALID_COMPANY_ID,
        message: "Geçersiz companyId.",
      };
    }
  }

  let cursor = "";
  if (hasCursor) {
    if (typeof raw.cursor !== "string") {
      return {
        ok: false,
        code: RECONCILE_BODY_ERROR.INVALID_CURSOR,
        message: "Geçersiz cursor.",
      };
    }
    cursor = raw.cursor.trim();
    if (cursor && !isCanonicalReconcileId(cursor)) {
      return {
        ok: false,
        code: RECONCILE_BODY_ERROR.INVALID_CURSOR,
        message: "Geçersiz cursor.",
      };
    }
  }

  let limit = RECONCILE_MAX_COMPANIES_PER_RUN;
  if (hasLimit) {
    if (
      typeof raw.limit !== "number" ||
      !Number.isInteger(raw.limit) ||
      raw.limit < 1 ||
      raw.limit > RECONCILE_MAX_COMPANIES_PER_RUN
    ) {
      return {
        ok: false,
        code: RECONCILE_BODY_ERROR.INVALID_LIMIT,
        message: "Geçersiz limit.",
      };
    }
    limit = raw.limit;
  }

  return {
    ok: true,
    value: { companyId, cursor, limit },
  };
}

/**
 * POST gövdesini sıkı parse eder.
 * GET → body’siz batch defaults.
 * POST boş body → batch defaults (cron uyumu).
 * Non-empty body + JSON olmayan Content-Type → 415.
 * Malformed JSON → 400; sessiz `{}` batch yok.
 */
export async function parseReconcileRequestBody(request) {
  const method = String(request?.method || "GET").toUpperCase();
  if (method !== "POST") {
    return {
      ok: true,
      value: {
        companyId: "",
        cursor: "",
        limit: RECONCILE_MAX_COMPANIES_PER_RUN,
      },
    };
  }

  const contentType = String(
    request?.headers?.get?.("content-type") || ""
  ).toLowerCase();
  let rawText = "";
  try {
    rawText = await request.text();
  } catch {
    return {
      ok: false,
      code: RECONCILE_BODY_ERROR.INVALID_JSON,
      message: "Geçersiz JSON gövdesi.",
      status: 400,
    };
  }

  const trimmed = String(rawText || "").trim();
  if (!trimmed) {
    // Boş POST body: batch defaults (Vercel cron çoğunlukla GET kullanır).
    return {
      ok: true,
      value: {
        companyId: "",
        cursor: "",
        limit: RECONCILE_MAX_COMPANIES_PER_RUN,
      },
    };
  }

  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      code: RECONCILE_BODY_ERROR.INVALID_CONTENT_TYPE,
      message: "Content-Type application/json olmalı.",
      status: 415,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      code: RECONCILE_BODY_ERROR.INVALID_JSON,
      message: "Geçersiz JSON gövdesi.",
      status: 400,
    };
  }

  const normalized = normalizeReconcileBody(parsed);
  if (!normalized.ok) {
    return { ...normalized, status: 400 };
  }
  return normalized;
}
