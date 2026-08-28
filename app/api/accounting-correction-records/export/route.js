import { NextResponse } from "next/server";
import {
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import { buildCorrectionExportWorkbook } from "@/src/utils/correctionVoucher/correctionVoucherEngine";
import { CORRECTION_EXPORT_MODE } from "@/src/utils/correctionVoucher/correctionRecipeTypes";
import {
  buildExportRecordPayloadFromDraft,
  CORRECTION_RECORDS_TABLE,
  CORRECTION_RECORD_ERROR,
  correctionRecordUserMessage,
  publicCorrectionRecordView,
  upsertExportedCorrectionRecord,
} from "@/src/utils/correctionRecords";

function sanitizeText(value, max = 280) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

export async function POST(request) {
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
    "accounting-correction-records:export",
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
  if (!companyId) {
    return NextResponse.json(
      { code: CORRECTION_RECORD_ERROR.INVALID, error: "companyId zorunludur." },
      { status: 400 }
    );
  }

  const draft = body.draft && typeof body.draft === "object" ? body.draft : {};
  const recipe = body.recipe && typeof body.recipe === "object" ? body.recipe : {};
  const userApproved = Boolean(body.userApproved);
  const lastClosedReliability = sanitizeText(body.lastClosedReliability, 40) || null;

  if (!userApproved) {
    return NextResponse.json(
      { code: CORRECTION_RECORD_ERROR.INVALID, error: "Export için kullanıcı onayı gerekir." },
      { status: 400 }
    );
  }

  draft.companyId = companyId;

  const exportPreview = buildCorrectionExportWorkbook(draft, {
    userApproved: true,
    exportMode: CORRECTION_EXPORT_MODE.LUCA_STANDARD,
    lastClosedReliability,
    companySlug: sanitizeText(body.companySlug, 64),
  });

  if (!exportPreview.ok) {
    return NextResponse.json(
      {
        code: CORRECTION_RECORD_ERROR.INVALID,
        error: exportPreview.message || correctionRecordUserMessage(CORRECTION_RECORD_ERROR.INVALID),
      },
      { status: 400 }
    );
  }

  const payload = buildExportRecordPayloadFromDraft({
    draft,
    recipe,
    exportedFileName: exportPreview.fileName,
    lastClosedReliability,
  });

  if (!payload.ok) {
    return NextResponse.json(
      {
        code: payload.code || CORRECTION_RECORD_ERROR.INVALID,
        error: payload.message || correctionRecordUserMessage(CORRECTION_RECORD_ERROR.INVALID),
      },
      { status: 400 }
    );
  }

  const actorId = String(ctx.user?.id || ctx.user?.email || "");

  try {
    const { record, created } = await upsertExportedCorrectionRecord(
      ctx.supabase,
      payload.row,
      actorId
    );

    return NextResponse.json({
      record: publicCorrectionRecordView(record),
      created,
      fileName: exportPreview.fileName,
      rowCount: exportPreview.rowCount,
    });
  } catch (error) {
    console.error("[accounting-correction-records:export]", error?.code || error?.message);
    return NextResponse.json(
      {
        code: CORRECTION_RECORD_ERROR.EXPORT_FAILED,
        error: correctionRecordUserMessage(CORRECTION_RECORD_ERROR.EXPORT_FAILED),
      },
      { status: 500 }
    );
  }
}
