/**
 * Hesap planı Drive arşiv çekirdeği — API route ve yönetim retry aynı yolu kullanır.
 * Drive teknik kimlik istemciye dönülmez.
 */

import { createHash } from "node:crypto";
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
  DRIVE_UPLOAD_SCHEMA_VERSION,
  sanitizeUploadFileName,
  validateUploadFileSize,
  validateUploadFileType,
} from "@/src/utils/cloudStorage/uploadPolicy";

export const HESAP_PLANI_FOLDER = "01 - Hesap Planı";

/**
 * @param {{
 *   companyId: string,
 *   uploadId: string,
 *   buffer: Buffer,
 *   originalFileName?: string,
 *   mimeType?: string,
 * }} input
 */
export async function archiveAccountPlanBufferToDrive(input) {
  const companyId = String(input.companyId || "").trim();
  const uploadId = String(input.uploadId || "").trim();
  const buffer = input.buffer;
  if (!companyId || !uploadId || !Buffer.isBuffer(buffer)) {
    return {
      ok: false,
      code: "MISSING_INPUT",
      archiveStatus: "archive_pending",
      message: "companyId, uploadId ve dosya zorunlu.",
    };
  }

  const originalName = sanitizeUploadFileName(
    String(input.originalFileName || "hesap-plani.xlsx")
  );
  const typeCheck = validateUploadFileType({
    fileName: originalName,
    mimeType: input.mimeType || "",
  });
  if (!typeCheck.ok) {
    return {
      ok: false,
      code: typeCheck.code,
      archiveStatus: "archive_pending",
      originalFileName: originalName,
      message: typeCheck.message,
    };
  }

  const sizeCheck = validateUploadFileSize(buffer.byteLength);
  if (!sizeCheck.ok) {
    return {
      ok: false,
      code: sizeCheck.code,
      archiveStatus: "archive_pending",
      originalFileName: originalName,
      message: "Dosya boyutu geçersiz.",
    };
  }

  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const { driveFileName } = buildDatedArchiveFileName(originalName);

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
    return {
      ok: soft,
      skipped: soft,
      code,
      archiveStatus: soft ? "archive_skipped" : "archive_pending",
      originalFileName: originalName,
      fileContentHash: contentHash,
      message: "Drive arşivi ertelendi; aktif plan korundu.",
    };
  }

  try {
    const existing = await findDriveFileByCompanyContentHash({
      accessToken: drive.accessToken,
      companyId,
      contentHash,
    });
    if (existing) {
      return {
        ok: true,
        duplicate: true,
        archiveStatus: "duplicate_archived",
        originalFileName: originalName,
        fileContentHash: contentHash,
        driveFileName: existing.name || "",
        message: "Aynı içerik zaten Drive’da; ikinci kopya oluşturulmadı.",
      };
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

    return {
      ok: true,
      archiveStatus: "archived",
      originalFileName: originalName,
      fileContentHash: contentHash,
      driveFileName,
      message: "Hesap planı Drive’a arşivlendi.",
    };
  } catch {
    return {
      ok: false,
      code: "DRIVE_UPLOAD_FAILED",
      archiveStatus: "archive_pending",
      originalFileName: originalName,
      fileContentHash: contentHash,
      message: "Drive arşivi başarısız; aktif plan korundu.",
    };
  }
}

/**
 * Dosya yoksa: kayıtlı contentHash ile Drive’da eşleşme arar (idempotent retry).
 */
export async function reconcileArchiveByStoredHash({
  companyId,
  contentHash,
  originalFileName = "",
}) {
  const hash = String(contentHash || "").trim();
  if (!hash) {
    return {
      ok: false,
      code: "MISSING_HASH",
      archiveStatus: "archive_pending",
      message: "Arşiv için dosya veya contentHash gerekli.",
    };
  }
  let drive;
  try {
    drive = await resolveCompanyDriveConnection(companyId);
  } catch (error) {
    const code = error?.code || "OFFICE_CONNECTION_PENDING";
    return {
      ok: false,
      code,
      archiveStatus: "archive_pending",
      fileContentHash: hash,
      message: "Drive bağlantısı yok; aktif plan korundu.",
    };
  }
  const existing = await findDriveFileByCompanyContentHash({
    accessToken: drive.accessToken,
    companyId,
    contentHash: hash,
  });
  if (!existing) {
    return {
      ok: false,
      code: "FILE_REQUIRED",
      archiveStatus: "archive_pending",
      fileContentHash: hash,
      message: "Drive’da hash eşleşmesi yok; arşiv için dosya ekleyin.",
    };
  }
  return {
    ok: true,
    duplicate: true,
    archiveStatus: "duplicate_archived",
    originalFileName: sanitizeUploadFileName(originalFileName || existing.name || ""),
    fileContentHash: hash,
    message: "Aynı içerik zaten Drive’da; ikinci kopya oluşturulmadı.",
  };
}
