import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireManagementApi,
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
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    fileName: row.file_name,
    status: row.status,
    isActive: Boolean(row.is_active),
    totalRows: row.total_rows,
    uploadedAt: row.created_at,
    activatedAt: row.activated_at,
  };
}

export async function POST(request) {
  const mgmt = await requireManagementApi("account-plans:activate", UPLOADS);
  if (mgmt.error) return mgmt.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const companyId = resolveCompanyId(body);
  const uploadId = String(body.uploadId || body.id || "");
  if (!companyId || !uploadId) {
    return NextResponse.json(
      { error: "companyId ve uploadId zorunlu." },
      { status: 400 }
    );
  }
  const accessCheck = assertCompanyAccess(mgmt.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const { supabase, guard } = getApiSupabase("account-plans:activate", UPLOADS);
  if (guard) return guard;

  try {
    const { data: target, error: tErr } = await supabase
      .from(UPLOADS)
      .select("*")
      .eq("id", uploadId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!target) {
      return NextResponse.json({ error: "Sürüm bulunamadı." }, { status: 404 });
    }
    if (target.status === "failed" || target.status === "duplicate") {
      return NextResponse.json(
        { error: "Bu sürüm aktif yapılamaz." },
        { status: 400 }
      );
    }

    // Idempotent: already active
    if (target.is_active) {
      return NextResponse.json({
        ok: true,
        upload: publicUpload(target),
        message: "Sürüm zaten aktif.",
      });
    }

    await supabase
      .from(UPLOADS)
      .update({ is_active: false, status: "superseded" })
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null);

    const { data: activated, error: aErr } = await supabase
      .from(UPLOADS)
      .update({
        is_active: true,
        status: "active",
        activated_at: new Date().toISOString(),
      })
      .eq("id", uploadId)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (aErr) throw aErr;

    return NextResponse.json({
      ok: true,
      upload: publicUpload(activated),
      message: "Önceki güvenli sürüm aktif edildi.",
    });
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
