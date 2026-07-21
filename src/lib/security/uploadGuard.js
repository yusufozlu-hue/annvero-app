/**
 * Dosya yükleme güvenliği — boyut, uzantı, MIME allowlist, magic-byte imza.
 */

import path from "path";

export const DEFAULT_MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MiB

export const ALLOWED_UPLOAD_EXTENSIONS = Object.freeze([
  ".xlsx",
  ".xls",
  ".csv",
  ".pdf",
  ".xml",
  ".json",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

export const ALLOWED_UPLOAD_MIME_TYPES = Object.freeze([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "application/pdf",
  "application/xml",
  "text/xml",
  "application/json",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/octet-stream", // imza ile doğrulanır
]);

const MAGIC_SIGNATURES = [
  { ext: ".pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { ext: ".png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: ".jpg", bytes: [0xff, 0xd8, 0xff] },
  { ext: ".jpeg", bytes: [0xff, 0xd8, 0xff] },
  { ext: ".webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF....WEBP
  { ext: ".xlsx", bytes: [0x50, 0x4b, 0x03, 0x04] }, // zip/xlsx
  { ext: ".xls", bytes: [0xd0, 0xcf, 0x11, 0xe0] }, // OLE
];

export function sanitizeUploadFileName(fileName = "") {
  const base = path.basename(String(fileName || "upload")).replace(/[^\w.\-()+ ]+/g, "_");
  const cleaned = base.replace(/\.\.+/g, ".").slice(0, 180);
  return cleaned || "upload.bin";
}

export function getUploadExtension(fileName = "") {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  return ext;
}

function startsWithBytes(buffer, signature) {
  if (!buffer || buffer.length < signature.length) return false;
  return signature.every((b, i) => buffer[i] === b);
}

export function detectMagicExtension(buffer) {
  /** @type {Uint8Array} */
  let bytes;
  if (buffer instanceof Uint8Array) {
    bytes = buffer;
  } else if (buffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(buffer);
  } else if (buffer && typeof buffer === "object" && Buffer.isBuffer?.(buffer)) {
    bytes = new Uint8Array(buffer);
  } else {
    bytes = new Uint8Array(0);
  }
  for (const sig of MAGIC_SIGNATURES) {
    if (startsWithBytes(bytes, sig.bytes)) {
      if (sig.ext === ".webp") {
        // RIFF....WEBP
        const tag = String.fromCharCode(...bytes.slice(8, 12));
        if (tag !== "WEBP") continue;
      }
      return sig.ext;
    }
  }

  // text-ish
  const sample = Buffer.from(bytes.slice(0, 64)).toString("utf8");
  if (/^\s*[\[{<]/.test(sample) || /^[\x09\x0a\x0d\x20-\x7e]+$/.test(sample)) {
    return ".txt";
  }
  return "";
}

/**
 * @param {{
 *   fileName?: string,
 *   mimeType?: string,
 *   size?: number,
 *   buffer?: Uint8Array | ArrayBuffer | Buffer | null,
 *   maxBytes?: number,
 *   allowedExtensions?: string[],
 *   allowedMimeTypes?: string[],
 * }} [options]
 * @returns {{ ok: boolean, error?: string, safeName?: string, extension?: string }}
 */
export function validateUploadFile({
  fileName = "",
  mimeType = "",
  size = 0,
  buffer = null,
  maxBytes = DEFAULT_MAX_UPLOAD_BYTES,
  allowedExtensions = ALLOWED_UPLOAD_EXTENSIONS,
  allowedMimeTypes = ALLOWED_UPLOAD_MIME_TYPES,
} = {}) {
  if (!fileName) {
    return { ok: false, error: "Dosya adı gerekli." };
  }

  const safeName = sanitizeUploadFileName(fileName);
  if (safeName.includes("..") || safeName.includes("/") || safeName.includes("\\")) {
    return { ok: false, error: "Geçersiz dosya adı." };
  }

  const extension = getUploadExtension(safeName);
  if (!allowedExtensions.includes(extension)) {
    return { ok: false, error: `İzin verilmeyen dosya uzantısı: ${extension || "(yok)"}` };
  }

  const sizeNum = Number(size) || 0;
  if (sizeNum <= 0) {
    return { ok: false, error: "Boş dosya yüklenemez." };
  }
  if (sizeNum > maxBytes) {
    return { ok: false, error: `Dosya boyutu limiti aşıldı (${maxBytes} bayt).` };
  }

  const mime = String(mimeType || "").toLowerCase().trim();
  if (mime && !allowedMimeTypes.includes(mime)) {
    return { ok: false, error: `İzin verilmeyen MIME tipi: ${mime}` };
  }

  if (buffer) {
    const magicExt = detectMagicExtension(buffer);
    if (magicExt) {
      const compatible =
        magicExt === extension ||
        (magicExt === ".jpg" && extension === ".jpeg") ||
        (magicExt === ".jpeg" && extension === ".jpg") ||
        (magicExt === ".txt" && [".csv", ".json", ".xml", ".txt"].includes(extension)) ||
        (magicExt === ".xlsx" && extension === ".xlsx");
      if (!compatible && ![".csv", ".json", ".xml", ".txt"].includes(extension)) {
        return {
          ok: false,
          error: `Dosya imzası uzantı ile uyuşmuyor (beklenen ${extension}, algılanan ${magicExt}).`,
        };
      }
    }
  }

  return { ok: true, safeName, extension };
}

/**
 * Malware tarama adapter arayüzü — harici servis yoksa "not_configured".
 * Yapılmamış taramayı yapılmış gibi göstermez.
 */
export async function scanUploadForMalware(_buffer, { provider = process.env.ANNVERO_MALWARE_SCAN_PROVIDER } = {}) {
  const name = String(provider || "").trim().toLowerCase();
  if (!name) {
    return {
      scanned: false,
      status: "not_configured",
      clean: null,
      provider: null,
      message: "Malware tarama sağlayıcısı yapılandırılmamış.",
    };
  }

  // Adapter noktası — gerçek entegrasyon secret + sağlayıcı gerektirir
  return {
    scanned: false,
    status: "adapter_pending",
    clean: null,
    provider: name,
    message: `Malware tarama adapter'ı (${name}) henüz aktif değil. Kullanıcı aktivasyonu gerekli.`,
  };
}
