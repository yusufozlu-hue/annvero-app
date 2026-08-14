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
import {
  ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  evaluateV1PersistIdempotencyDecision,
} from "@/src/utils/bankStatementReanalyze";

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

function isMissingRelation(error) {
  const msg = String(error?.message || error?.code || "");
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /does not exist|Could not find the table/i.test(msg)
  );
}

async function loadOwnedBankSource(supabase, companyId, sourceId) {
  const id = String(sourceId || "").trim();
  const company = String(companyId || "").trim();
  if (!id || !company) return { source: null, missingTable: false };
  const { data, error } = await supabase
    .from("bank_statement_sources")
    .select("id, company_id, revision, content_hash, plan_content_fingerprint")
    .eq("id", id)
    .eq("company_id", company)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return { source: null, missingTable: true };
    return { source: null, missingTable: false, lookupError: true };
  }
  return { source: data || null, missingTable: false };
}

function persistDecisionResponse({
  companyId,
  persisted,
  existingJob,
  compatible,
  reason,
  reanalyze = false,
  revision = null,
  supersedesJobId = null,
  view = null,
  jobId = null,
}) {
  return NextResponse.json({
    ok: true,
    action: "persist",
    companyId,
    persisted: Boolean(persisted),
    duplicate: Boolean(existingJob && compatible && !persisted),
    reanalyze: Boolean(reanalyze),
    existingJob: Boolean(existingJob),
    compatible: Boolean(compatible),
    compatibleExistingJob: Boolean(compatible && existingJob),
    compatibilityReason: reason || null,
    revision: revision || null,
    supersedesJobId: supersedesJobId || null,
    jobId: jobId || view?.id || view?.metadata?.job_id || null,
    view,
  });
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

  if (action === "persist") {
    const requestedSourceId = String(
      incoming.summary?.sourceId || incoming.summary?.source_id || ""
    ).trim();
    if (requestedSourceId) {
      const owned = await loadOwnedBankSource(
        ctx.supabase,
        companyId,
        requestedSourceId
      );
      if (owned.missingTable) {
        return jsonError(
          "SCHEMA_MISSING",
          "Canonical snapshot tabloları henüz uygulanmadı.",
          503
        );
      }
      if (owned.lookupError) {
        return jsonError("SOURCE_LOOKUP_FAILED", "Kaynak doğrulanamadı.", 500);
      }
      if (!owned.source) {
        return jsonError(
          "SOURCE_NOT_IN_COMPANY",
          "Kaynak bu firmaya ait değil.",
          403
        );
      }
      incoming.summary.sourceId = owned.source.id;
      incoming.summary.sourceRevision = String(owned.source.revision ?? "");
      if (owned.source.content_hash) {
        incoming.summary.snapshotFingerprint = String(owned.source.content_hash);
      }
      if (owned.source.plan_content_fingerprint) {
        incoming.summary.planFingerprint = String(
          owned.source.plan_content_fingerprint
        );
      }
    }
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
    summary: {
      ...incoming.summary,
      reanalyze: incoming.reanalyze,
      revision: incoming.revision,
      revisionOf: incoming.revisionOf,
      supersedesJobId: incoming.supersedesJobId || incoming.revisionOf,
    },
    checkpointPhase: incoming.checkpointPhase,
  });

  // Explicit reanalyze/revision — prior job aynı tenant’ta olmalı; eski kayıt silinmez.
  if (incoming.reanalyze) {
    const priorId = String(
      incoming.revisionOf || incoming.supersedesJobId || ""
    ).trim();
    if (!priorId) {
      return jsonError(
        "MISSING_REVISION_OF",
        "Yeniden analiz için önceki iş kimliği gerekli.",
        400
      );
    }
    const { data: priorRow, error: priorError } = await ctx.supabase
      .from(AUDIT_EVENTS_TABLE)
      .select("id, company_id, entity_type, entity_id, action, metadata, created_at")
      .eq("id", priorId)
      .maybeSingle();
    if (priorError || !priorRow) {
      return jsonError(
        "PRIOR_JOB_NOT_FOUND",
        "Önceki analiz kaydı bulunamadı.",
        404
      );
    }
    if (String(priorRow.company_id || "") !== String(companyId)) {
      return jsonError(
        "CROSS_TENANT_FORBIDDEN",
        "Başka firmanın kaynağı veya planı kullanılamaz.",
        403
      );
    }
    const priorRev = Number(priorRow.metadata?.revision || 1) || 1;
    const nextRev =
      Number(incoming.revision) > 0
        ? Number(incoming.revision)
        : priorRev + 1;
    payload.metadata.reanalyze = true;
    payload.metadata.revision = nextRev;
    payload.metadata.revision_of = priorId;
    payload.metadata.supersedes_job_id = priorId;
    // Revision yolu: base idempotency ile çakışmasın — :rev:N anahtarı kullanılır.
    if (
      payload.metadata.idempotency_key &&
      !String(payload.metadata.idempotency_key).includes(":rev:")
    ) {
      payload.metadata.idempotency_key = `${payload.metadata.idempotency_key}:rev:${nextRev}`;
    }
  }

  const idempotencyKey = String(payload.metadata?.idempotency_key || "").trim();
  const incomingSummary = {
    ...incoming.summary,
    engineVersion: payload.metadata.engine_version,
    pipelineVersion:
      payload.metadata.pipeline_version ||
      ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
    sourceId: payload.metadata.source_id,
    sourceRevision: payload.metadata.source_revision,
    snapshotFingerprint: payload.metadata.snapshot_fingerprint,
    planFingerprint: payload.metadata.plan_fingerprint,
    outputGateCode: payload.metadata.output_gate_code,
    balanceCode: payload.metadata.balance_code,
    terminalStatus: payload.metadata.terminal_status,
  };

  let existingRow = null;
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
      existingRow = existingRows[0];
    }
  }

  const activeLease = readLease(companyId);
  const decision = evaluateV1PersistIdempotencyDecision({
    incomingIdempotencyKey: idempotencyKey,
    incomingCompanyId: companyId,
    incomingSummary,
    expectedPipelineVersion:
      payload.metadata.pipeline_version ||
      ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
    existingRow,
    incomingLeaseId: incoming.leaseId || "",
    activeLeaseId: activeLease?.leaseId || "",
  });

  if (decision.action === "deny") {
    return jsonError(
      decision.code || "CROSS_TENANT_FORBIDDEN",
      "Başka firmanın kaynağı veya planı kullanılamaz.",
      decision.status || 403
    );
  }

  if (decision.action === "reuse" || decision.action === "join") {
    if (incoming.leaseId && decision.action === "reuse") {
      releaseLease(companyId, incoming.leaseId);
    }
    return persistDecisionResponse({
      companyId,
      persisted: false,
      existingJob: true,
      compatible: true,
      reason: decision.reason,
      reanalyze: Boolean(incoming.reanalyze),
      revision: existingRow?.metadata?.revision || payload.metadata?.revision || null,
      supersedesJobId:
        existingRow?.metadata?.supersedes_job_id ||
        payload.metadata?.supersedes_job_id ||
        null,
      view: publicV1JobView(existingRow),
      jobId: existingRow?.id || existingRow?.metadata?.job_id || null,
    });
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

  return persistDecisionResponse({
    companyId,
    persisted: Boolean(written?.ok !== false),
    existingJob: false,
    compatible: false,
    reason: decision.reason,
    reanalyze: Boolean(incoming.reanalyze),
    revision: payload.metadata?.revision || null,
    supersedesJobId:
      payload.metadata?.supersedes_job_id || decision.supersededJobId || null,
    view: publicV1JobView({
      id: written?.id || null,
      company_id: companyId,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      metadata: payload.metadata,
      created_at: new Date().toISOString(),
    }),
    jobId: written?.id || payload.entity_id,
  });
}
