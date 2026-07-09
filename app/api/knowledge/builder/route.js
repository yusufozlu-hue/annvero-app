import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import {
  buildAuditContextFromRequest,
  writeAuditEvent,
} from "@/src/lib/audit/auditEvents";
import { KNOWLEDGE_TABLES } from "@/src/lib/knowledge-engine/constants";
import { resolveAccountingDecision } from "@/src/core/annveroCore.js";
import {
  buildMovementTransactionForRerun,
  saveKnowledgeTeach,
  validateKnowledgeTeachPayload,
} from "@/src/core/knowledge/knowledgeBuilder.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickDecisionPayload(result = {}) {
  return {
    status: result.status,
    decision_source: result.decision_source,
    confidence_score: result.confidence_score,
    matched_entity: result.matched_entity,
    matched_rule: result.matched_rule,
    suggested_account_code: result.suggested_account_code,
    suggested_account_name: result.suggested_account_name,
    suggested_counter_account_code: result.suggested_counter_account_code,
    suggested_cari: result.suggested_cari,
    suggested_document_type: result.suggested_document_type,
    suggested_vat_rate: result.suggested_vat_rate,
    suggested_description: result.suggested_description,
    risk_level: result.risk_level,
    needs_manual_review: result.needs_manual_review,
  };
}

function buildCompanyAccess(session = {}) {
  const access = session.access || {};
  if (
    access.isManagementUser ||
    access.isPlatformAdmin ||
    access.role === "admin" ||
    access.role === "partner"
  ) {
    return ["*"];
  }
  return Array.isArray(access.companyIds) ? access.companyIds : [];
}

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const teach = body?.teach || body?.payload || body;
  const companyId = resolveCompanyId(teach);
  const accessCheck = assertCompanyAccess(session.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const isGlobal = Boolean(teach.is_global);
  if (isGlobal && !session.access?.isManagementUser) {
    return NextResponse.json(
      { error: "Global kural eklemek için yönetim yetkisi gerekli." },
      { status: 403 }
    );
  }

  const validation = validateKnowledgeTeachPayload({ ...teach, company_id: companyId });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.errors.join(" ") }, { status: 400 });
  }

  const { supabase, guard } = getApiSupabase(
    "knowledge:builder",
    KNOWLEDGE_TABLES.COMPANY_MEMORY
  );
  if (guard) return guard;

  const saveResult = await saveKnowledgeTeach(
    supabase,
    { ...teach, company_id: companyId },
    { userId: session.user?.id || "" }
  );

  if (!saveResult.ok) {
    return NextResponse.json({ error: saveResult.error || "Kayıt başarısız." }, { status: 500 });
  }

  const auditContext = buildAuditContextFromRequest(request, session);
  await writeAuditEvent({
    ...auditContext,
    companyId,
    entityType: saveResult.audit?.entity_type || "knowledge_rule",
    entityId: saveResult.audit?.entity_id || "",
    action: saveResult.audit?.action || saveResult.result?.action || "CREATE",
    afterState: saveResult.audit?.after_state,
    metadata: saveResult.audit?.metadata || {},
  });

  let coreDecision = null;
  const movement = body?.movement || {};
  const movementContext = body?.movement_context || body?.movementContext || {};

  if (movement && (movement.description || movement.raw_description || teach.keyword)) {
    const tx = buildMovementTransactionForRerun(
      {
        description: movement.description || teach.keyword,
        documentType: teach.document_type,
        rawRow: movement.raw_row || movement.rawRow || {},
        bankName: teach.bank_name,
        direction: movement.direction,
        date: movement.date,
        amount: movement.amount,
      },
      {
        selectedBank: movementContext.selected_bank || movementContext.selectedBank || teach.bank_name,
        sourceType: teach.source_type || "bank",
      }
    );

    try {
      const result = await resolveAccountingDecision(
        {
          source_type: tx.source_type,
          company_id: companyId,
          raw_description: tx.raw_description,
          amount: tx.amount,
          currency: tx.currency || "TRY",
          transaction_date: tx.transaction_date,
          bank_name: tx.bank_name,
          counterparty_name: tx.counterparty_name,
          document_type: tx.document_type,
          raw_payload: tx.raw_payload || {},
        },
        {
          user_id: session.user?.id || "",
          user_role: session.access?.role || "",
          company_access: buildCompanyAccess(session),
          module: "knowledge_builder",
          request_id: `kb-${Date.now()}`,
          supabase,
        }
      );
      coreDecision = pickDecisionPayload(result);
    } catch (error) {
      coreDecision = {
        status: "unknown",
        decision_source: "unknown",
        confidence_score: 0,
        needs_manual_review: true,
        debug_note: error?.message || "CORE rerun failed",
      };
    }
  }

  return NextResponse.json({
    data: {
      save: saveResult.result,
      core_decision: coreDecision,
    },
    meta: {
      module: "knowledge_builder",
      company_id: companyId,
    },
  });
}
