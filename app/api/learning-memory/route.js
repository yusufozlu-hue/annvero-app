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
import { buildSoftDeletePatch } from "@/src/lib/softDelete";
import {
  buildSafeLearningMemoryPayload,
  isLearningMemorySchemaError,
  LEARNING_MEMORY_SCHEMA_MESSAGE,
} from "@/src/utils/learningMemorySafePayload";

const TABLE = "learning_memory";

function withLearningMemoryAliases(row = {}) {
  return {
    ...row,
    usage_count: row.usage_count ?? row.match_count ?? 0,
  };
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
    query = query.neq("status", "passive").neq("status", "deleted");
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
          !["passive", "deleted"].includes(String(row?.status || "active").toLowerCase()) &&
          !row?.deleted_at
      );

  return NextResponse.json({ data: rows.map(withLearningMemoryAliases) });
}

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

  if (!record?.keyword) {
    return NextResponse.json(
      { error: "Firma ID ve anahtar kelime zorunludur." },
      { status: 400 }
    );
  }

  const insertPayload = buildSafeLearningMemoryPayload({
    ...record,
    company_id: companyId,
    keyword: String(record.keyword).trim(),
    document_type: record.document_type || "DK",
    learned_at: record.learned_at || new Date().toISOString(),
    status: record.status || "active",
  });

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
    const accessCheck = await requireRecordCompanyAccess(
      supabase,
      TABLE,
      "id",
      record.id,
      session.access
    );
    if (!accessCheck.ok) return accessCheck.response;

    const payload = buildRecordPayload(record);
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

export async function DELETE(request) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Kayıt ID gerekli." }, { status: 400 });
  }

  const session = await requireApiSession();
  if (session.error) return session.error;

  const { supabase, guard } = getApiSupabase("learning-memory:delete", TABLE);
  if (guard) return guard;

  const accessCheck = await requireRecordCompanyAccess(
    supabase,
    TABLE,
    "id",
    id,
    session.access
  );
  if (!accessCheck.ok) return accessCheck.response;

  const softPatch = {
    ...buildSoftDeletePatch(session.user),
    status: "deleted",
  };

  const { error } = await supabase.from(TABLE).update(softPatch).eq("id", id);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void writeAuditEvent({
    ...buildAuditContextFromRequest(request, session),
    companyId: accessCheck.companyId,
    entityType: AUDIT_ENTITY_TYPES.LEARNING_MEMORY,
    entityId: id,
    action: AUDIT_ACTIONS.SOFT_DELETE,
    afterState: softPatch,
  });

  return NextResponse.json({ ok: true });
}
