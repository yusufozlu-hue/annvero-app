/**
 * İstemci — banka canonical snapshot API.
 * Ham dosya / base64 gönderilmez.
 */

import {
  buildSnapshotMovementsFromRows,
  canReanalyzeFromCanonicalSnapshot,
} from "@/src/utils/bankCanonicalSnapshot";

export async function fetchLatestBankCanonicalSnapshot(
  companyId,
  { includeMovements = true, contentHash = "" } = {}
) {
  const id = String(companyId || "").trim();
  if (!id) {
    return {
      ok: false,
      status: 400,
      source: null,
      movements: [],
      canReanalyze: false,
    };
  }
  const params = new URLSearchParams({
    companyId: id,
    latest: "1",
    includeMovements: includeMovements ? "1" : "0",
  });
  const hash = String(contentHash || "").trim();
  if (hash) params.set("contentHash", hash);
  try {
    const response = await fetch(
      `/api/bank-statement-snapshots?${params.toString()}`,
      { credentials: "include" }
    );
    const body = await response.json().catch(() => ({}));
    if (response.status === 403) {
      return {
        ok: false,
        status: 403,
        source: null,
        movements: [],
        canReanalyze: false,
        code: "CROSS_TENANT_FORBIDDEN",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        source: null,
        movements: [],
        canReanalyze: false,
        code: body.code || "FETCH_FAILED",
        message: body.message || body.error || "",
      };
    }
    return {
      ok: true,
      status: response.status,
      source: body.source || null,
      movements: body.movements || [],
      canReanalyze: Boolean(body.canReanalyze),
      canReanalyzeCode: body.canReanalyzeCode || "",
    };
  } catch {
    return {
      ok: false,
      status: 0,
      source: null,
      movements: [],
      canReanalyze: false,
      code: "NETWORK",
    };
  }
}

/** Aynı content_hash için aktif snapshot (legacy mükerrer upgrade/restore). */
export async function fetchBankCanonicalSnapshotByHash(
  companyId,
  contentHash,
  { includeMovements = true } = {}
) {
  return fetchLatestBankCanonicalSnapshot(companyId, {
    includeMovements,
    contentHash,
  });
}

export async function fetchBankCanonicalSnapshotById(companyId, sourceId) {
  const params = new URLSearchParams({
    companyId: String(companyId || "").trim(),
    sourceId: String(sourceId || "").trim(),
    includeMovements: "1",
  });
  try {
    const response = await fetch(
      `/api/bank-statement-snapshots?${params.toString()}`,
      { credentials: "include" }
    );
    const body = await response.json().catch(() => ({}));
    if (response.status === 403) {
      return {
        ok: false,
        status: 403,
        code: "CROSS_TENANT_FORBIDDEN",
        source: null,
        movements: [],
      };
    }
    if (response.status === 410) {
      return {
        ok: false,
        status: 410,
        code: "SOURCE_DELETED",
        source: null,
        movements: [],
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: body.code || "FETCH_FAILED",
        source: null,
        movements: [],
      };
    }
    return {
      ok: true,
      source: body.source || null,
      movements: body.movements || [],
      canReanalyze: Boolean(body.canReanalyze),
    };
  } catch {
    return { ok: false, code: "NETWORK", source: null, movements: [] };
  }
}

export async function persistBankCanonicalSnapshot({
  companyId,
  contentHash,
  fileName = "",
  mimeType = "",
  byteLength = 0,
  detectedBank = "",
  sourceType = "",
  planContentFingerprint = "",
  planAccountCount = 0,
  v1AuditEntityId = "",
  movements = [],
  safeSummary = {},
  schemaVersion,
} = {}) {
  const first = movements?.[0];
  const alreadyNormalized =
    first &&
    typeof first === "object" &&
    (first.sourceMovementId || first.transactionDate != null);
  const movementPayload = alreadyNormalized
    ? movements
    : buildSnapshotMovementsFromRows(movements);

  try {
    const response = await fetch("/api/bank-statement-snapshots", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert",
        companyId,
        contentHash,
        fileName,
        mimeType,
        byteLength,
        detectedBank,
        sourceType,
        planContentFingerprint,
        planAccountCount,
        v1AuditEntityId,
        schemaVersion,
        movements: movementPayload,
        safeSummary,
      }),
    });
    const body = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      ...body,
    };
  } catch {
    return { ok: false, skipped: true, code: "PERSIST_NETWORK" };
  }
}

export async function updateBankCanonicalSnapshotPlanMeta({
  companyId,
  sourceId,
  planContentFingerprint = "",
  planAccountCount = 0,
  v1AuditEntityId = "",
  safeSummary = {},
} = {}) {
  try {
    const response = await fetch("/api/bank-statement-snapshots", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_plan_meta",
        companyId,
        sourceId,
        planContentFingerprint,
        planAccountCount,
        v1AuditEntityId,
        safeSummary,
      }),
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, ...body };
  } catch {
    return { ok: false, code: "NETWORK" };
  }
}

export function gateFilelessReanalyze(source, movements) {
  return canReanalyzeFromCanonicalSnapshot({
    source,
    movements,
    movementCount: Array.isArray(movements) ? movements.length : 0,
  });
}
