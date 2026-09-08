import { NextResponse } from "next/server";
import {
  applyCompanyScopeToQuery,
  getApiSupabase,
  requireApiSession,
  requireAuthenticatedApi,
  requireRecordCompanyAccess,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import {
  buildAuditContextFromRequest,
  writeAuditEvent,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
} from "@/src/lib/audit/auditEvents";
import {
  buildSafeLearningMemoryPayload,
  isLearningMemorySchemaError,
  LEARNING_MEMORY_SCHEMA_MESSAGE,
} from "@/src/utils/learningMemorySafePayload";

const TABLE = "learning_memory";

const ALLOWED_DOCUMENT_TYPES = new Set([
  "DK",
  "MM",
  "SM",
  "BANK_STATEMENT_FORMAT",
  "BANK_STATEMENT_ACCOUNTING",
]);

const ALLOWED_STATUS = new Set(["active", "passive", "deleted"]);

/** Lifecycle alanları yalnız governance RPC üzerinden değişir */
const GOVERNANCE_LIFECYCLE_KEYS = new Set([
  "status",
  "is_active",
  "isActive",
  "deleted_at",
  "deletedAt",
  "revision",
  "supersedes_id",
  "supersedesId",
  "parent_revision_id",
  "parentRevisionId",
  "reason_code",
  "reasonCode",
  "governance_ready",
  "governanceReady",
]);

function withLearningMemoryAliases(row = {}) {
  return {
    ...row,
    usage_count: row.usage_count ?? row.match_count ?? 0,
  };
}

function hasGovernanceLifecycleMutation(record = {}) {
  return Object.keys(record || {}).some((key) => GOVERNANCE_LIFECYCLE_KEYS.has(key));
}

function governanceRequiredResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "GOVERNANCE_REQUIRED",
      error:
        "Durum / pasife alma / etkinleştirme yalnız muhasebe hafızası governance API üzerinden yapılır. Kayıt değiştirilmedi.",
    },
    { status: 409 }
  );
}

function sanitizeClientLearningRecord(record = {}, companyId = "", { forCreate = false } = {}) {
  const docType = String(record.document_type || record.documentType || "DK")
    .trim()
    .toUpperCase();
  // Create producer: yalnız active; PATCH yaşam döngüsü bu route’tan geçmez
  const status = forCreate ? "active" : "active";
  void ALLOWED_STATUS;

  // Client created_by / createdBy kabul edilmez — oturum audit katmanı yazar
  const safe = buildSafeLearningMemoryPayload({
    ...record,
    company_id: companyId,
    document_type: ALLOWED_DOCUMENT_TYPES.has(docType) ? docType : "DK",
    status,
    is_active: true,
  });

  // user_correction içinden client createdBy spoof’unu temizle + lifecycle spoof
  if (safe.user_correction) {
    try {
      const meta =
        typeof safe.user_correction === "string"
          ? JSON.parse(safe.user_correction)
          : safe.user_correction;
      if (meta && typeof meta === "object") {
        delete meta.createdBy;
        delete meta.created_by;
        delete meta.updatedBy;
        delete meta.updated_by;
        delete meta.status;
        delete meta.revision;
        safe.user_correction = JSON.stringify(meta);
      }
    } catch {
      /* ignore */
    }
  }

  return safe;
}

function buildRecordPayload(record = {}) {
  return buildSafeLearningMemoryPayload(record);
}

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });
  const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "1";

  const ctx = await requireAuthenticatedApi("learning-memory:get", TABLE, { companyId });
  if (ctx.error) return ctx.error;

  let query = ctx.supabase.from(TABLE).select("*");

  const scoped = applyCompanyScopeToQuery(query, ctx.access, companyId);
  if (!scoped) {
    return NextResponse.json({ data: [] });
  }
  query = scoped;

  if (!includeInactive) {
    query = query
      .neq("status", "passive")
      .neq("status", "deleted")
      .neq("status", "superseded")
      .neq("status", "review");
    query = query.is("deleted_at", null);
  }

  let { data, error } = await query.order("learned_at", { ascending: false });

  if (error && isLearningMemorySchemaError(error)) {
    let fallbackQuery = ctx.supabase.from(TABLE).select("*");
    const fallbackScoped = applyCompanyScopeToQuery(fallbackQuery, ctx.access, companyId);
    if (!fallbackScoped) {
      return NextResponse.json({ data: [] });
    }
    ({ data, error } = await fallbackScoped);
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = includeInactive
    ? data || []
    : (data || []).filter(
        (row) =>
          row?.is_active !== false &&
          !["passive", "deleted", "superseded", "review", "conflict"].includes(
            String(row?.status || "active").toLowerCase()
          ) &&
          !row?.deleted_at
      );

  return NextResponse.json({ data: rows.map(withLearningMemoryAliases) });
}

/**
 * POST create/learn producer.
 * Call chain: requireAuthenticatedApi → getApiSupabase(requireServiceRole:true)
 * → service_role INSERT (RLS bypass). Authenticated client INSERT is revoked by 037;
 * this route remains backward-compatible before/after migration because it never
 * used the authenticated role for writes.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const record = body?.record;
  const companyId = resolveCompanyId(record);

  const ctx = await requireAuthenticatedApi("learning-memory:post", TABLE, { companyId });
  if (ctx.error) return ctx.error;

  const actorId = String(ctx.user?.id || ctx.access?.userId || "").trim();
  if (!actorId) {
    return NextResponse.json(
      { ok: false, code: "ACTOR_REQUIRED", error: "Oturum aktörü doğrulanamadı." },
      { status: 401 }
    );
  }

  if (!record?.keyword) {
    return NextResponse.json(
      { error: "Firma ID ve anahtar kelime zorunludur." },
      { status: 400 }
    );
  }

  if (!companyId) {
    return NextResponse.json({ error: "Firma ID zorunludur." }, { status: 400 });
  }

  const insertPayload = sanitizeClientLearningRecord(
    {
      ...record,
      keyword: String(record.keyword).trim(),
      learned_at: record.learned_at || new Date().toISOString(),
    },
    companyId,
    { forCreate: true }
  );
  // Lifecycle always active on create; client status spoof ignored
  insertPayload.status = "active";
  insertPayload.is_active = true;

  const { data, error } = await ctx.supabase
    .from(TABLE)
    .insert([insertPayload])
    .select("*")
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: isLearningMemorySchemaError(error)
          ? LEARNING_MEMORY_SCHEMA_MESSAGE
          : error.message,
      },
      { status: 500 }
    );
  }

  void writeAuditEvent({
    ...buildAuditContextFromRequest(request, ctx),
    companyId,
    entityType: AUDIT_ENTITY_TYPES.LEARNING_MEMORY,
    entityId: data?.id || "",
    action: AUDIT_ACTIONS.CREATE,
    afterState: data,
  });

  return NextResponse.json({ data: withLearningMemoryAliases(data) });
}

export async function PATCH(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const session = await requireApiSession();
  if (session.error) return session.error;

  const { supabase, guard } = getApiSupabase("learning-memory:patch", TABLE);
  if (guard) return guard;

  const updates = Array.isArray(body?.updates) ? body.updates : [];
  const record = body?.record;

  if (record?.id) {
    if (hasGovernanceLifecycleMutation(record)) {
      return governanceRequiredResponse();
    }

    const accessCheck = await requireRecordCompanyAccess(
      supabase,
      TABLE,
      "id",
      record.id,
      session.access
    );
    if (!accessCheck.ok) return accessCheck.response;

    const payload = sanitizeClientLearningRecord(record, accessCheck.companyId);
    // id güncellemede company_id / lifecycle değiştirilmez
    delete payload.company_id;
    delete payload.status;
    delete payload.is_active;
    delete payload.deleted_at;
    delete payload.revision;
    delete payload.supersedes_id;
    delete payload.parent_revision_id;
    delete payload.reason_code;
    delete payload.governance_ready;
    if (!Object.keys(payload).length) {
      return NextResponse.json({ data: null, skipped: true });
    }

    const { data, error } = await supabase
      .from(TABLE)
      .update(payload)
      .eq("id", record.id)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error(error);
      return NextResponse.json(
        {
          error: isLearningMemorySchemaError(error)
            ? LEARNING_MEMORY_SCHEMA_MESSAGE
            : error.message,
        },
        { status: 500 }
      );
    }

    void writeAuditEvent({
      ...buildAuditContextFromRequest(request, session),
      companyId: accessCheck.companyId,
      entityType: AUDIT_ENTITY_TYPES.LEARNING_MEMORY,
      entityId: record.id,
      action: AUDIT_ACTIONS.UPDATE,
      afterState: data,
    });

    return NextResponse.json({ data: withLearningMemoryAliases(data) });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "Güncellenecek kayıt yok." }, { status: 400 });
  }

  const results = [];
  for (const item of updates) {
    const id = item?.id;
    const increment = Number(item?.increment ?? 1);
    if (!id || increment <= 0) continue;

    const accessCheck = await requireRecordCompanyAccess(
      supabase,
      TABLE,
      "id",
      id,
      session.access
    );
    if (!accessCheck.ok) continue;

    const { data: current, error: readError } = await supabase
      .from(TABLE)
      .select("match_count")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      if (isLearningMemorySchemaError(readError)) {
        results.push({ id, increment, skipped: true });
        continue;
      }
      console.error(readError);
      continue;
    }

    const { error: updateError } = await supabase
      .from(TABLE)
      .update({
        match_count: Number(current?.match_count || 0) + increment,
        last_matched_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      if (isLearningMemorySchemaError(updateError)) {
        results.push({ id, increment, skipped: true });
        continue;
      }
      console.error(updateError);
      continue;
    }

    results.push({ id, increment });
  }

  return NextResponse.json({ updated: results });
}

export async function DELETE() {
  // Faz 7: hard/soft delete route kapalı — pasife alma governance API’de
  return NextResponse.json(
    {
      ok: false,
      code: "DELETE_DISABLED",
      error:
        "Hafıza kaydı silinmez. Pasife alma için /api/accounting-memory-governance kullanın.",
    },
    { status: 405 }
  );
}
