import { NextResponse } from "next/server";
import {
  applyCompanyScopeToQuery,
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import {
  CORRECTION_RECORDS_TABLE,
  CORRECTION_RECORD_ERROR,
  correctionRecordUserMessage,
  publicCorrectionRecordView,
} from "@/src/utils/correctionRecords";

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });
  const status = String(request.nextUrl.searchParams.get("status") || "").trim();
  const fingerprint = String(
    request.nextUrl.searchParams.get("sourceFingerprint") || ""
  ).trim();

  const ctx = await requireAuthenticatedApi(
    "accounting-correction-records:get",
    CORRECTION_RECORDS_TABLE,
    { companyId }
  );
  if (ctx.error) return ctx.error;
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunludur." }, { status: 400 });
  }

  let query = ctx.supabase
    .from(CORRECTION_RECORDS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const scoped = applyCompanyScopeToQuery(query, ctx.access, companyId);
  if (!scoped) {
    return NextResponse.json({ records: [] });
  }
  query = scoped;

  if (status) query = query.eq("status", status);
  if (fingerprint) query = query.eq("source_fingerprint", fingerprint);

  const { data, error } = await query;
  if (error) {
    console.error("[accounting-correction-records:get]", error.code);
    return NextResponse.json(
      { error: correctionRecordUserMessage(CORRECTION_RECORD_ERROR.INVALID) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    records: (data || []).map(publicCorrectionRecordView).filter(Boolean),
  });
}
