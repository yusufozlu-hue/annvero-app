import { NextResponse } from "next/server";
import {
  requireAuthenticatedApi,
  requireRecordCompanyAccess,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import { formatLedgerPeriodKey } from "@/src/utils/correctionVoucher/correctionDatePolicy";
import {
  CORRECTION_RECORDS_TABLE,
  CORRECTION_RECORD_ERROR,
  CORRECTION_RECORD_STATUS,
  correctionRecordUserMessage,
  publicCorrectionRecordView,
  validateApplyCorrectionRecordInput,
} from "@/src/utils/correctionRecords";

function sanitizeText(value, max = 280) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

export async function POST(request, { params }) {
  const recordId = String(params?.id || "").trim();
  if (!recordId) {
    return NextResponse.json(
      {
        code: CORRECTION_RECORD_ERROR.NOT_FOUND,
        error: correctionRecordUserMessage(CORRECTION_RECORD_ERROR.NOT_FOUND),
      },
      { status: 404 }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        code: CORRECTION_RECORD_ERROR.INVALID,
        error: correctionRecordUserMessage(CORRECTION_RECORD_ERROR.INVALID),
      },
      { status: 400 }
    );
  }

  const companyId = resolveCompanyId(body);
  const ctx = await requireAuthenticatedApi(
    "accounting-correction-records:apply",
    CORRECTION_RECORDS_TABLE,
    { companyId }
  );
  if (ctx.error) {
    return NextResponse.json(
      {
        code: CORRECTION_RECORD_ERROR.UNAUTHORIZED,
        error: correctionRecordUserMessage(CORRECTION_RECORD_ERROR.UNAUTHORIZED),
      },
      { status: ctx.error.status || 403 }
    );
  }

  const accessCheck = await requireRecordCompanyAccess(
    ctx.supabase,
    CORRECTION_RECORDS_TABLE,
    "id",
    recordId,
    ctx.access
  );
  if (!accessCheck.ok) {
    return NextResponse.json(
      {
        code: CORRECTION_RECORD_ERROR.NOT_FOUND,
        error: correctionRecordUserMessage(CORRECTION_RECORD_ERROR.NOT_FOUND),
      },
      { status: accessCheck.response.status || 404 }
    );
  }

  const { data: existing, error: loadError } = await ctx.supabase
    .from(CORRECTION_RECORDS_TABLE)
    .select("*")
    .eq("id", recordId)
    .maybeSingle();

  if (loadError || !existing) {
    return NextResponse.json(
      {
        code: CORRECTION_RECORD_ERROR.NOT_FOUND,
        error: correctionRecordUserMessage(CORRECTION_RECORD_ERROR.NOT_FOUND),
      },
      { status: 404 }
    );
  }

  const validation = validateApplyCorrectionRecordInput({
    record: existing,
    externalVoucherNo: body.externalVoucherNo || body.lucaVoucherNo,
    externalVoucherDate: body.externalVoucherDate || body.lucaVoucherDate,
    userConfirmed: Boolean(body.userConfirmed),
    lastClosedLedgerPeriod: formatLedgerPeriodKey(
      sanitizeText(body.lastClosedLedgerPeriod, 16)
    ),
    lastClosedReliability: sanitizeText(body.lastClosedReliability, 40) || "USER_CONFIRMED",
  });

  if (!validation.ok) {
    return NextResponse.json(
      {
        code: validation.code || CORRECTION_RECORD_ERROR.APPLY_FAILED,
        error: validation.message || correctionRecordUserMessage(CORRECTION_RECORD_ERROR.APPLY_FAILED),
        warnings: validation.warnings || [],
      },
      { status: 400 }
    );
  }

  const actorId = String(ctx.user?.id || ctx.user?.email || "");
  const now = new Date().toISOString();

  const { data, error } = await ctx.supabase
    .from(CORRECTION_RECORDS_TABLE)
    .update({
      status: CORRECTION_RECORD_STATUS.APPLIED,
      external_voucher_no: validation.externalVoucherNo,
      external_voucher_date: validation.externalVoucherDate,
      applied_at: now,
      applied_by: actorId,
      updated_at: now,
      metadata: {
        ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
        apply_warnings: validation.warnings || [],
      },
    })
    .eq("id", recordId)
    .eq("status", CORRECTION_RECORD_STATUS.EXPORTED)
    .select("*")
    .maybeSingle();

  if (error || !data) {
    console.error("[accounting-correction-records:apply]", error?.code);
    return NextResponse.json(
      {
        code: CORRECTION_RECORD_ERROR.APPLY_FAILED,
        error: correctionRecordUserMessage(CORRECTION_RECORD_ERROR.APPLY_FAILED),
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    record: publicCorrectionRecordView(data),
    warnings: validation.warnings || [],
  });
}
