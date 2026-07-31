import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireManagementApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { enforceBodySizeLimit } from "@/src/lib/security/requestGuards";
import {
  archiveAccountPlanBufferToDrive,
  reconcileArchiveByStoredHash,
} from "@/src/utils/accountPlanArchive";
import { DRIVE_UPLOAD_MAX_BYTES } from "@/src/utils/cloudStorage/uploadPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPLOADS = "company_account_plan_uploads";

function isMissingRelation(error) {
  const msg = String(error?.message || error?.code || "");
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /does not exist|Could not find the table/i.test(msg)
  );
}

function publicArchiveResult(upload, extra = {}) {
  return {
    ok: true,
    uploadId: upload?.id || null,
    archiveStatus: upload?.archive_status || extra.archiveStatus || "none",
    originalFileName: upload?.original_file_name || extra.originalFileName || "",
    fileName: upload?.file_name || "",
    archivedAt: upload?.archived_at || null,
    // Drive id / token asla dönülmez
    ...extra,
  };
}

async function patchArchiveSafe(supabase, uploadId, companyId, patch) {
  const { data, error } = await supabase
    .from(UPLOADS)
    .update(patch)
    .eq("id", uploadId)
    .eq("company_id", companyId)
    .select("*")
    .maybeSingle();
  if (error) {
    if (/column|schema cache/i.test(String(error.message || ""))) {
      return null;
    }
    throw error;
  }
  return data;
}

/**
 * POST multipart: companyId, uploadId, file? (opsiyonel — yalnız hash reconcile)
 * Drive arşivi. Başarısızlık aktif planı silmez — archive_pending.
 */
export async function POST(request) {
  const mgmt = await requireManagementApi("account-plans:archive", UPLOADS);
  if (mgmt.error) return mgmt.error;

  const limited = enforceRateLimit(request, mgmt, "account-plans-archive", {
    limit: 20,
    windowMs: 300_000,
  });
  if (limited) return limited;

  const sizeGate = enforceBodySizeLimit(request, DRIVE_UPLOAD_MAX_BYTES + 256_000);
  if (sizeGate) {
    return NextResponse.json(
      { ok: false, code: "PAYLOAD_TOO_LARGE", message: "Dosya çok büyük." },
      { status: 413 }
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, code: "PAYLOAD_TOO_LARGE", message: "Dosya okunamadı." },
      { status: 413 }
    );
  }

  const companyId = resolveCompanyId({
    companyId: String(form.get("companyId") || ""),
  });
  const uploadId = String(form.get("uploadId") || "").trim();
  const file = form.get("file");
  const hasFile =
    file && typeof file !== "string" && typeof file.arrayBuffer === "function";

  if (!companyId || !uploadId) {
    return NextResponse.json(
      { ok: false, error: "companyId ve uploadId zorunlu." },
      { status: 400 }
    );
  }

  const accessCheck = assertCompanyAccess(mgmt.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const { supabase, guard } = getApiSupabase("account-plans:archive", UPLOADS);
  if (guard) return guard;

  try {
    const { data: upload, error: uErr } = await supabase
      .from(UPLOADS)
      .select("*")
      .eq("id", uploadId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (uErr) throw uErr;
    if (!upload) {
      return NextResponse.json({ ok: false, error: "Yükleme bulunamadı." }, { status: 404 });
    }
    if (upload.status === "failed") {
      return NextResponse.json(
        { ok: false, error: "Başarısız yükleme arşivlenmez." },
        { status: 400 }
      );
    }
    if (
      upload.archive_status === "archived" ||
      upload.archive_status === "duplicate_archived"
    ) {
      return NextResponse.json(
        publicArchiveResult(upload, { duplicate: true, message: "Zaten arşivli." })
      );
    }

    if (!hasFile) {
      const reconciled = await reconcileArchiveByStoredHash({
        companyId,
        contentHash: upload.file_content_hash || "",
        originalFileName: upload.original_file_name || upload.file_name || "",
      });
      if (!reconciled.ok) {
        const patched = await patchArchiveSafe(supabase, uploadId, companyId, {
          archive_status: "archive_pending",
        });
        return NextResponse.json(
          publicArchiveResult(patched || upload, {
            ok: false,
            code: reconciled.code || "FILE_REQUIRED",
            archiveStatus: "archive_pending",
            message:
              reconciled.message ||
              "Arşiv için orijinal Excel ekleyin (plan yeniden yüklenmez).",
          }),
          { status: reconciled.code === "FILE_REQUIRED" ? 400 : 502 }
        );
      }
      const patched = await patchArchiveSafe(supabase, uploadId, companyId, {
        archive_status: reconciled.archiveStatus,
        original_file_name:
          reconciled.originalFileName ||
          upload.original_file_name ||
          upload.file_name ||
          "",
        file_content_hash: reconciled.fileContentHash || upload.file_content_hash,
        archived_at: new Date().toISOString(),
      });
      return NextResponse.json(
        publicArchiveResult(patched || upload, {
          duplicate: true,
          message: reconciled.message,
        })
      );
    }

    const originalName = String(
      file.name || upload.original_file_name || upload.file_name || "hesap-plani.xlsx"
    );
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await archiveAccountPlanBufferToDrive({
      companyId,
      uploadId,
      buffer,
      originalFileName: originalName,
      mimeType: file.type || "",
    });

    const patch = {
      archive_status: result.archiveStatus || "archive_pending",
      original_file_name: result.originalFileName || originalName,
    };
    if (result.fileContentHash) patch.file_content_hash = result.fileContentHash;
    if (
      result.archiveStatus === "archived" ||
      result.archiveStatus === "duplicate_archived"
    ) {
      patch.archived_at = new Date().toISOString();
    }

    const patched = await patchArchiveSafe(supabase, uploadId, companyId, patch);
    const softOk = result.ok === true || result.skipped === true;
    const status =
      softOk || result.archiveStatus === "archive_skipped"
        ? 200
        : result.code === "UNSUPPORTED_FILE_TYPE"
          ? 415
          : 502;

    return NextResponse.json(
      publicArchiveResult(patched || upload, {
        ok: softOk,
        skipped: Boolean(result.skipped),
        duplicate: Boolean(result.duplicate),
        code: result.code,
        archiveStatus: result.archiveStatus,
        message: result.message,
      }),
      { status }
    );
  } catch (error) {
    if (isMissingRelation(error)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Hesap planı tabloları henüz uygulanmadı.",
          code: "SCHEMA_MISSING",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { ok: false, error: error?.message || "Arşiv başarısız." },
      { status: 500 }
    );
  }
}
