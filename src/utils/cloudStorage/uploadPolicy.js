/**
 * Google Drive V1 yükleme politikası (istemci + sunucu paylaşır).
 * Secret içermez. Vercel request gövdesi ~4.5 MiB — V1 sınırı bunun altında.
 */

import {
  ANNVERO_SYSTEM_FOLDER,
  buildCompanyFolderPathList,
  FOLDER_STRUCTURE_VERSION,
} from "./folderSchema.js";

/** Vercel serverless request limiti (~4.5 MiB) altında güvenli tavan */
export const DRIVE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const DRIVE_UPLOAD_MAX_LABEL = "4 MB";
export const DRIVE_UPLOAD_SCHEMA_VERSION = FOLDER_STRUCTURE_VERSION;

const EXT_MIME = Object.freeze({
  ".pdf": Object.freeze(["application/pdf"]),
  ".xls": Object.freeze(["application/vnd.ms-excel", "application/excel"]),
  ".xlsx": Object.freeze([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  ".xml": Object.freeze(["application/xml", "text/xml"]),
  ".png": Object.freeze(["image/png"]),
  ".jpg": Object.freeze(["image/jpeg"]),
  ".jpeg": Object.freeze(["image/jpeg"]),
});

export const DRIVE_UPLOAD_ACCEPT =
  ".pdf,.xls,.xlsx,.xml,.png,.jpg,.jpeg,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/xml,text/xml,image/png,image/jpeg";

export const DRIVE_UPLOAD_ACCEPT_HINT =
  "PDF, Excel (XLS/XLSX), XML, PNG, JPG — en fazla 4 MB";

export const DRIVE_UPLOAD_DEFAULT_FOLDER = "98 - Diğer Evraklar";

function normalizePath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

/**
 * Schema v1 izinli yükleme hedefleri — `_ANNVERO` ve altı hariç.
 */
export function buildUploadTargetPathList() {
  return buildCompanyFolderPathList().filter((path) => {
    const normalized = normalizePath(path);
    if (!normalized) return false;
    if (normalized === ANNVERO_SYSTEM_FOLDER) return false;
    if (normalized.startsWith(`${ANNVERO_SYSTEM_FOLDER}/`)) return false;
    return true;
  });
}

export function isAllowedUploadTargetPath(targetFolderPath) {
  const normalized = normalizePath(targetFolderPath);
  if (!normalized) return false;
  if (
    normalized === ANNVERO_SYSTEM_FOLDER ||
    normalized.startsWith(`${ANNVERO_SYSTEM_FOLDER}/`)
  ) {
    return false;
  }
  return buildUploadTargetPathList().includes(normalized);
}

export function getFileExtension(fileName) {
  const base = String(fileName || "").split(/[/\\]/).pop() || "";
  const idx = base.lastIndexOf(".");
  if (idx <= 0 || idx === base.length - 1) return "";
  return base.slice(idx).toLowerCase();
}

/**
 * Dosya adı güvenliği: yol parçalarını temizler, uzantıyı korur.
 */
export function sanitizeUploadFileName(fileName) {
  const raw = String(fileName || "").split(/[/\\]/).pop() || "";
  const ext = getFileExtension(raw);
  let stem = ext ? raw.slice(0, -ext.length) : raw;
  stem = stem
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s._()-]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.]+/, "");
  if (!stem) stem = "evrak";
  const maxStem = 160 - ext.length;
  if (stem.length > maxStem) stem = stem.slice(0, maxStem).trim();
  return `${stem}${ext}`;
}

/**
 * Görünür Drive adı: `<orijinal>__YYYY-MM-DD_HHmmss.<ext>`
 * Orijinal ad metadata'da ayrı tutulur; mevcut dosyalar toplu yeniden adlandırılmaz.
 * @param {string} originalFileName
 * @param {Date|number|string} [when]
 * @returns {{ driveFileName: string, originalFileName: string, stampedAt: string }}
 */
export function buildDatedArchiveFileName(originalFileName, when = new Date()) {
  const safeOriginal = sanitizeUploadFileName(originalFileName || "evrak");
  const ext = getFileExtension(safeOriginal);
  const stem = ext ? safeOriginal.slice(0, -ext.length) : safeOriginal;
  const d = when instanceof Date ? when : new Date(when);
  const safeDate = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${safeDate.getFullYear()}-${pad(safeDate.getMonth() + 1)}-${pad(safeDate.getDate())}_${pad(safeDate.getHours())}${pad(safeDate.getMinutes())}${pad(safeDate.getSeconds())}`;
  const maxStem = Math.max(20, 160 - ext.length - stamp.length - 2);
  const clipped = stem.length > maxStem ? stem.slice(0, maxStem).trim() : stem;
  return {
    driveFileName: `${clipped || "evrak"}__${stamp}${ext}`,
    originalFileName: safeOriginal,
    stampedAt: safeDate.toISOString(),
  };
}

/**
 * Uzantı + MIME birlikte doğrulanır.
 * @returns {{ ok: true, ext: string, mimeType: string } | { ok: false, code: string, message: string }}
 */
export function validateUploadFileType({ fileName, mimeType }) {
  const ext = getFileExtension(fileName);
  const allowed = EXT_MIME[ext];
  if (!allowed) {
    return {
      ok: false,
      code: "UNSUPPORTED_FILE_TYPE",
      message: "Desteklenmeyen dosya türü. PDF, Excel, XML veya görsel yükleyin.",
    };
  }
  const declared = String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  // Tarayıcı boş/octet-stream gönderebilir — uzantıya güven, MIME varsa eşleşmeli.
  if (
    declared &&
    declared !== "application/octet-stream" &&
    !allowed.includes(declared)
  ) {
    return {
      ok: false,
      code: "MIME_EXTENSION_MISMATCH",
      message: "Dosya uzantısı ile içerik türü uyuşmuyor.",
    };
  }
  return { ok: true, ext, mimeType: allowed[0] };
}

/**
 * Boyut / boş dosya kontrolleri.
 */
export function validateUploadFileSize(byteLength) {
  const size = Number(byteLength);
  if (!Number.isFinite(size) || size <= 0) {
    return {
      ok: false,
      code: "EMPTY_FILE",
      message: "Boş dosya yüklenemez.",
      status: 400,
    };
  }
  if (size > DRIVE_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      code: "PAYLOAD_TOO_LARGE",
      message: `Dosya çok büyük. En fazla ${DRIVE_UPLOAD_MAX_LABEL} yükleyebilirsiniz.`,
      status: 413,
    };
  }
  return { ok: true, size };
}

export function assertUploadTargetPath(targetFolderPath) {
  const normalized = normalizePath(targetFolderPath);
  if (
    normalized === ANNVERO_SYSTEM_FOLDER ||
    normalized.startsWith(`${ANNVERO_SYSTEM_FOLDER}/`)
  ) {
    return {
      ok: false,
      code: "SYSTEM_FOLDER_FORBIDDEN",
      message: "Sistem klasörüne (_ANNVERO) dosya yüklenemez.",
    };
  }
  if (!isAllowedUploadTargetPath(normalized)) {
    return {
      ok: false,
      code: "INVALID_TARGET_PATH",
      message: "Hedef klasör şema v2 izinli yollarından biri değil.",
    };
  }
  return { ok: true, path: normalized };
}
