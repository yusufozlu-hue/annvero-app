/**
 * Extract embedded JPEG/PNG page images from scanned PDFs (DCTDecode / Flate image XObjects).
 * Fast path — no canvas. Falls back to caller if none found.
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
    if (slice.length > 1024) {
      // Heuristic dims — Vision does not need exact PDF MediaBox for OCR
      out.push({
        page: out.length + 1,
        mimeType: "image/jpeg",
        bytes: slice.slice(),
        width: 1240,
        height: 1754,
      });
    }
    searchFrom = end;
  }

  return out;
}
