import { createHash } from "node:crypto";
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
  COMPANY_DRIVE_ERROR,
  resolveCompanyDriveConnection,
} from "@/src/lib/googleDrive/resolveCompanyDriveConnection";
import {
  findDriveFileByCompanyContentHash,
  resolveDriveFolderPathFromRoot,
  uploadGoogleDriveBinaryFile,
} from "@/src/utils/cloudStorage/googleDriveAdapter";
import {
  buildDatedArchiveFileName,
  DRIVE_UPLOAD_MAX_BYTES,
  DRIVE_UPLOAD_SCHEMA_VERSION,
  sanitizeUploadFileName,
  validateUploadFileSize,
  validateUploadFileType,
} from "@/src/utils/cloudStorage/uploadPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPLOADS = "company_account_plan_uploads";
const HESAP_PLANI_FOLDER = "01 - Hesap Planı";

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
 * POST multipart: companyId, uploadId, file
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

  if (!companyId || !uploadId) {
    return NextResponse.json(
      { ok: false, error: "companyId ve uploadId zorunlu." },
      { status: 400 }
    );
  }
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return NextResponse.json(
      { ok: false, error: "Dosya zorunlu." },
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

    const originalName = sanitizeUploadFileName(
      String(file.name || upload.file_name || "hesap-plani.xlsx")
    );
    const typeCheck = validateUploadFileType({
      fileName: originalName,
      mimeType: file.type || "",
    });
    if (!typeCheck.ok) {
      await patchArchiveSafe(supabase, uploadId, companyId, {
        archive_status: "archive_pending",
        original_file_name: originalName,
      });
      return NextResponse.json(
        {
          ok: false,
          code: typeCheck.code,
          message: typeCheck.message,
          archiveStatus: "archive_pending",
        },
        { status: 415 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sizeCheck = validateUploadFileSize(buffer.byteLength);
    if (!sizeCheck.ok) {
      await patchArchiveSafe(supabase, uploadId, companyId, {
        archive_status: "archive_pending",
        original_file_name: originalName,
      });
      return NextResponse.json(
        {
          ok: false,
          code: sizeCheck.code,
          message: "Dosya boyutu geçersiz.",
          archiveStatus: "archive_pending",
        },
        { status: sizeCheck.status || 400 }
      );
    }

    const contentHash = createHash("sha256").update(buffer).digest("hex");
    const { driveFileName } = buildDatedArchiveFileName(originalName);

    // Aynı contentHash → ikinci Drive kopyası yok
    let drive;
    try {
      drive = await resolveCompanyDriveConnection(companyId);
    } catch (error) {
      const code = error?.code || "OFFICE_CONNECTION_PENDING";
      const soft = [
        COMPANY_DRIVE_ERROR.FOLDER_BINDING_MISSING,
        COMPANY_DRIVE_ERROR.OFFICE_CONNECTION_PENDING,
        COMPANY_DRIVE_ERROR.ROOT_FOLDER_INVALID,
        COMPANY_DRIVE_ERROR.ROOT_COMPANY_MISMATCH,
        COMPANY_DRIVE_ERROR.CONNECTION_FOREIGN,
      ].includes(code);
      const patched = await patchArchiveSafe(supabase, uploadId, companyId, {
        archive_status: soft ? "archive_skipped" : "archive_pending",
        original_file_name: originalName,
        file_content_hash: contentHash,
      });
      return NextResponse.json(
        publicArchiveResult(patched || upload, {
          ok: soft,
          skipped: soft,
          code,
          archiveStatus: soft ? "archive_skipped" : "archive_pending",
          message: "Drive arşivi ertelendi; aktif plan korundu.",
        }),
        { status: soft ? 200 : 502 }
      );
    }

    try {
      const existing = await findDriveFileByCompanyContentHash({
        accessToken: drive.accessToken,
        companyId,
        contentHash,
      });
      if (existing) {
        const patched = await patchArchiveSafe(supabase, uploadId, companyId, {
          archive_status: "duplicate_archived",
          original_file_name: originalName,
          file_content_hash: contentHash,
          archived_at: new Date().toISOString(),
        });
        return NextResponse.json(
          publicArchiveResult(patched || upload, {
            duplicate: true,
            message: "Aynı içerik zaten Drive’da; ikinci kopya oluşturulmadı.",
          })
        );
      }

      const parentFolderId = await resolveDriveFolderPathFromRoot({
        accessToken: drive.accessToken,
        rootFolderId: drive.rootFolderId,
        targetFolderPath: HESAP_PLANI_FOLDER,
      });

      await uploadGoogleDriveBinaryFile({
        accessToken: drive.accessToken,
        parentFolderId,
        fileName: driveFileName,
        mimeType: typeCheck.mimeType,
        bytes: buffer,
        appProperties: {
          annveroCompanyId: String(companyId),
          annveroContentHash: contentHash,
          annveroSchemaVersion: DRIVE_UPLOAD_SCHEMA_VERSION,
          annveroUploadId: String(uploadId),
          annveroOriginalFileName: originalName.slice(0, 100),
          annveroUploadedAt: new Date().toISOString(),
          annveroDocumentType: "hesap_plani",
        },
      });

      const patched = await patchArchiveSafe(supabase, uploadId, companyId, {
        archive_status: "archived",
        original_file_name: originalName,
        file_content_hash: contentHash,
        archived_at: new Date().toISOString(),
      });

      return NextResponse.json(
        publicArchiveResult(patched || upload, {
          message: "Hesap planı Drive’a arşivlendi.",
        })
      );
    } catch {
      const patched = await patchArchiveSafe(supabase, uploadId, companyId, {
        archive_status: "archive_pending",
        original_file_name: originalName,
        file_content_hash: contentHash,
      });
      return NextResponse.json(
        publicArchiveResult(patched || upload, {
          ok: false,
          code: "DRIVE_UPLOAD_FAILED",
          archiveStatus: "archive_pending",
          message: "Drive arşivi başarısız; aktif plan korundu.",
        }),
        { status: 502 }
      );
    }
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
