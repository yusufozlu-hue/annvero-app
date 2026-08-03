/**
 * Banka ekstresi kaynak checkpoint — dosya seçiminde sahipli Uint8Array kopyası.
 * Drive FormData / transfer ArrayBuffer'ı detach etse bile parse/OCR/retry aynı
 * baytlardan devam eder. Ham dosya / token / Drive ID loglanmaz veya persist edilmez.
 */

import { buildSourceFileHash } from "@/src/utils/bankCanonicalTransaction";

export const SOURCE_CHECKPOINT_KIND = "bank_statement_source_v1";

function copyOwnedBytes(raw) {
  if (!raw) return new Uint8Array(0);
  if (raw instanceof Uint8Array) {
    const out = new Uint8Array(raw.byteLength);
    out.set(raw);
    return out;
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw.slice(0));
  }
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    );
  }
  return new Uint8Array(0);
}

/**
 * File/Blob'dan bağımsız, FormData-safe checkpoint üretir.
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
  // Sahipli kopya — FormData/worker transfer bu baytları detach edemez
  const uint8Bytes = copyOwnedBytes(raw);
  const contentHash = buildSourceFileHash(uint8Bytes);
  return {
    kind: SOURCE_CHECKPOINT_KIND,
    fileName,
    mimeType,
    byteLength: uint8Bytes.byteLength,
    contentHash: contentHash || "",
    /** @type {Uint8Array} birincil kaynak — FormData tüketimine dayanıklı */
    uint8Bytes,
    archived: false,
    /** Drive özeti — fileId/token yok */
    archiveSafeSummary: null,
    createdAt: Date.now(),
  };
}

export function getCheckpointBlob(checkpoint) {
  const bytes = resolveOwnedBytes(checkpoint);
  if (!bytes?.byteLength) return null;
  return new Blob([copyOwnedBytes(bytes)], {
    type: checkpoint.mimeType || "application/octet-stream",
  });
}

function resolveOwnedBytes(checkpoint) {
  if (checkpoint?.uint8Bytes?.byteLength > 0) {
    return checkpoint.uint8Bytes;
  }
  // Eski checkpoint: doğrudan arrayBuffer alanı (getter değil)
  if (
    checkpoint &&
    Object.prototype.hasOwnProperty.call(checkpoint, "arrayBuffer") &&
    checkpoint.arrayBuffer instanceof ArrayBuffer &&
    checkpoint.arrayBuffer.byteLength > 0
  ) {
    return new Uint8Array(checkpoint.arrayBuffer);
  }
  return null;
}

/** Transfer öncesi her zaman taze dilim — saklanan uint8Bytes neuter olmaz. */
export function getCheckpointArrayBuffer(checkpoint) {
  const bytes = resolveOwnedBytes(checkpoint);
  if (!bytes?.byteLength) return null;
  return copyOwnedBytes(bytes).buffer;
}

export async function getCheckpointArrayBufferAsync(checkpoint) {
  const sliced = getCheckpointArrayBuffer(checkpoint);
  if (sliced?.byteLength) return sliced;
  // Son çare: eski blob/file alanları (test fixture)
  if (checkpoint?.blob && typeof checkpoint.blob.arrayBuffer === "function") {
    try {
      const ab = await checkpoint.blob.arrayBuffer();
      return ab?.byteLength ? ab.slice(0) : null;
    } catch {
      return null;
    }
  }
  if (checkpoint?.file && typeof checkpoint.file.arrayBuffer === "function") {
    try {
      const ab = await checkpoint.file.arrayBuffer();
      return ab?.byteLength ? ab.slice(0) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Her çağrıda yeni File — FormData upload önceki File'ı tüketse bile
 * sonraki parse/OCR taze kopya alır.
 */
export function getCheckpointFile(checkpoint) {
  if (!checkpoint) return null;
  const bytes = resolveOwnedBytes(checkpoint);
  if (bytes?.byteLength) {
    return new File([copyOwnedBytes(bytes)], checkpoint.fileName || "ekstre", {
      type: checkpoint.mimeType || "application/octet-stream",
      lastModified: checkpoint.createdAt || Date.now(),
    });
  }
  return null;
}

export function hasUsableSourceCheckpoint(checkpoint) {
  if (!checkpoint?.fileName) return false;
  if (resolveOwnedBytes(checkpoint)?.byteLength > 0) return true;
  if (Number(checkpoint.byteLength) > 0 && checkpoint.uint8Bytes) return true;
  return false;
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
      archiveResult.code === "REANALYZE_REUSE_ARCHIVE" ||
      archiveResult.code === "CHECKPOINT_REUSE_ARCHIVE"
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

/**
 * Simüle FormData tüketimi — upload sonrası File boşalsa bile
 * sahipli uint8Bytes okunabilir kalmalı.
 */
export async function assertCheckpointSurvivesFormDataConsume(checkpoint) {
  const before = resolveOwnedBytes(checkpoint)?.byteLength || 0;
  if (before <= 0) {
    const err = new Error("checkpoint empty before consume");
    err.code = "FILE_READ";
    throw err;
  }
  const disposable = getCheckpointFile(checkpoint);
  if (!disposable?.size) {
    const err = new Error("disposable file empty");
    err.code = "FILE_READ";
    throw err;
  }
  const form = new FormData();
  form.set("file", disposable, disposable.name || "ekstre");
  const ab = await disposable.arrayBuffer();
  if (typeof ab.transfer === "function") {
    try {
      ab.transfer(ab.byteLength);
    } catch {
      /* ignore */
    }
  }
  const after = await getCheckpointArrayBufferAsync(checkpoint);
  if (after?.byteLength !== before) {
    const err = new Error("checkpoint bytes lost after FormData");
    err.code = "FILE_READ";
    throw err;
  }
  const again = getCheckpointFile(checkpoint);
  if (again?.size !== before) {
    const err = new Error("fresh file size mismatch");
    err.code = "FILE_READ";
    throw err;
  }
  return true;
}

export function clearBankStatementSourceCheckpoint() {
  return null;
}

/** PDF erken cache: boş dizi usable sayılmaz. */
export function hasParsedPdfRows(rows) {
  return Array.isArray(rows) && rows.length > 0;
}
