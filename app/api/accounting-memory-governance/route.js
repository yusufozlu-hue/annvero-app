/**
 * Faz 7 — Accounting memory governance API.
 * Liste: BSA + keyword. Mutation: yalnız learning_memory_governance_mutate RPC
 * (tek transaction: CAS + supersede + insert + sibling review + audit).
 * Client createdBy/updatedBy kabul edilmez; actor session’dan.
 */
import { NextResponse } from "next/server";
import {
  applyCompanyScopeToQuery,
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import {
  buildCanonicalGovernanceView,
  annotateConflicts,
  MEMORY_GOVERNANCE_STATUS,
  partitionGovernanceTabs,
  stripClientActorFields,
  toGovernanceUiRow,
} from "@/src/utils/accountingMemoryGovernance";
import { invokeLearningMemoryGovernanceRpc } from "@/src/utils/accountingMemoryGovernanceAtomic";

const TABLE = "learning_memory";

function jsonError(message, status = 400, code = "") {
  return NextResponse.json(
    { ok: false, error: message, code: code || undefined },
    { status }
  );
}

function viewsFromRows(rows, companyId) {
  return annotateConflicts(
    (rows || [])
      .map((r) => buildCanonicalGovernanceView(r))
      .filter(Boolean)
      .filter((v) => v.companyId === companyId)
  );
}

async function loadCompanyMemoryRows(ctx, companyId) {
  let query = ctx.supabase.from(TABLE).select("*");
  const scoped = applyCompanyScopeToQuery(query, ctx.access, companyId);
  if (!scoped) return { rows: [], error: null };
  const { data, error } = await scoped.order("updated_at", { ascending: false });
  if (error) return { rows: [], error };
  return { rows: data || [], error: null };
}

function mapRpcFailure(result) {
  const code = String(result?.code || "");
  if (code === "MIGRATION_REQUIRED") {
    return NextResponse.json(
      {
        ok: false,
        code: "MIGRATION_REQUIRED",
        error:
          result.error ||
          "Governance mutasyonu desteklenmiyor (migration 037 gerekli). Kayıt değiştirilmedi.",
      },
      { status: 503 }
    );
  }
  if (code === "REVISION_CONFLICT") {
    return NextResponse.json(
      {
        ok: false,
        code: "REVISION_CONFLICT",
        requiresReview: true,
        currentRevision: result.currentRevision,
        expectedRevision: result.expectedRevision,
        error:
          "Kayıt başka bir işlemle değişmiş (sürüm çakışması). Liste yenileniyor; lütfen tekrar deneyin.",
      },
      { status: 409 }
    );
  }
  if (code === "NOT_FOUND") {
    return jsonError("Kayıt bulunamadı", 404, "NOT_FOUND");
  }
  if (code === "ACTOR_REQUIRED") {
    return jsonError("Oturum aktörü zorunlu", 401, "ACTOR_REQUIRED");
  }
  return jsonError(result?.error || result?.message || "İşlem başarısız", 500, code || "RPC_FAILED");
}

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });
  if (!companyId) {
    return jsonError("companyId zorunlu", 400, "COMPANY_REQUIRED");
  }

  const ctx = await requireAuthenticatedApi(
    "accounting-memory-governance:get",
    TABLE,
    { companyId }
  );
  if (ctx.error) return ctx.error;

  const { rows, error } = await loadCompanyMemoryRows(ctx, companyId);
  if (error) {
    return jsonError(error.message || "Listeleme başarısız", 500, "LIST_FAILED");
  }

  const views = viewsFromRows(rows, companyId);
  const tabs = partitionGovernanceTabs(views);
  return NextResponse.json({
    ok: true,
    companyId,
    records: views.map(toGovernanceUiRow),
    tabs: {
      active: tabs.active.map(toGovernanceUiRow),
      review: tabs.review.map(toGovernanceUiRow),
      history: tabs.history.map(toGovernanceUiRow),
    },
    stats: {
      active: tabs.active.length,
      review: tabs.review.length,
      history: tabs.history.length,
      total: views.length,
    },
  });
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonError("Geçersiz JSON", 400, "BAD_JSON");
  }

  const safeBody = stripClientActorFields(body || {});
  const action = String(safeBody.action || "").trim().toLowerCase();
  const companyId = resolveCompanyId({
    companyId: safeBody.companyId || safeBody.company_id,
  });
  if (!companyId) {
    return jsonError("companyId zorunlu", 400, "COMPANY_REQUIRED");
  }

  const ctx = await requireAuthenticatedApi(
    `accounting-memory-governance:${action || "post"}`,
    TABLE,
    { companyId }
  );
  if (ctx.error) return ctx.error;

  const actorId = String(ctx.user?.id || ctx.access?.userId || "").trim();
  if (!actorId) {
    return jsonError(
      "Oturum aktörü doğrulanamadı; mutation yapılmadı.",
      401,
      "ACTOR_REQUIRED"
    );
  }
  const memoryId = String(safeBody.memoryId || safeBody.id || "").trim();
  const expectedRevision =
    safeBody.expectedRevision == null ? null : Number(safeBody.expectedRevision);

  const allowed = new Set([
    "deactivate",
    "reactivate",
    "rollback",
    "resolve_conflict",
    "revise",
  ]);
  if (!action || !allowed.has(action)) {
    return jsonError("Bilinmeyen action", 400, "UNKNOWN_ACTION");
  }
  if (!memoryId) {
    return jsonError("memoryId zorunlu", 400, "MEMORY_ID_REQUIRED");
  }

  // Tenant + CAS + mutation + audit: tek RPC transaction.
  // Yanlış companyId → RPC NOT_FOUND (varlık sızdırmaz).
  const rpcResult = await invokeLearningMemoryGovernanceRpc(ctx.supabase, {
    action,
    companyId,
    memoryId,
    expectedRevision,
    actorId,
    payload: {
      reason_code: safeBody.reasonCode || safeBody.reason_code || "",
      account_code: safeBody.accountCode || safeBody.account_code || "",
    },
  });

  if (!rpcResult?.ok) {
    return mapRpcFailure(rpcResult);
  }

  // Refetch canonical row for UI (RPC returns compact record)
  const { data: row } = await ctx.supabase
    .from(TABLE)
    .select("*")
    .eq("id", rpcResult.memoryId || memoryId)
    .eq("company_id", companyId)
    .maybeSingle();

  const view = row
    ? buildCanonicalGovernanceView(row)
    : {
        memoryId: rpcResult.memoryId,
        companyId,
        accountCode: rpcResult.record?.accountCode,
        status: rpcResult.record?.status || MEMORY_GOVERNANCE_STATUS.ACTIVE,
        revision: rpcResult.revision,
        lucaLeg: rpcResult.record?.lucaLeg,
      };

  return NextResponse.json({
    ok: true,
    memoryId: rpcResult.memoryId,
    revision: rpcResult.revision,
    action: rpcResult.action,
    sourceUnchanged: rpcResult.sourceUnchanged,
    record: toGovernanceUiRow(view),
  });
}
