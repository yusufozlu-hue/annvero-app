import { NextResponse } from "next/server";
import {
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";

const UPLOADS = "company_account_plan_uploads";

function isMissingRelation(error) {
  const msg = String(error?.message || error?.code || "");
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /does not exist|Could not find the table/i.test(msg)
  );
}

function publicUpload(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    fileName: row.file_name,
    contentFingerprint: row.content_fingerprint,
    uploadedBy: row.uploaded_by_label || row.uploaded_by || "",
    uploadedAt: row.created_at,
    status: row.status,
    isActive: Boolean(row.is_active),
    totalRows: row.total_rows,
    addedCount: row.added_count,
    updatedCount: row.updated_count,
    skippedCount: row.skipped_count,
    errorCount: row.error_count,
    safeErrorSummary: row.safe_error_summary || "",
    activatedAt: row.activated_at,
  };
}

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunlu." }, { status: 400 });
  }

  const ctx = await requireAuthenticatedApi(
    "account-plans:uploads",
    UPLOADS,
    { companyId }
  );
  if (ctx.error) return ctx.error;

  try {
    const { data, error } = await ctx.supabase
      .from(UPLOADS)
      .select(
        "id, company_id, file_name, content_fingerprint, uploaded_by, uploaded_by_label, status, is_active, total_rows, added_count, updated_count, skipped_count, error_count, safe_error_summary, created_at, activated_at"
      )
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ data: (data || []).map(publicUpload) });
  } catch (error) {
    if (isMissingRelation(error)) {
      return NextResponse.json(
        {
          error: "Hesap planı tabloları henüz uygulanmadı.",
          code: "SCHEMA_MISSING",
          migration: "029_account_plan_uploads_and_user_notifications.sql",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
