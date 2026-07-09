import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  jsonForbidden,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { resolveAccountingDecision } from "@/src/core/annveroCore.js";
import { probeKnowledgeDatabase } from "@/src/core/db/knowledgeStore.js";
import { KNOWLEDGE_TABLES } from "@/src/lib/knowledge-engine/constants.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function pickDecisionFields(result = {}) {
  return {
    status: result.status,
    decision_source: result.decision_source,
    confidence_score: result.confidence_score,
    matched_entity: result.matched_entity,
    matched_rule: result.matched_rule,
    suggested_account_code: result.suggested_account_code,
    suggested_account_name: result.suggested_account_name,
    suggested_cari: result.suggested_cari,
    suggested_document_type: result.suggested_document_type,
    suggested_vat_rate: result.suggested_vat_rate,
    suggested_description: result.suggested_description,
    risk_level: result.risk_level,
    needs_manual_review: result.needs_manual_review,
    debug_trace: result.debug_trace,
  };
}

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const isDev = process.env.NODE_ENV === "development";
  const isManagement = Boolean(session.access?.isManagementUser);

  if (!isDev && !isManagement) {
    return jsonForbidden("Bu endpoint yalnızca development veya yönetim kullanıcıları içindir.");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const companyId = String(body?.company_id || body?.companyId || "").trim();
  if (!companyId) {
    return NextResponse.json({ error: "company_id zorunludur." }, { status: 400 });
  }

  const accessCheck = assertCompanyAccess(session.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const { supabase, guard } = getApiSupabase("dev:core-test", KNOWLEDGE_TABLES.DECISION_HISTORY);
  if (guard) return guard;

  const requestId =
    request.headers.get("x-request-id") ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `core-test-${Date.now()}`);

  const knowledgeDbHealth = await probeKnowledgeDatabase({ supabase }, companyId);

  const result = await resolveAccountingDecision(
    {
      source_type: body.source_type || body.sourceType || "bank",
      company_id: companyId,
      raw_description: body.raw_description || body.rawDescription || "",
      amount: body.amount,
      currency: body.currency || "TRY",
      transaction_date: body.transaction_date || body.transactionDate,
      bank_name: body.bank_name || body.bankName,
      counterparty_name: body.counterparty_name || body.counterpartyName,
      iban: body.iban,
      tax_no: body.tax_no || body.taxNo,
      document_type: body.document_type || body.documentType,
      raw_payload: body.raw_payload || body.rawPayload || {},
    },
    {
      user_id: session.user?.id || "",
      user_role: session.access?.role || "",
      company_access: buildCompanyAccess(session),
      module: "dev_core_test",
      request_id: requestId,
      supabase,
    }
  );

  return NextResponse.json({
    data: pickDecisionFields(result),
    meta: {
      request_id: requestId,
      company_id: companyId,
      environment: process.env.NODE_ENV || "unknown",
      knowledge_db: {
        client_type: knowledgeDbHealth.clientType,
        ok: knowledgeDbHealth.ok,
        reason: knowledgeDbHealth.reason,
        missing_env: knowledgeDbHealth.env?.missingEnv || [],
        tables: knowledgeDbHealth.tables,
      },
    },
  });
}
