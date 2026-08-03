/**
 * Banka ekstresi kaynak checkpoint — dosya seçiminde immutable kopya.
 * Firma doğrulama / güvenli yeniden dene input File'a veya stale ref'e bağlı kalmaz.
 * Ham dosya / token / Drive ID loglanmaz veya persist edilmez.
 */

import { buildSourceFileHash } from "@/src/utils/bankCanonicalTransaction";

export const SOURCE_CHECKPOINT_KIND = "bank_statement_source_v1";

/**
 * File/Blob'dan bağımsız, transfer-safe checkpoint üretir.
 * @param {File|Blob} file
 * @param {{ fileName?: string }} [opts]
 */
export async function createBankStatementSourceCheckpoint(file, opts = {}) {
  if (!file) {
    const err = new Error("Kaynak dosya seçilmedi.");
    err.code = "FILE_READ";
    throw err;
  }
  const fileName =
    String(opts.fileName || file.name || "ekstre").trim() || "ekstre";
  const mimeType = String(file.type || "application/octet-stream");
  let raw;
  try {
    raw = await file.arrayBuffer();
  } catch (error) {
    const err = new Error(
      error?.message
        ? `Dosya okunamadı: ${error.message}`
        : "Dosya okunamadı."
    );
    err.code = "FILE_READ";
    throw err;
  }
  if (!raw || raw.byteLength === 0) {
    const err = new Error("Dosya içeriği boş veya okunamadı.");
    err.code = "FILE_READ";
    throw err;
  }
  // Transfer/neutering'den bağımsız saklama kopyası
  const arrayBuffer = raw.slice(0);
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const stableFile = new File([blob], fileName, {
    type: mimeType,
    lastModified:
      typeof file.lastModified === "number" ? file.lastModified : Date.now(),
  });
  const contentHash = buildSourceFileHash(new Uint8Array(arrayBuffer));
  return {
    kind: SOURCE_CHECKPOINT_KIND,
    fileName,
    mimeType,
    byteLength: arrayBuffer.byteLength,
    contentHash: contentHash || "",
    blob,
    /** @type {ArrayBuffer} */
    arrayBuffer,
    /** API / FormData için bağımsız File */
    file: stableFile,
    archived: false,
    /** Drive özeti — fileId/token yok */
    archiveSafeSummary: null,
    createdAt: Date.now(),
  };
}

/** Transfer öncesi her zaman taze dilim — saklanan buffer neuter olmaz. */
export function getCheckpointArrayBuffer(checkpoint) {
  if (!checkpoint) return null;
  if (checkpoint.arrayBuffer?.byteLength > 0) {
    return checkpoint.arrayBuffer.slice(0);
  }
  return null;
}

export async function getCheckpointArrayBufferAsync(checkpoint) {
  const sliced = getCheckpointArrayBuffer(checkpoint);
  if (sliced) return sliced;
  if (checkpoint?.blob) {
    const ab = await checkpoint.blob.arrayBuffer();
    return ab?.byteLength ? ab.slice(0) : ab;
  }
  if (checkpoint?.file) {
    const ab = await checkpoint.file.arrayBuffer();
    return ab?.byteLength ? ab.slice(0) : ab;
  }
  return null;
}

export function getCheckpointFile(checkpoint) {
  if (!checkpoint) return null;
  if (checkpoint.file instanceof File) return checkpoint.file;
  if (checkpoint.blob) {
    return new File([checkpoint.blob], checkpoint.fileName || "ekstre", {
      type: checkpoint.mimeType || "application/octet-stream",
    });
  }
  return null;
}

export function hasUsableSourceCheckpoint(checkpoint) {
  return Boolean(
    checkpoint &&
      (checkpoint.arrayBuffer?.byteLength > 0 ||
        checkpoint.blob ||
        checkpoint.file) &&
      checkpoint.fileName
  );
}

/**
 * Persist/log için güvenli özet — ham bayt / Drive ID yok.
 */
export function toSafeSourceCheckpointMeta(checkpoint) {
  if (!checkpoint) return null;
  return {
    kind: SOURCE_CHECKPOINT_KIND,
    fileName: String(checkpoint.fileName || "").slice(0, 240),
    mimeType: String(checkpoint.mimeType || "").slice(0, 120),
    byteLength: Number(checkpoint.byteLength) || 0,
    contentHash: String(checkpoint.contentHash || "").slice(0, 64),
    archived: Boolean(checkpoint.archived),
    hasArchiveSummary: Boolean(checkpoint.archiveSafeSummary),
  };
}

export function rememberArchiveOnCheckpoint(checkpoint, archiveResult) {
  if (!checkpoint || !archiveResult) return checkpoint;
  const softOk =
    archiveResult.ok ||
    archiveResult.duplicate ||
    archiveResult.skipped ||
    archiveResult.safeSummary?.archived ||
    archiveResult.safeSummary?.duplicate;
  if (!softOk) return checkpoint;
  checkpoint.archived = Boolean(
    archiveResult.safeSummary?.archived ||
      archiveResult.duplicate ||
      archiveResult.code === "ARCHIVED" ||
      archiveResult.code === "DUPLICATE_CONTENT" ||
      archiveResult.code === "REANALYZE_REUSE_ARCHIVE"
  );
  checkpoint.archiveSafeSummary = {
    ok: Boolean(archiveResult.ok ?? true),
    skipped: Boolean(archiveResult.skipped),
    duplicate: Boolean(archiveResult.duplicate),
    code: String(archiveResult.code || "").slice(0, 80),
    message: String(archiveResult.message || "").slice(0, 240),
    safeSummary: {
      archived: Boolean(archiveResult.safeSummary?.archived),
      skipped: Boolean(archiveResult.safeSummary?.skipped),
      duplicate: Boolean(archiveResult.safeSummary?.duplicate),
      // fileId / token asla
    },
  };
  return checkpoint;
}

export function shouldReuseArchiveFromCheckpoint(checkpoint) {
  return Boolean(
    checkpoint?.archiveSafeSummary &&
      (checkpoint.archived ||
        checkpoint.archiveSafeSummary.duplicate ||
        checkpoint.archiveSafeSummary.skipped ||
        checkpoint.archiveSafeSummary.safeSummary?.archived)
  );
}

export function buildArchiveReuseFromCheckpoint(checkpoint) {
  if (!shouldReuseArchiveFromCheckpoint(checkpoint)) return null;
  const prior = checkpoint.archiveSafeSummary;
  return {
    ok: true,
    skipped: true,
    duplicate: Boolean(prior.duplicate || prior.safeSummary?.duplicate),
    code: "CHECKPOINT_REUSE_ARCHIVE",
    message: "Oturum arşivi yeniden kullanıldı; ikinci Drive kopyası yok.",
    safeSummary: {
      archived: Boolean(
        prior.safeSummary?.archived || checkpoint.archived || prior.duplicate
      ),
      skipped: true,
      duplicate: true,
      checkpointReuse: true,
    },
  };
}

/** Açık firma-onay resume: geçmiş idempotency / session dedup engeli yok. */
export function shouldBypassDedupForCompanyApproveResume(
  companyApproveResume = false
) {
  return Boolean(companyApproveResume);
}

export function shouldBypassIdempotencyForCompanyApproveResume(
  companyApproveResume = false
) {
  return Boolean(companyApproveResume);
}

export function clearBankStatementSourceCheckpoint(_checkpoint) {
  return null;
}
