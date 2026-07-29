import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
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
import { classifyUploadTarget } from "@/src/utils/cloudStorage/documentClassify.js";
import { validateDocumentCompanyMatch } from "@/src/utils/cloudStorage/companyContentMatch.js";
import {
  buildUploadIdempotencyKey,
  enqueueSyncRetry,
  classifySyncFailure,
} from "@/src/utils/cloudStorage/syncRetry.js";
import { runCompanyDriveSync } from "@/src/utils/cloudStorage/runCompanyDriveSync";
import { DOCUMENT_PARSE_STATUS } from "@/src/utils/cloudStorage/types.js";
import {
  assertUploadTargetPath,
  DRIVE_UPLOAD_DEFAULT_FOLDER,
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
  FOLDER_BINDING_MISSING:
    "Ofis bağlantısı hazırlanıyor. Lütfen muhasebe ofisinizle iletişime geçin.",
  DRIVE_CONNECTION_MISSING:
    "Ofis bağlantısı hazırlanıyor. Lütfen muhasebe ofisinizle iletişime geçin.",
  OFFICE_CONNECTION_PENDING:
    "Ofis bağlantısı hazırlanıyor. Lütfen muhasebe ofisinizle iletişime geçin.",
  ROOT_FOLDER_INVALID: "Firma Drive kök klasörü geçersiz veya silinmiş.",
  ROOT_COMPANY_MISMATCH: "Drive kök klasörü bu firmaya bağlı değil.",
  CONNECTION_FOREIGN: "Firma depolama bağlantısı bu kayıtla eşleşmiyor.",
  TARGET_FOLDER_MISSING: "Hedef klasör Drive’da bulunamadı. Önce klasör yapısını oluşturun.",
  SYSTEM_FOLDER_FORBIDDEN: "Sistem klasörüne (_ANNVERO) dosya yüklenemez.",
  INVALID_TARGET_PATH: "Hedef klasör şema v2 izinli yollarından biri değil.",
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

function publicClassification(classification) {
  if (!classification) return null;
  return {
    targetFolderPath: classification.targetFolderPath,
    documentType: classification.documentType,
    confidence: classification.confidence,
    needsReview: Boolean(classification.needsReview),
    reason: classification.reason,
  };
}

function publicContentMatch(match) {
  if (!match) return null;
  return {
    status: match.status,
    confidence: match.confidence,
    reasons: Array.isArray(match.reasons) ? match.reasons.slice(0, 12) : [],
    quarantine: Boolean(match.quarantine),
  };
}

async function upsertIndexRow(supabase, row) {
  const { error } = await supabase.from("document_index").upsert(row, {
    onConflict: "company_id,provider_file_id",
  });
  if (error) throw error;
}

async function patchParseStatusByProviderFileId(
  supabase,
  companyId,
  providerFileId,
  parseStatus
) {
  if (!providerFileId || !parseStatus) return;
  await supabase
    .from("document_index")
    .update({ parse_status: parseStatus })
    .eq("company_id", companyId)
    .eq("provider_file_id", providerFileId);
}

async function patchParseStatusByHash(supabase, companyId, contentHash, parseStatus) {
  if (!contentHash || !parseStatus) return;
  await supabase
    .from("document_index")
    .update({ parse_status: parseStatus })
    .eq("company_id", companyId)
    .eq("file_hash", contentHash)
    .neq("parse_status", DOCUMENT_PARSE_STATUS.SOFT_DELETED);
}

/**
 * POST /api/google-drive/files/upload
 * multipart/form-data: companyId, targetFolderPath?, file
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
  let targetFolderPathRaw = String(form.get("targetFolderPath") || "").trim();
  const file = form.get("file");

  if (!companyId) return jsonError("MISSING_COMPANY_ID", 400);
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return jsonError("MISSING_FILE", 400);
  }

  const access = assertCompanyAccess(session.access, companyId, { required: true });
  if (!access.ok) return access.response;

  const originalName = String(file.name || "evrak");
  const safeName = sanitizeUploadFileName(originalName);
  const typeCheck = validateUploadFileType({
    fileName: safeName,
    mimeType: file.type || "",
  });
  if (!typeCheck.ok) return jsonError(typeCheck.code, 415);

  const classification = classifyUploadTarget({
    fileName: safeName,
    mimeType: typeCheck.mimeType,
  });

  if (!targetFolderPathRaw) {
    targetFolderPathRaw = classification.targetFolderPath;
  }

  const pathCheck = assertUploadTargetPath(targetFolderPathRaw);
  if (!pathCheck.ok) {
    return jsonError(pathCheck.code, 400);
  }
  let targetFolderPath = pathCheck.path;

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

  const [{ data: company, error: companyError }] = await Promise.all([
    supabase.from("companies").select("id,data").eq("id", companyId).single(),
  ]);

  if (companyError || !company) return jsonError("COMPANY_NOT_FOUND", 404);
  if (!isCompanyActive(company)) return jsonError("COMPANY_INACTIVE", 409);
  const dupOf =
    company?.data?.duplicate_of || company?.data?.duplicateOf;
  if (dupOf) return jsonError("COMPANY_INACTIVE", 409);

  let drive;
  try {
    drive = await resolveCompanyDriveConnection(companyId);
  } catch (error) {
    const code = error?.code;
    if (
      code === COMPANY_DRIVE_ERROR.FOLDER_BINDING_MISSING ||
      code === COMPANY_DRIVE_ERROR.OFFICE_CONNECTION_PENDING ||
      code === COMPANY_DRIVE_ERROR.ROOT_FOLDER_INVALID ||
      code === COMPANY_DRIVE_ERROR.ROOT_COMPANY_MISMATCH ||
      code === COMPANY_DRIVE_ERROR.CONNECTION_FOREIGN
    ) {
      return jsonError(code, 409);
    }
    return jsonError("OFFICE_CONNECTION_PENDING", 409);
  }

  const contentMatch = validateDocumentCompanyMatch({
    fileName: safeName,
    mimeType: typeCheck.mimeType,
    buffer,
    company,
  });

  let parseStatusHint = null;
  const quarantine =
    Boolean(contentMatch.quarantine) || contentMatch.status === "mismatch";

  if (quarantine) {
    targetFolderPath = DRIVE_UPLOAD_DEFAULT_FOLDER;
    const qPath = assertUploadTargetPath(targetFolderPath);
    if (!qPath.ok) return jsonError(qPath.code, 400);
    targetFolderPath = qPath.path;
    parseStatusHint = DOCUMENT_PARSE_STATUS.QUARANTINE;
  } else if (
    contentMatch.status === "pending" ||
    classification.needsReview
  ) {
    parseStatusHint = DOCUMENT_PARSE_STATUS.CONTENT_PENDING;
  }

  const idempotencyKey = buildUploadIdempotencyKey({
    companyId,
    contentHash,
    targetFolderPath,
  });

  try {
    const existing = await findDriveFileByCompanyContentHash({
      accessToken: drive.accessToken,
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
          classification: publicClassification(classification),
          contentMatch: publicContentMatch(contentMatch),
          parseStatus: parseStatusHint,
          idempotencyKey,
        },
        { status: 409 }
      );
    }

    const parentFolderId = await resolveDriveFolderPathFromRoot({
      accessToken: drive.accessToken,
      rootFolderId: drive.rootFolderId,
      targetFolderPath,
    });

    const appProperties = {
      annveroCompanyId: String(companyId),
      annveroContentHash: contentHash,
      annveroSchemaVersion: DRIVE_UPLOAD_SCHEMA_VERSION,
    };
    if (quarantine) {
      appProperties.annveroQuarantine = "1";
      appProperties.annveroParseStatus = DOCUMENT_PARSE_STATUS.QUARANTINE;
    } else if (parseStatusHint === DOCUMENT_PARSE_STATUS.CONTENT_PENDING) {
      appProperties.annveroNeedsReview = "1";
      appProperties.annveroParseStatus = DOCUMENT_PARSE_STATUS.CONTENT_PENDING;
    }

    const uploaded = await uploadGoogleDriveBinaryFile({
      accessToken: drive.accessToken,
      parentFolderId,
      fileName: safeName,
      mimeType: typeCheck.mimeType,
      bytes: buffer,
      appProperties,
    });

    const providerFileId = uploaded?.id ? String(uploaded.id) : "";
    const sourcePath = `${targetFolderPath}/${safeName}`;
    const now = new Date().toISOString();

    if (quarantine && providerFileId) {
      try {
        await upsertIndexRow(supabase, {
          company_id: companyId,
          provider: "google_drive",
          provider_file_id: providerFileId,
          parent_folder_id: parentFolderId || null,
          file_name: safeName,
          mime_type: typeCheck.mimeType,
          file_size: sizeCheck.size,
          file_hash: contentHash,
          source_path: sourcePath,
          parse_status: DOCUMENT_PARSE_STATUS.QUARANTINE,
          indexed_at: now,
        });
      } catch {
        // İndeks yazılamasa bile Drive yüklemesi geçerli; sync sonra dener.
      }
    }

    let syncResult = null;
    let syncTriggered = false;
    let syncRetryScheduled = false;
    try {
      syncResult = await runCompanyDriveSync({
        supabase,
        accessToken: drive.accessToken,
        companyId,
        rootFolderId: drive.rootFolderId,
        writeSyncEvents: true,
        extraEvents: [
          {
            eventType: "upload_triggered_sync",
            status: "ok",
            providerFileId: providerFileId || null,
            errorMessage: `idemp:${createHash("sha256")
              .update(idempotencyKey)
              .digest("hex")
              .slice(0, 16)}`,
          },
        ],
      });
      syncTriggered = true;

      if (
        parseStatusHint === DOCUMENT_PARSE_STATUS.CONTENT_PENDING &&
        !quarantine
      ) {
        try {
          if (providerFileId) {
            await patchParseStatusByProviderFileId(
              supabase,
              companyId,
              providerFileId,
              DOCUMENT_PARSE_STATUS.CONTENT_PENDING
            );
          } else {
            await patchParseStatusByHash(
              supabase,
              companyId,
              contentHash,
              DOCUMENT_PARSE_STATUS.CONTENT_PENDING
            );
          }
        } catch {
          // patch başarısız — liste sync sonrası indexed gösterebilir
        }
      }

      if (quarantine && providerFileId) {
        try {
          await patchParseStatusByProviderFileId(
            supabase,
            companyId,
            providerFileId,
            DOCUMENT_PARSE_STATUS.QUARANTINE
          );
        } catch {
          // ignore
        }
      }
    } catch (syncError) {
      syncTriggered = false;
      const kind = classifySyncFailure(syncError);
      if (kind.retryable) {
        try {
          await enqueueSyncRetry(supabase, companyId, { attempt: 1 });
          syncRetryScheduled = true;
        } catch {
          // soft — reconcile cron yedek
        }
      }
    }

    return NextResponse.json({
      ok: true,
      code: quarantine ? "UPLOADED_QUARANTINE" : "UPLOADED",
      message: quarantine
        ? "Dosya inceleme klasörüne yüklendi."
        : "Dosya Drive’a yüklendi.",
      file: publicFileMeta({
        fileName: safeName,
        mimeType: typeCheck.mimeType,
        size: sizeCheck.size,
        contentHash,
        targetFolderPath,
        duplicate: false,
      }),
      classification: publicClassification(classification),
      contentMatch: publicContentMatch(contentMatch),
      parseStatus: parseStatusHint || DOCUMENT_PARSE_STATUS.INDEXED,
      needsReview: Boolean(
        classification.needsReview ||
          parseStatusHint === DOCUMENT_PARSE_STATUS.CONTENT_PENDING ||
          quarantine
      ),
      idempotencyKey,
      sync: {
        triggered: syncTriggered,
        retryScheduled: syncRetryScheduled,
        stats: syncResult?.stats || null,
        lastSyncAt: syncResult?.lastSyncAt || null,
      },
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
