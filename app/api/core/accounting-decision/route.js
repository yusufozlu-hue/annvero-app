import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  jsonForbidden,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { resolveAccountingDecision } from "@/src/core/annveroCore.js";
import { KNOWLEDGE_TABLES } from "@/src/lib/knowledge-engine/constants.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 50;

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

function pickDecisionPayload(result = {}) {
  return {
    status: result.status,
    decision_source: result.decision_source,
    confidence_score: result.confidence_score,
    matched_entity: result.matched_entity,
    matched_rule: result.matched_rule,
    matched_pattern_id: result.matched_pattern_id || null,
    suggested_account_code: result.suggested_account_code,
    suggested_account_name: result.suggested_account_name,
    suggested_counter_account_code: result.suggested_counter_account_code,
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

  const transactions = Array.isArray(body?.transactions) ? body.transactions : [];
  if (!transactions.length) {
    return NextResponse.json({ error: "transactions dizisi zorunludur." }, { status: 400 });
  }

  if (transactions.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `En fazla ${MAX_BATCH} işlem tek istekte işlenebilir.` },
      { status: 400 }
    );
  }

  const { supabase, guard } = getApiSupabase(
    "core:accounting-decision",
    KNOWLEDGE_TABLES.DECISION_HISTORY
  );
  if (guard) return guard;

  const requestId =
    request.headers.get("x-request-id") ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `core-batch-${Date.now()}`);

  const includeDebug = Boolean(body?.include_debug ?? body?.includeDebug);

  const decisions = [];
  for (let index = 0; index < transactions.length; index += 1) {
    const tx = transactions[index] || {};
    const rowRequestId = `${requestId}:${index + 1}`;

    try {
      const result = await resolveAccountingDecision(
        {
          source_type: tx.source_type || tx.sourceType || "bank",
          company_id: companyId,
          raw_description: tx.raw_description || tx.rawDescription || "",
          amount: tx.amount,
          currency: tx.currency || "TRY",
          transaction_date: tx.transaction_date || tx.transactionDate,
          bank_name: tx.bank_name || tx.bankName,
          counterparty_name: tx.counterparty_name || tx.counterpartyName,
          iban: tx.iban,
          tax_no: tx.tax_no || tx.taxNo,
          document_type: tx.document_type || tx.documentType,
          raw_payload: tx.raw_payload || tx.rawPayload || {},
        },
        {
          user_id: session.user?.id || "",
          user_role: session.access?.role || "",
          company_access: buildCompanyAccess(session),
          module: "bank_parser",
          request_id: rowRequestId,
          supabase,
        }
      );

      const payload = pickDecisionPayload(result);
      if (!includeDebug) {
        payload.debug_trace = undefined;
      }
      decisions.push(payload);
    } catch (error) {
      decisions.push({
        status: "unknown",
        decision_source: "unknown",
        confidence_score: 0,
        needs_manual_review: true,
        suggested_account_code: null,
        suggested_account_name: null,
        suggested_document_type: null,
        suggested_description: "",
        suggested_vat_rate: null,
        risk_level: "medium",
        matched_entity: null,
        matched_rule: null,
        debug_trace: [
          {
            stage: "api",
            outcome: "error",
            detail: error?.message || "CORE row failed",
          },
        ],
      });
    }
  }

  return NextResponse.json({
    data: {
      decisions,
      company_id: companyId,
      count: decisions.length,
    },
    meta: {
      request_id: requestId,
      module: "bank_parser",
    },
  });
}
