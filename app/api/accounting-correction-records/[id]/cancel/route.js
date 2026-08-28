import { NextResponse } from "next/server";
import {
  requireAuthenticatedApi,
  requireRecordCompanyAccess,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import {
  CORRECTION_RECORDS_TABLE,
  CORRECTION_RECORD_ERROR,
  CORRECTION_RECORD_STATUS,
  correctionRecordUserMessage,
  publicCorrectionRecordView,
  resolveCorrectionRecordRouteId,
  validateCancelCorrectionRecordInput,
} from "@/src/utils/correctionRecords";

export async function POST(request, context) {
  const recordId = await resolveCorrectionRecordRouteId(context?.params);
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
    "accounting-correction-records:cancel",
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

  const validation = validateCancelCorrectionRecordInput({
    record: existing,
    cancelReason: body.cancelReason,
    userConfirmed: Boolean(body.userConfirmed),
  });

  if (!validation.ok) {
    return NextResponse.json(
      {
        code: validation.code || CORRECTION_RECORD_ERROR.INVALID,
        error: validation.message || correctionRecordUserMessage(CORRECTION_RECORD_ERROR.INVALID),
      },
      { status: 400 }
    );
  }

  const actorId = String(ctx.user?.id || ctx.user?.email || "");
  const now = new Date().toISOString();

  const { data, error } = await ctx.supabase
    .from(CORRECTION_RECORDS_TABLE)
    .update({
      status: CORRECTION_RECORD_STATUS.CANCELLED,
      cancelled_at: now,
      cancelled_by: actorId,
      cancel_reason: validation.cancelReason,
      updated_at: now,
      metadata: {
        ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
        cancelled_via: "api",
      },
    })
    .eq("id", recordId)
    .in("status", [CORRECTION_RECORD_STATUS.EXPORTED, CORRECTION_RECORD_STATUS.APPLIED])
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      {
        code: CORRECTION_RECORD_ERROR.CONFLICT,
        error: correctionRecordUserMessage(CORRECTION_RECORD_ERROR.CONFLICT),
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    record: publicCorrectionRecordView(data),
  });
}
