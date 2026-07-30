/**
 * ANNVERO V1 job lease + güvenli özet kalıcılığı.
 * Migration yok — mevcut audit_events tablosu kullanılır.
 */

import { NextResponse } from "next/server";
import {
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import {
  writeAuditEvent,
  AUDIT_EVENTS_TABLE,
} from "@/src/lib/audit/auditEvents";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import {
  buildSafeV1PersistPayload,
  publicV1JobView,
  sanitizeIncomingV1JobBody,
  V1_AUDIT_ENTITY_TYPE,
} from "@/src/utils/annveroV1SafePersist";
import {
  buildIdempotencyKey,
  buildLeaseKey,
  V1_JOB_STATE,
} from "@/src/utils/annveroV1Orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const globalLeaseStore =
  globalThis.__ANNVERO_V1_LEASES__ ||
  (globalThis.__ANNVERO_V1_LEASES__ = new Map());

const LEASE_TTL_MS = 15 * 60 * 1000;

function jsonError(code, message, status = 400, extra = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status }
  );
}

function readLease(companyId) {
  const key = buildLeaseKey(companyId);
  const row = globalLeaseStore.get(key);
  if (!row) return null;
  if (Number(row.expiresAt || 0) <= Date.now()) {
    globalLeaseStore.delete(key);
    return null;
  }
  return row;
}

function acquireLease(companyId, leaseId) {
  const existing = readLease(companyId);
  if (existing && existing.leaseId !== leaseId) {
    return { ok: false, code: "COMPANY_JOB_ACTIVE", existing };
  }
  const lease = {
    leaseId,
    companyId,
    expiresAt: Date.now() + LEASE_TTL_MS,
    acquiredAt: Date.now(),
  };
  globalLeaseStore.set(buildLeaseKey(companyId), lease);
  return { ok: true, lease };
}

function releaseLease(companyId, leaseId) {
  const existing = readLease(companyId);
  if (!existing) return true;
  if (leaseId && existing.leaseId !== leaseId) return false;
  globalLeaseStore.delete(buildLeaseKey(companyId));
  return true;
}

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });
  if (!companyId) {
    return jsonError("MISSING_COMPANY_ID", "Firma seçilmedi.", 400);
  }

  const ctx = await requireAuthenticatedApi("annvero-v1-jobs:get", AUDIT_EVENTS_TABLE, {
    companyId,
  });
  if (ctx.error) return ctx.error;

  const limit = Math.min(
    50,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 20) || 20)
  );

  const { data, error } = await ctx.supabase
    .from(AUDIT_EVENTS_TABLE)
    .select("id, company_id, entity_type, entity_id, action, metadata, created_at")
    .eq("company_id", companyId)
    .eq("entity_type", V1_AUDIT_ENTITY_TYPE)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return jsonError("QUERY_FAILED", "Denetim geçmişi okunamadı.", 500);
  }

  const lease = readLease(companyId);
  return NextResponse.json({
    ok: true,
    companyId,
    lease: lease
      ? {
          active: true,
          leaseId: lease.leaseId,
          expiresAt: lease.expiresAt,
        }
      : { active: false },
    runs: (data || []).map(publicV1JobView),
  });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_JSON", "Geçersiz istek gövdesi.", 400);
  }

  const incoming = sanitizeIncomingV1JobBody(body);
  const companyId = resolveCompanyId({ companyId: incoming.companyId });
  if (!companyId) {
    return jsonError("MISSING_COMPANY_ID", "Firma seçilmedi.", 400);
  }

  const ctx = await requireAuthenticatedApi("annvero-v1-jobs:post", AUDIT_EVENTS_TABLE, {
    companyId,
  });
  if (ctx.error) return ctx.error;

  const limited = enforceRateLimit(request, ctx, "annvero-v1-jobs", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const action = incoming.action || "persist";

  if (action === "lease") {
    const leaseId =
      incoming.leaseId ||
      `lease_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const acquired = acquireLease(companyId, leaseId);
    if (!acquired.ok) {
      return jsonError(
        "COMPANY_JOB_ACTIVE",
        "Bu firma için zaten aktif bir işlem var.",
        409,
        { leaseId: acquired.existing?.leaseId }
      );
    }
    return NextResponse.json({
      ok: true,
      action: "lease",
      companyId,
      leaseId: acquired.lease.leaseId,
      expiresAt: acquired.lease.expiresAt,
    });
  }

  if (action === "release") {
    const released = releaseLease(companyId, incoming.leaseId);
    if (!released) {
      return jsonError("LEASE_MISMATCH", "Lease serbest bırakılamadı.", 409);
    }
    return NextResponse.json({ ok: true, action: "release", companyId });
  }

  if (action === "checkpoint") {
    const leaseId = incoming.leaseId;
    if (leaseId) {
      const acquired = acquireLease(companyId, leaseId);
      if (!acquired.ok) {
        return jsonError(
          "COMPANY_JOB_ACTIVE",
          "Bu firma için zaten aktif bir işlem var.",
          409
        );
      }
    }
    const payload = buildSafeV1PersistPayload({
      companyId,
      jobId: incoming.jobId,
      idempotencyKey:
        incoming.idempotencyKey ||
        buildIdempotencyKey({ companyId, contentHash: "" }),
      leaseId: incoming.leaseId,
      summary: {
        ...incoming.summary,
        terminalStatus:
          incoming.summary.terminalStatus || V1_JOB_STATE.PERSISTING,
      },
      checkpointPhase: incoming.checkpointPhase,
    });
    await writeAuditEvent({
      actorId: ctx.user?.id,
      actorEmail: ctx.user?.email,
      companyId,
      entityType: payload.entity_type,
      entityId: payload.entity_id,
      action: "v1_job_checkpoint",
      metadata: payload.metadata,
    });
    return NextResponse.json({
      ok: true,
      action: "checkpoint",
      companyId,
      checkpointPhase: incoming.checkpointPhase,
    });
  }

  const payload = buildSafeV1PersistPayload({
    companyId,
    jobId: incoming.jobId,
    idempotencyKey: incoming.idempotencyKey,
    leaseId: incoming.leaseId,
    summary: incoming.summary,
    checkpointPhase: incoming.checkpointPhase,
  });

  const idempotencyKey = String(payload.metadata?.idempotency_key || "").trim();
  if (idempotencyKey && !idempotencyKey.endsWith(":nohash")) {
    const { data: existingRows, error: existingError } = await ctx.supabase
      .from(AUDIT_EVENTS_TABLE)
      .select("id, company_id, entity_type, entity_id, action, metadata, created_at")
      .eq("company_id", companyId)
      .eq("entity_type", V1_AUDIT_ENTITY_TYPE)
      .eq("action", "v1_job_persist")
      .contains("metadata", { idempotency_key: idempotencyKey })
      .order("created_at", { ascending: false })
      .limit(1);
    if (!existingError && existingRows?.[0]) {
      if (incoming.leaseId) {
        releaseLease(companyId, incoming.leaseId);
      }
      return NextResponse.json({
        ok: true,
        action: "persist",
        companyId,
        persisted: false,
        duplicate: true,
        view: publicV1JobView(existingRows[0]),
      });
    }
  }

  const written = await writeAuditEvent({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    companyId,
    entityType: payload.entity_type,
    entityId: payload.entity_id,
    action: "v1_job_persist",
    metadata: payload.metadata,
  });

  if (incoming.leaseId) {
    releaseLease(companyId, incoming.leaseId);
  }

  return NextResponse.json({
    ok: true,
    action: "persist",
    companyId,
    persisted: Boolean(written?.ok !== false),
    duplicate: false,
    view: publicV1JobView({
      company_id: companyId,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      metadata: payload.metadata,
      created_at: new Date().toISOString(),
    }),
  });
}
