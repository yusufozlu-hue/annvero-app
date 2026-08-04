/**
 * Extract embedded JPEG/PNG page images from scanned PDFs (DCTDecode / Flate image XObjects).
 * Fast path — no canvas. Falls back to caller if none found.
 *
 * Rejects logo/stamp JPEGs that are too small to be statement pages — otherwise OCR
 * Vision sees only a logo and returns OCR_NO_MOVEMENTS for text-layer PDFs.
 */

function asBytes(input) {
  if (!input) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(0);
}

function indexOfBytes(haystack, needle, from = 0) {
  outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Minimum bytes for a plausible A4@~72–150dpi bank scan page (logos are ~10–40KB). */
export const MIN_EMBEDDED_PAGE_BYTES = 80_000;
/** Minimum JPEG SOF edge — logos/stamps are typically &lt; 400px. */
export const MIN_EMBEDDED_EDGE_PX = 600;

/**
 * Read JPEG SOF0/SOF2 dimensions. Returns null if not a valid JPEG SOF.
 */
export function readJpegDimensions(bytes) {
  const buf = asBytes(bytes);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (len < 2 || i + 1 + len >= buf.length) break;
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 (baseline/progressive)
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && len >= 7) {
      const height = (buf[i + 5] << 8) | buf[i + 6];
      const width = (buf[i + 7] << 8) | buf[i + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    i += 2 + len;
  }
  return null;
}

export function isPlausibleEmbeddedPageImage(bytes, { minBytes = MIN_EMBEDDED_PAGE_BYTES, minEdge = MIN_EMBEDDED_EDGE_PX } = {}) {
  const buf = asBytes(bytes);
  if (buf.byteLength < minBytes) return false;
  const dims = readJpegDimensions(buf);
  if (!dims) {
    // Non-JPEG or unreadable SOF — size gate alone (PNG path may add later)
    return buf.byteLength >= minBytes;
  }
  return dims.width >= minEdge && dims.height >= minEdge;
}

/**
 * @returns {Array<{ page: number, mimeType: string, bytes: Uint8Array, width: number, height: number }>}
 */
export function extractEmbeddedRasterPages(bytes, { maxPages = 80 } = {}) {
  const buf = asBytes(bytes);
  if (buf.length < 32) return [];

  const out = [];
  const jpegSOI = new Uint8Array([0xff, 0xd8, 0xff]);
  const jpegEOI = new Uint8Array([0xff, 0xd9]);

  // Prefer DCTDecode JPEG streams bounded by SOI/EOI within the PDF binary.
  let searchFrom = 0;
  while (out.length < maxPages) {
    const soi = indexOfBytes(buf, jpegSOI, searchFrom);
    if (soi < 0) break;
    const eoi = indexOfBytes(buf, jpegEOI, soi + 3);
    if (eoi < 0) break;
    const end = eoi + 2;
    const slice = buf.subarray(soi, end);
    if (isPlausibleEmbeddedPageImage(slice)) {
      const dims = readJpegDimensions(slice) || { width: 1240, height: 1754 };
      out.push({
        page: out.length + 1,
        mimeType: "image/jpeg",
        bytes: slice.slice(),
        width: dims.width,
        height: dims.height,
      });
    }
    searchFrom = end;
  }

  return out;
}
