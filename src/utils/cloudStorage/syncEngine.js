/**
 * Metadata-first manuel senkronizasyon motoru (V1).
 * PDF içeriği indirilmez; yalnız dosya listesi / hash / yol indekslenir.
 */

import {
  findDuplicateDocument,
  normalizeDocumentIndexRow,
} from "./documentIndex.js";
import { DOCUMENT_PARSE_STATUS } from "./types.js";

/**
 * @param {object} opts
 * @param {string} opts.companyId
 * @param {string} opts.provider
 * @param {Array} opts.remoteFiles — adapter’dan metadata listesi
 * @param {Array} opts.existingIndex
 * @param {string} [opts.now]
 */
export function runMetadataSyncPass({
  companyId,
  provider,
  remoteFiles = [],
  existingIndex = [],
  now = new Date().toISOString(),
} = {}) {
  if (!companyId) throw new Error("companyId zorunlu.");

  const remote = Array.isArray(remoteFiles) ? remoteFiles : [];
  const existing = Array.isArray(existingIndex)
    ? existingIndex.map((r) => ({ ...r }))
    : [];

  const remoteById = new Map(
    remote.map((f) => [String(f.providerFileId), f])
  );

  const created = [];
  const updated = [];
  const skippedDuplicates = [];
  const events = [];

  for (const file of remote) {
    const candidate = {
      companyId,
      providerFileId: String(file.providerFileId),
      fileHash: String(file.fileHash || "").toLowerCase(),
    };

    const dup = findDuplicateDocument(existing, candidate);
    const matched = existing.find(
      (r) =>
        String(r.companyId) === String(companyId) &&
        String(r.providerFileId) === String(file.providerFileId)
    );

    if (matched) {
      const changed =
        matched.fileHash !== candidate.fileHash ||
        matched.fileName !== file.fileName ||
        matched.lastModifiedAt !== (file.lastModifiedAt || null);

      if (!changed) continue;

      Object.assign(
        matched,
        normalizeDocumentIndexRow({
          ...matched,
          ...file,
          companyId,
          provider,
          parseStatus:
            matched.parseStatus === DOCUMENT_PARSE_STATUS.MISSING ||
            matched.parseStatus === DOCUMENT_PARSE_STATUS.SOFT_DELETED
              ? DOCUMENT_PARSE_STATUS.INDEXED
              : matched.parseStatus || DOCUMENT_PARSE_STATUS.INDEXED,
          indexedAt: now,
          updatedAt: now,
        })
      );
      updated.push(matched);
      events.push({
        eventType: "file_updated",
        providerFileId: matched.providerFileId,
        status: "ok",
      });
      continue;
    }

    if (dup && dup.type === "file_hash") {
      skippedDuplicates.push({
        reason: "same_company_hash",
        providerFileId: candidate.providerFileId,
        existingId: dup.existing.id,
      });
      events.push({
        eventType: "duplicate_skipped",
        providerFileId: candidate.providerFileId,
        status: "skipped",
        errorMessage: "same_company_hash",
      });
      continue;
    }

    const row = normalizeDocumentIndexRow({
      ...file,
      id: file.id || `idx_${companyId}_${file.providerFileId}`,
      companyId,
      provider,
      parseStatus: DOCUMENT_PARSE_STATUS.INDEXED,
      indexedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    existing.push(row);
    created.push(row);
    events.push({
      eventType: "file_indexed",
      providerFileId: row.providerFileId,
      status: "ok",
    });
  }

  const missing = [];
  for (const row of existing) {
    if (String(row.companyId) !== String(companyId)) continue;
    if (
      row.parseStatus === DOCUMENT_PARSE_STATUS.SOFT_DELETED ||
      row.parseStatus === DOCUMENT_PARSE_STATUS.MISSING
    ) {
      continue;
    }
    if (!remoteById.has(String(row.providerFileId))) {
      row.parseStatus = DOCUMENT_PARSE_STATUS.MISSING;
      row.updatedAt = now;
      missing.push(row);
      events.push({
        eventType: "file_missing",
        providerFileId: row.providerFileId,
        status: "ok",
      });
    }
  }

  return {
    index: existing,
    created,
    updated,
    missing,
    skippedDuplicates,
    events,
    stats: {
      remoteCount: remote.length,
      created: created.length,
      updated: updated.length,
      missing: missing.length,
      skippedDuplicates: skippedDuplicates.length,
    },
  };
}

/**
 * Soft-delete (bağlantı kaldırma / kullanıcı isteği).
 */
export function softDeleteIndexedFile(index, companyId, providerFileId, now) {
  const ts = now || new Date().toISOString();
  return (index || []).map((row) => {
    if (
      String(row.companyId) === String(companyId) &&
      String(row.providerFileId) === String(providerFileId)
    ) {
      return {
        ...row,
        parseStatus: DOCUMENT_PARSE_STATUS.SOFT_DELETED,
        updatedAt: ts,
      };
    }
    return row;
  });
}
