/**
 * Banka ekstresi canonical snapshot API (PDF/Excel ortak).
 * Yazma: service_role. Okuma: üyelik + company scope.
 * Ham belge / Drive ID / token istemciye dönülmez.
 */

import { NextResponse } from "next/server";
import {
  applyCompanyScopeToQuery,
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import { excludeSoftDeleted } from "@/src/lib/softDelete";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import {
  assertNoRawBankSnapshotLeak,
  canReanalyzeFromCanonicalSnapshot,
  publicBankSnapshotMovementView,
  publicBankSnapshotSourceView,
  sanitizeIncomingSnapshotBody,
} from "@/src/utils/bankCanonicalSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCES = "bank_statement_sources";
const MOVEMENTS = "bank_statement_movements";

function isMissingRelation(error) {
  const msg = String(error?.message || error?.code || "");
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /does not exist|Could not find the table/i.test(msg)
  );
}

function schemaMissingResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "Canonical snapshot tabloları henüz uygulanmadı.",
      code: "SCHEMA_MISSING",
      migration: "031_bank_statement_canonical_snapshots.sql",
    },
    { status: 503 }
  );
}

function jsonError(code, message, status = 400, extra = {}) {
  return NextResponse.json({ ok: false, code, message, ...extra }, { status });
}

async function loadMovements(supabase, companyId, sourceId) {
  const { data, error } = await supabase
    .from(MOVEMENTS)
    .select("*")
    .eq("company_id", companyId)
    .eq("source_id", sourceId)
    .is("deleted_at", null)
    .order("sort_index", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return (data || []).map(publicBankSnapshotMovementView);
}

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });
  if (!companyId) {
    return jsonError("MISSING_COMPANY_ID", "Firma seçilmedi.", 400);
  }

  const ctx = await requireAuthenticatedApi(
    "bank-statement-snapshots:get",
    SOURCES,
    { companyId }
  );
  if (ctx.error) return ctx.error;

  const sourceId = String(
    request.nextUrl.searchParams.get("sourceId") || ""
  ).trim();
  const latest = request.nextUrl.searchParams.get("latest") === "1";
  const includeMovements =
    request.nextUrl.searchParams.get("includeMovements") !== "0";
  const contentHash = String(
    request.nextUrl.searchParams.get("contentHash") || ""
  ).trim();

  try {
    if (sourceId) {
      let query = ctx.supabase
        .from(SOURCES)
        .select("*")
        .eq("id", sourceId)
        .eq("company_id", companyId);
      query = excludeSoftDeleted(query);
      const { data, error } = await query.maybeSingle();
      if (error) {
        if (isMissingRelation(error)) return schemaMissingResponse();
        return jsonError("QUERY_FAILED", "Snapshot okunamadı.", 500);
      }
      if (!data) {
        return jsonError("NOT_FOUND", "Snapshot bulunamadı.", 404);
      }
      if (data.status === "deleted") {
        return jsonError(
          "SOURCE_DELETED",
          "Silinmiş kaynak yeniden kullanılamaz.",
          410
        );
      }
      const movements = includeMovements
        ? await loadMovements(ctx.supabase, companyId, data.id)
        : [];
      const gate = canReanalyzeFromCanonicalSnapshot({
        source: publicBankSnapshotSourceView(data),
        movements,
      });
      return NextResponse.json({
        ok: true,
        source: publicBankSnapshotSourceView(data),
        movements,
        canReanalyze: gate.ok,
        canReanalyzeCode: gate.ok ? "OK" : gate.code,
      });
    }

    let query = ctx.supabase
      .from(SOURCES)
      .select("*")
      .eq("company_id", companyId)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(latest ? 1 : 30);
    query = excludeSoftDeleted(query);
    const scoped = applyCompanyScopeToQuery(query, ctx.access, companyId);
    if (!scoped) {
      return NextResponse.json({ ok: true, sources: [], source: null, movements: [] });
    }
    query = scoped;
    if (contentHash) query = query.eq("content_hash", contentHash);
    if (latest) query = query.eq("status", "active");

    const { data, error } = await query;
    if (error) {
      if (isMissingRelation(error)) return schemaMissingResponse();
      return jsonError("QUERY_FAILED", "Snapshot listesi okunamadı.", 500);
    }

    const sources = (data || []).map(publicBankSnapshotSourceView);
    if (!latest) {
      return NextResponse.json({ ok: true, sources });
    }

    const source = sources[0] || null;
    if (!source) {
      return NextResponse.json({
        ok: true,
        source: null,
        movements: [],
        canReanalyze: false,
        canReanalyzeCode: "NO_CANONICAL_MOVEMENTS",
      });
    }
    const movements = includeMovements
      ? await loadMovements(ctx.supabase, companyId, source.id)
      : [];
    const gate = canReanalyzeFromCanonicalSnapshot({ source, movements });
    return NextResponse.json({
      ok: true,
      source,
      movements,
      canReanalyze: gate.ok,
      canReanalyzeCode: gate.ok ? "OK" : gate.code,
    });
  } catch (error) {
    if (isMissingRelation(error)) return schemaMissingResponse();
    console.error("[bank-statement-snapshots:get]", error?.message || error);
    return jsonError("QUERY_FAILED", "Snapshot okunamadı.", 500);
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "Geçersiz istek gövdesi.", 400);
  }

  try {
    assertNoRawBankSnapshotLeak(body);
  } catch (error) {
    return jsonError(error.code || "RAW_LEAK", error.message, 400);
  }

  const sanitized = sanitizeIncomingSnapshotBody(body);
  const companyId = sanitized.source.company_id;
  if (!companyId) {
    return jsonError("MISSING_COMPANY_ID", "Firma seçilmedi.", 400);
  }

  const ctx = await requireAuthenticatedApi(
    "bank-statement-snapshots:post",
    SOURCES,
    { companyId }
  );
  if (ctx.error) return ctx.error;

  const limited = enforceRateLimit(request, ctx, "bank-statement-snapshots", {
    limit: 40,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const action = sanitized.action || "upsert";

  try {
    if (action === "soft_delete") {
      const sourceId = sanitized.sourceId;
      if (!sourceId) {
        return jsonError("MISSING_SOURCE_ID", "sourceId gerekli.", 400);
      }
      const now = new Date().toISOString();
      const actor = String(ctx.user?.id || ctx.user?.email || "");
      const { data: existing, error: findErr } = await ctx.supabase
        .from(SOURCES)
        .select("id, company_id, status, deleted_at")
        .eq("id", sourceId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (findErr) {
        if (isMissingRelation(findErr)) return schemaMissingResponse();
        return jsonError("QUERY_FAILED", "Kaynak bulunamadı.", 500);
      }
      if (!existing || existing.deleted_at || existing.status === "deleted") {
        return jsonError(
          "SOURCE_DELETED",
          "Silinmiş kaynak yeniden kullanılamaz.",
          410
        );
      }
      const { error: srcErr } = await ctx.supabase
        .from(SOURCES)
        .update({
          status: "deleted",
          deleted_at: now,
          deleted_by: actor,
        })
        .eq("id", sourceId)
        .eq("company_id", companyId);
      if (srcErr) {
        return jsonError("DELETE_FAILED", "Kaynak silinemedi.", 500);
      }
      await ctx.supabase
        .from(MOVEMENTS)
        .update({ deleted_at: now, deleted_by: actor })
        .eq("source_id", sourceId)
        .eq("company_id", companyId)
        .is("deleted_at", null);
      return NextResponse.json({
        ok: true,
        deleted: true,
        sourceId,
      });
    }

    if (action === "update_plan_meta") {
      const sourceId = sanitized.sourceId;
      if (!sourceId) {
        return jsonError("MISSING_SOURCE_ID", "sourceId gerekli.", 400);
      }
      const { data: existing, error: findErr } = await ctx.supabase
        .from(SOURCES)
        .select("*")
        .eq("id", sourceId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .maybeSingle();
      if (findErr) {
        if (isMissingRelation(findErr)) return schemaMissingResponse();
        return jsonError("QUERY_FAILED", "Kaynak bulunamadı.", 500);
      }
      if (!existing || existing.status === "deleted") {
        return jsonError(
          "SOURCE_DELETED",
          "Silinmiş kaynak yeniden kullanılamaz.",
          410
        );
      }
      const { data: updated, error: updErr } = await ctx.supabase
        .from(SOURCES)
        .update({
          plan_content_fingerprint:
            sanitized.source.plan_content_fingerprint ||
            existing.plan_content_fingerprint,
          plan_account_count:
            sanitized.source.plan_account_count || existing.plan_account_count,
          v1_audit_entity_id:
            sanitized.source.v1_audit_entity_id || existing.v1_audit_entity_id,
          safe_summary: {
            ...(existing.safe_summary || {}),
            ...(sanitized.source.safe_summary || {}),
          },
        })
        .eq("id", sourceId)
        .eq("company_id", companyId)
        .select("*")
        .maybeSingle();
      if (updErr) {
        return jsonError("UPDATE_FAILED", "Plan meta güncellenemedi.", 500);
      }
      return NextResponse.json({
        ok: true,
        source: publicBankSnapshotSourceView(updated),
        created: false,
        reused: true,
      });
    }

    // upsert — aynı content_hash + active → movements koru / yenile; yeni Drive/source yok
    if (!sanitized.source.content_hash) {
      return jsonError("MISSING_CONTENT_HASH", "contentHash zorunlu.", 400);
    }
    if (!sanitized.movements.length) {
      return jsonError(
        "NO_MOVEMENTS",
        "Canonical hareket listesi boş; snapshot yazılmaz.",
        400
      );
    }

    const { data: existing, error: existErr } = await ctx.supabase
      .from(SOURCES)
      .select("*")
      .eq("company_id", companyId)
      .eq("content_hash", sanitized.source.content_hash)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existErr) {
      if (isMissingRelation(existErr)) return schemaMissingResponse();
      return jsonError("QUERY_FAILED", "Mevcut snapshot aranamadı.", 500);
    }

    const actor = String(ctx.user?.id || ctx.user?.email || "");

    if (existing) {
      const { data: updated, error: updErr } = await ctx.supabase
        .from(SOURCES)
        .update({
          file_name: sanitized.source.file_name || existing.file_name,
          mime_type: sanitized.source.mime_type || existing.mime_type,
          byte_length: sanitized.source.byte_length || existing.byte_length,
          detected_bank:
            sanitized.source.detected_bank || existing.detected_bank,
          source_type: sanitized.source.source_type || existing.source_type,
          schema_version:
            sanitized.source.schema_version || existing.schema_version,
          plan_content_fingerprint:
            sanitized.source.plan_content_fingerprint ||
            existing.plan_content_fingerprint,
          plan_account_count:
            sanitized.source.plan_account_count || existing.plan_account_count,
          movement_count: sanitized.movements.length,
          v1_audit_entity_id:
            sanitized.source.v1_audit_entity_id || existing.v1_audit_entity_id,
          safe_summary: {
            ...(existing.safe_summary || {}),
            ...(sanitized.source.safe_summary || {}),
          },
        })
        .eq("id", existing.id)
        .eq("company_id", companyId)
        .select("*")
        .maybeSingle();
      if (updErr) {
        return jsonError("UPDATE_FAILED", "Snapshot güncellenemedi.", 500);
      }

      // Hareketleri yenile (aynı source_id — ikinci source yok)
      await ctx.supabase
        .from(MOVEMENTS)
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: actor,
        })
        .eq("source_id", existing.id)
        .eq("company_id", companyId)
        .is("deleted_at", null);

      const movementRows = sanitized.movements.map((m) => ({
        ...m,
        source_id: existing.id,
        company_id: companyId,
      }));
      const { error: movErr } = await ctx.supabase
        .from(MOVEMENTS)
        .insert(movementRows);
      if (movErr) {
        return jsonError("MOVEMENT_WRITE_FAILED", "Hareketler yazılamadı.", 500);
      }

      const movements = await loadMovements(
        ctx.supabase,
        companyId,
        existing.id
      );
      return NextResponse.json({
        ok: true,
        source: publicBankSnapshotSourceView(updated),
        movements,
        created: false,
        reused: true,
      });
    }

    const insertPayload = {
      ...sanitized.source,
      created_by: actor,
      movement_count: sanitized.movements.length,
    };
    const { data: created, error: createErr } = await ctx.supabase
      .from(SOURCES)
      .insert([insertPayload])
      .select("*")
      .maybeSingle();
    if (createErr) {
      if (isMissingRelation(createErr)) return schemaMissingResponse();
      return jsonError("CREATE_FAILED", "Snapshot oluşturulamadı.", 500);
    }

    const movementRows = sanitized.movements.map((m) => ({
      ...m,
      source_id: created.id,
      company_id: companyId,
    }));
    const { error: movErr } = await ctx.supabase
      .from(MOVEMENTS)
      .insert(movementRows);
    if (movErr) {
      // Kaynağı soft-delete — yarım kayıt kullanılamasın
      await ctx.supabase
        .from(SOURCES)
        .update({
          status: "deleted",
          deleted_at: new Date().toISOString(),
          deleted_by: actor,
        })
        .eq("id", created.id);
      return jsonError("MOVEMENT_WRITE_FAILED", "Hareketler yazılamadı.", 500);
    }

    const movements = await loadMovements(ctx.supabase, companyId, created.id);
    return NextResponse.json({
      ok: true,
      source: publicBankSnapshotSourceView(created),
      movements,
      created: true,
      reused: false,
    });
  } catch (error) {
    if (isMissingRelation(error)) return schemaMissingResponse();
    console.error("[bank-statement-snapshots:post]", error?.message || error);
    return jsonError("WRITE_FAILED", "Snapshot yazılamadı.", 500);
  }
}
