/**
 * Belge indeksi — mükerrer anahtarlar ve satır normalizasyonu.
 * company_id + provider_file_id
 * company_id + file_hash
 */

import { CLOUD_PROVIDER, DOCUMENT_PARSE_STATUS } from "./types.js";
import { parseStandardDocumentFileName } from "./fileNaming.js";

export function buildProviderFileKey(companyId, providerFileId) {
  return `${String(companyId)}::${String(providerFileId)}`;
}

export function buildHashKey(companyId, fileHash) {
  return `${String(companyId)}::${String(fileHash || "").toLowerCase()}`;
}

/**
 * Aynı firmada mükerrer mi?
 * @param {Array<{companyId, providerFileId, fileHash, parseStatus?}>} existing
 * @param {{companyId, providerFileId, fileHash}} candidate
 */
export function findDuplicateDocument(existing, candidate) {
  const companyId = String(candidate.companyId || "");
  const providerFileId = String(candidate.providerFileId || "");
  const fileHash = String(candidate.fileHash || "").toLowerCase();
  const rows = Array.isArray(existing) ? existing : [];

  const byProvider = rows.find(
    (r) =>
      String(r.companyId) === companyId &&
      String(r.providerFileId) === providerFileId &&
      r.parseStatus !== DOCUMENT_PARSE_STATUS.SOFT_DELETED
  );
  if (byProvider) {
    return { type: "provider_file_id", existing: byProvider };
  }

  if (fileHash) {
    const byHash = rows.find(
      (r) =>
        String(r.companyId) === companyId &&
        String(r.fileHash || "").toLowerCase() === fileHash &&
        r.parseStatus !== DOCUMENT_PARSE_STATUS.SOFT_DELETED
    );
    if (byHash) {
      return { type: "file_hash", existing: byHash };
    }
  }

  return null;
}

/**
 * Hash aynı, firma farklı → mükerrer DEĞİL.
 */
export function isCrossCompanySameHashAllowed(existing, candidate) {
  const fileHash = String(candidate.fileHash || "").toLowerCase();
  if (!fileHash) return true;
  const other = (existing || []).find(
    (r) =>
      String(r.companyId) !== String(candidate.companyId) &&
      String(r.fileHash || "").toLowerCase() === fileHash
  );
  return Boolean(other) || true;
}

export function normalizeDocumentIndexRow(input = {}) {
  const fileName = String(input.fileName || "");
  const parsed = parseStandardDocumentFileName(fileName);
  return {
    id: input.id || "",
    companyId: String(input.companyId || ""),
    provider: input.provider || CLOUD_PROVIDER.GOOGLE_DRIVE,
    providerFileId: String(input.providerFileId || ""),
    parentFolderId: String(input.parentFolderId || ""),
    fileName,
    mimeType: String(input.mimeType || "application/pdf"),
    fileSize: Number(input.fileSize) || 0,
    fileHash: String(input.fileHash || "").toLowerCase(),
    documentCategory:
      input.documentCategory || parsed?.documentCategory || "diger",
    documentType: input.documentType || parsed?.kind || "",
    periodKey: input.periodKey || parsed?.periodKey || "",
    revisionNo: Number(input.revisionNo ?? parsed?.revisionNo) || 0,
    sourcePath: String(input.sourcePath || ""),
    parseStatus: input.parseStatus || DOCUMENT_PARSE_STATUS.INDEXED,
    parserVersion: input.parserVersion || null,
    normalizedRecordId: input.normalizedRecordId || null,
    lastModifiedAt: input.lastModifiedAt || null,
    indexedAt: input.indexedAt || new Date().toISOString(),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}
