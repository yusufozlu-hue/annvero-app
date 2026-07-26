/**
 * document_index → istemciye güvenli liste DTO’su.
 * Token / Drive file ID / hash sızdırmaz.
 */

import { ANNVERO_SYSTEM_FOLDER, DOCUMENT_PARSE_STATUS } from "./types.js";

/** Varsayılan Evraklar görünümü: aktif belgeler (eksik/soft-deleted hariç). */
export const DEFAULT_LIST_PARSE_STATUSES = Object.freeze([
  DOCUMENT_PARSE_STATUS.INDEXED,
  DOCUMENT_PARSE_STATUS.PENDING,
]);

export const DOCUMENT_STATUS_LABELS = Object.freeze({
  [DOCUMENT_PARSE_STATUS.PENDING]: "Bekliyor",
  [DOCUMENT_PARSE_STATUS.INDEXED]: "Aktif",
  [DOCUMENT_PARSE_STATUS.MISSING]: "Drive’da yok",
  [DOCUMENT_PARSE_STATUS.SOFT_DELETED]: "Silindi",
  [DOCUMENT_PARSE_STATUS.ERROR]: "Hata",
});

export const PROVIDER_LABELS = Object.freeze({
  google_drive: "Google Drive",
});

/**
 * `_ANNVERO` altı veya sistem dosyası mı?
 */
export function isAnnveroSystemDocument(row = {}) {
  const sourcePath = String(row.sourcePath || row.source_path || "").trim();
  const fileName = String(row.fileName || row.file_name || "").trim();
  if (
    sourcePath === ANNVERO_SYSTEM_FOLDER ||
    sourcePath.startsWith(`${ANNVERO_SYSTEM_FOLDER}/`)
  ) {
    return true;
  }
  if (fileName === "metadata.json" || fileName === "ANNVERO_SYSTEM.txt") {
    return true;
  }
  if (fileName === ANNVERO_SYSTEM_FOLDER) return true;
  return false;
}

/**
 * Firma listesi filtresi — yalnız seçili companyId + durum + sistem dışı.
 */
export function filterDocumentsForCompanyList(
  rows = [],
  {
    companyId,
    statuses = DEFAULT_LIST_PARSE_STATUSES,
    includeMissing = false,
  } = {}
) {
  const wanted = new Set(
    includeMissing
      ? [...statuses, DOCUMENT_PARSE_STATUS.MISSING]
      : statuses
  );
  const cid = String(companyId || "");
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (cid && String(row.companyId || row.company_id || "") !== cid) {
      return false;
    }
    if (isAnnveroSystemDocument(row)) return false;
    const status = row.parseStatus || row.parse_status || "";
    if (status === DOCUMENT_PARSE_STATUS.SOFT_DELETED) return false;
    return wanted.has(status);
  });
}

export function fileTypeLabelFromMime(mimeType = "", fileName = "") {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".csv")
  ) {
    return "Excel";
  }
  if (mime.includes("xml") || name.endsWith(".xml")) return "XML";
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) {
    return "Görsel";
  }
  if (mime) return mime.split("/").pop() || "Dosya";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return ext ? ext.toUpperCase() : "Dosya";
}

export function folderPathFromDocument(row = {}) {
  const sourcePath = String(row.sourcePath || row.source_path || "").trim();
  const fileName = String(row.fileName || row.file_name || "").trim();
  if (!sourcePath) return "—";
  if (fileName && sourcePath.endsWith(`/${fileName}`)) {
    const folder = sourcePath.slice(0, -(fileName.length + 1));
    return folder || "—";
  }
  if (sourcePath === fileName) return "—";
  return sourcePath;
}

/**
 * Open URL — opaque document_index id; teknik Drive ID yok.
 */
export function buildDocumentOpenPath(documentId, companyId) {
  const id = encodeURIComponent(String(documentId || ""));
  const cid = encodeURIComponent(String(companyId || ""));
  return `/api/google-drive/files/${id}/open?companyId=${cid}`;
}

/**
 * İstemciye gidecek satır — providerFileId / hash / parentFolderId yok.
 */
export function toPublicDocumentListItem(row = {}, { companyId, lastSyncAt } = {}) {
  const id = String(row.id || "");
  const cid = String(companyId || row.companyId || row.company_id || "");
  const fileName = String(row.fileName || row.file_name || "");
  const mimeType = String(row.mimeType || row.mime_type || "");
  const parseStatus = String(row.parseStatus || row.parse_status || "");
  const provider = String(row.provider || "google_drive");
  return {
    id,
    fileName,
    fileType: fileTypeLabelFromMime(mimeType, fileName),
    mimeType: mimeType || null,
    folderPath: folderPathFromDocument(row),
    source: PROVIDER_LABELS[provider] || "Google Drive",
    provider,
    status: parseStatus,
    statusLabel: DOCUMENT_STATUS_LABELS[parseStatus] || parseStatus || "—",
    lastSyncAt: lastSyncAt || row.indexedAt || row.indexed_at || null,
    indexedAt: row.indexedAt || row.indexed_at || null,
    openPath: id && cid ? buildDocumentOpenPath(id, cid) : null,
  };
}

export function buildPublicDocumentList(rows, options = {}) {
  const filtered = filterDocumentsForCompanyList(rows, options);
  return filtered.map((row) => toPublicDocumentListItem(row, options));
}
