import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { enforceBodySizeLimit } from "@/src/lib/security/requestGuards";
import { getValidGoogleAccessToken } from "@/src/lib/googleDrive/connectionStore";
import {
  assertDriveRootBelongsToCompany,
  findDriveFileByCompanyContentHash,
  resolveDriveFolderPathFromRoot,
  uploadGoogleDriveBinaryFile,
} from "@/src/utils/cloudStorage/googleDriveAdapter";
import {
  assertUploadTargetPath,
  DRIVE_UPLOAD_MAX_BYTES,
  DRIVE_UPLOAD_SCHEMA_VERSION,
  sanitizeUploadFileName,
  validateUploadFileSize,
  validateUploadFileType,
} from "@/src/utils/cloudStorage/uploadPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SAFE = Object.freeze({
  MISSING_COMPANY_ID: "Firma seçilmedi.",
  MISSING_FILE: "Yüklenecek dosya bulunamadı.",
  COMPANY_NOT_FOUND: "Firma bulunamadı.",
  COMPANY_INACTIVE: "Pasif firmalara evrak yüklenemez.",
  FOLDER_BINDING_MISSING: "Önce firma Drive klasörünü oluşturun.",
  DRIVE_CONNECTION_MISSING: "Google Drive bağlantısı bulunamadı.",
  ROOT_FOLDER_INVALID: "Firma Drive kök klasörü geçersiz veya silinmiş.",
  ROOT_COMPANY_MISMATCH: "Drive kök klasörü bu firmaya bağlı değil.",
  TARGET_FOLDER_MISSING: "Hedef klasör Drive’da bulunamadı. Önce klasör yapısını oluşturun.",
  SYSTEM_FOLDER_FORBIDDEN: "Sistem klasörüne (_ANNVERO) dosya yüklenemez.",
  INVALID_TARGET_PATH: "Hedef klasör şema v1 izinli yollarından biri değil.",
  UNSUPPORTED_FILE_TYPE: "Desteklenmeyen dosya türü. PDF, Excel, XML veya görsel yükleyin.",
  MIME_EXTENSION_MISMATCH: "Dosya uzantısı ile içerik türü uyuşmuyor.",
  EMPTY_FILE: "Boş dosya yüklenemez.",
  PAYLOAD_TOO_LARGE: `Dosya çok büyük. En fazla ${(DRIVE_UPLOAD_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB yükleyebilirsiniz.`,
  DUPLICATE_CONTENT: "Bu dosya daha önce yüklendi (içerik mükerrer).",
  DRIVE_UPLOAD_FAILED: "Dosya Google Drive’a yüklenemedi.",
  FORBIDDEN: "Bu firmaya erişim yetkiniz yok.",
});

function jsonError(code, status = 400, extra = {}) {
  return NextResponse.json(
    {
      ok: false,
      code,
      message: SAFE[code] || SAFE.DRIVE_UPLOAD_FAILED,
      ...extra,
    },
    { status }
  );
}

function isCompanyActive(company) {
  return company?.data?.isActive !== false;
}

function publicFileMeta({
  fileName,
  mimeType,
  size,
  contentHash,
  targetFolderPath,
  duplicate = false,
}) {
  return {
    fileName,
    mimeType,
    size,
    contentHash,
    targetFolderPath,
    duplicate: Boolean(duplicate),
    // Drive teknik kimlikleri istemciye verilmez.
  };
}

/**
 * POST /api/google-drive/files/upload
 * multipart/form-data: companyId, targetFolderPath, file
 * Drive’a app-created yükleme — drive.file kapsamında görünür.
 * DB’ye yazmaz; indeksleme sync ile yapılır.
 */
export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const limited = enforceRateLimit(request, session, "google-drive-files-upload", {
    limit: 20,
    windowMs: 300_000,
  });
  if (limited) return limited;

  const sizeGate = enforceBodySizeLimit(request, DRIVE_UPLOAD_MAX_BYTES + 256_000);
  if (sizeGate) {
    return jsonError("PAYLOAD_TOO_LARGE", 413);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonError("PAYLOAD_TOO_LARGE", 413);
  }

  const companyId = String(form.get("companyId") || "").trim();
  const targetFolderPathRaw = String(form.get("targetFolderPath") || "").trim();
  const file = form.get("file");

  if (!companyId) return jsonError("MISSING_COMPANY_ID", 400);
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return jsonError("MISSING_FILE", 400);
  }

  const access = assertCompanyAccess(session.access, companyId, { required: true });
  if (!access.ok) return access.response;

  const pathCheck = assertUploadTargetPath(targetFolderPathRaw);
  if (!pathCheck.ok) {
    return jsonError(pathCheck.code, 400);
  }
  const targetFolderPath = pathCheck.path;

  const originalName = String(file.name || "evrak");
  const safeName = sanitizeUploadFileName(originalName);
  const typeCheck = validateUploadFileType({
    fileName: safeName,
    mimeType: file.type || "",
  });
  if (!typeCheck.ok) return jsonError(typeCheck.code, 415);

  const buffer = Buffer.from(await file.arrayBuffer());
  const sizeCheck = validateUploadFileSize(buffer.byteLength);
  if (!sizeCheck.ok) {
    return jsonError(sizeCheck.code, sizeCheck.status || 400);
  }

  const contentHash = createHash("sha256").update(buffer).digest("hex");

  const { supabase, guard } = getApiSupabase(
    "google-drive-files-upload",
    "company_cloud_folders"
  );
  if (guard) return guard;

  const [{ data: company, error: companyError }, { data: folder, error: folderError }] =
    await Promise.all([
      supabase.from("companies").select("id,data").eq("id", companyId).single(),
      supabase
        .from("company_cloud_folders")
        .select("root_folder_id")
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);

  if (companyError || !company) return jsonError("COMPANY_NOT_FOUND", 404);
  if (!isCompanyActive(company)) return jsonError("COMPANY_INACTIVE", 409);
  if (folderError || !folder?.root_folder_id) {
    return jsonError("FOLDER_BINDING_MISSING", 409);
  }

  let token;
  try {
    token = await getValidGoogleAccessToken(session.user.id);
  } catch {
    return jsonError("DRIVE_CONNECTION_MISSING", 409);
  }

  try {
    await assertDriveRootBelongsToCompany({
      accessToken: token.accessToken,
      rootFolderId: folder.root_folder_id,
      companyId,
    });

    const existing = await findDriveFileByCompanyContentHash({
      accessToken: token.accessToken,
      companyId,
      contentHash,
    });
    if (existing) {
      return NextResponse.json(
        {
          ok: true,
          code: "DUPLICATE_CONTENT",
          message: SAFE.DUPLICATE_CONTENT,
          file: publicFileMeta({
            fileName: existing.name || safeName,
            mimeType: existing.mimeType || typeCheck.mimeType,
            size: existing.size ? Number(existing.size) : sizeCheck.size,
            contentHash,
            targetFolderPath,
            duplicate: true,
          }),
        },
        { status: 409 }
      );
    }

    const parentFolderId = await resolveDriveFolderPathFromRoot({
      accessToken: token.accessToken,
      rootFolderId: folder.root_folder_id,
      targetFolderPath,
    });

    await uploadGoogleDriveBinaryFile({
      accessToken: token.accessToken,
      parentFolderId,
      fileName: safeName,
      mimeType: typeCheck.mimeType,
      bytes: buffer,
      appProperties: {
        annveroCompanyId: String(companyId),
        annveroContentHash: contentHash,
        annveroSchemaVersion: DRIVE_UPLOAD_SCHEMA_VERSION,
      },
    });

    // Başarılı Drive yüklemesi — document_index’e yazılmaz (sync indeksler).
    return NextResponse.json({
      ok: true,
      code: "UPLOADED",
      message: "Dosya Drive’a yüklendi.",
      file: publicFileMeta({
        fileName: safeName,
        mimeType: typeCheck.mimeType,
        size: sizeCheck.size,
        contentHash,
        targetFolderPath,
        duplicate: false,
      }),
    });
  } catch (error) {
    const code = error?.code;
    if (
      code === "ROOT_FOLDER_INVALID" ||
      code === "ROOT_COMPANY_MISMATCH" ||
      code === "TARGET_FOLDER_MISSING" ||
      code === "INVALID_TARGET_PATH"
    ) {
      return jsonError(code, 409);
    }
    return jsonError("DRIVE_UPLOAD_FAILED", 502);
  }
}
