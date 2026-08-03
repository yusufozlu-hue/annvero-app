/**
 * Scanned PDF → PNG pages (in-process). No GCS.
 * Ham PDF / OCR metni loglanmaz.
 */

import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { OCR_POLICY, OCR_SAFE_MESSAGES } from "@/src/utils/bankOcr/ocrPolicy.js";
import { extractEmbeddedRasterPages } from "@/src/utils/bankOcr/extractEmbeddedRasterPages.js";

const TARGET_DPI = 150;
const PDF_USER_UNIT_DPI = 72;

function asBytes(input) {
  if (!input) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (typeof ArrayBuffer !== "undefined" && input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(0);
}

function ocrError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function clampScaleForPixels(baseScale, widthPt, heightPt) {
  let scale = baseScale;
  const maxPx = OCR_POLICY.MAX_PIXELS_PER_PAGE;
  for (let i = 0; i < 8; i += 1) {
    const w = Math.ceil(widthPt * scale);
    const h = Math.ceil(heightPt * scale);
    if (w * h <= maxPx && w >= OCR_POLICY.MIN_EDGE_PX && h >= OCR_POLICY.MIN_EDGE_PX) {
      return { scale, width: w, height: h };
    }
    if (w * h > maxPx) {
      scale *= Math.sqrt(maxPx / (w * h)) * 0.98;
    } else {
      break;
    }
  }
  const width = Math.max(1, Math.ceil(widthPt * scale));
  const height = Math.max(1, Math.ceil(heightPt * scale));
  if (width * height > maxPx) {
    throw ocrError("OCR_PIXEL_BOMB", OCR_SAFE_MESSAGES.OCR_PIXEL_BOMB);
  }
  if (width < OCR_POLICY.MIN_EDGE_PX || height < OCR_POLICY.MIN_EDGE_PX) {
    throw ocrError("OCR_LOW_RESOLUTION", OCR_SAFE_MESSAGES.OCR_LOW_RESOLUTION);
  }
  return { scale, width, height };
}

/**
 * @param {Uint8Array|ArrayBuffer|Buffer} bytes
 * @param {{ pageCount?: number, signal?: AbortSignal, onProgress?: Function }} [options]
 * @returns {Promise<Array<{ page: number, mimeType: string, bytes: Uint8Array, width: number, height: number }>>}
 */
export async function rasterizePdfPages(bytes, options = {}) {
  const buf = asBytes(bytes);
  if (!buf.length) {
    throw ocrError("OCR_INVALID_DOCUMENT", OCR_SAFE_MESSAGES.OCR_CORRUPT);
  }
  if (buf.byteLength > OCR_POLICY.MAX_BYTES) {
    throw ocrError("OCR_TOO_LARGE", OCR_SAFE_MESSAGES.OCR_TOO_LARGE);
  }

  const signal = options.signal;
  if (signal?.aborted) {
    throw ocrError("OCR_CANCELLED", OCR_SAFE_MESSAGES.OCR_CANCELLED);
  }

  // Fast path: scanned bank PDFs often embed one JPEG per page.
  const embedded = extractEmbeddedRasterPages(buf, {
    maxPages: Math.min(
      OCR_POLICY.MAX_PAGES,
      Math.max(1, Number(options.pageCount) || OCR_POLICY.MAX_PAGES)
    ),
  });
  if (embedded.length) {
    options.onProgress?.({
      status: "ocr_preparing",
      detail: "Gömülü tarama görselleri",
      percent: 12,
      page: 0,
      pageCount: embedded.length,
    });
    return embedded;
  }

  let pdf;
  try {
    const task = getDocument({
      data: buf.slice(),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0,
    });
    pdf = await task.promise;
  } catch {
    throw ocrError("OCR_INVALID_DOCUMENT", OCR_SAFE_MESSAGES.OCR_CORRUPT);
  }

  const total = Math.min(
    Number(pdf.numPages) || 0,
    OCR_POLICY.MAX_PAGES,
    Math.max(1, Number(options.pageCount) || Number(pdf.numPages) || 1)
  );
  if (!total) {
    throw ocrError("OCR_INVALID_DOCUMENT", OCR_SAFE_MESSAGES.OCR_CORRUPT);
  }
  if ((Number(pdf.numPages) || 0) > OCR_POLICY.MAX_PAGES) {
    throw ocrError("OCR_TOO_MANY_PAGES", OCR_SAFE_MESSAGES.OCR_TOO_MANY_PAGES);
  }

  const out = [];
  const baseScale = TARGET_DPI / PDF_USER_UNIT_DPI;

  try {
    for (let pageNo = 1; pageNo <= total; pageNo += 1) {
      if (signal?.aborted) {
        throw ocrError("OCR_CANCELLED", OCR_SAFE_MESSAGES.OCR_CANCELLED);
      }
      options.onProgress?.({
        status: "ocr_preparing",
        detail: `Sayfa ${pageNo}/${total} rasterize`,
        percent: Math.round(((pageNo - 1) / total) * 20) + 4,
        page: pageNo,
        pageCount: total,
      });

      const page = await pdf.getPage(pageNo);
      const unscaled = page.getViewport({ scale: 1 });
      const { scale, width, height } = clampScaleForPixels(
        baseScale,
        unscaled.width,
        unscaled.height
      );
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
      });

      const pageTimeout = new Promise((_, reject) => {
        const t = setTimeout(() => {
          try {
            renderTask.cancel?.();
          } catch {
            /* ignore */
          }
          reject(ocrError("OCR_PROVIDER_TIMEOUT", OCR_SAFE_MESSAGES.OCR_TIMEOUT));
        }, OCR_POLICY.PAGE_TIMEOUT_MS);
        signal?.addEventListener?.(
          "abort",
          () => {
            clearTimeout(t);
            try {
              renderTask.cancel?.();
            } catch {
              /* ignore */
            }
            reject(ocrError("OCR_CANCELLED", OCR_SAFE_MESSAGES.OCR_CANCELLED));
          },
          { once: true }
        );
      });

      try {
        await Promise.race([renderTask.promise, pageTimeout]);
      } catch (error) {
        if (error?.code) throw error;
        throw ocrError("OCR_INVALID_DOCUMENT", OCR_SAFE_MESSAGES.OCR_CORRUPT);
      }

      const png = canvas.toBuffer("image/png");
      if (!png?.length) {
        throw ocrError("OCR_INVALID_DOCUMENT", OCR_SAFE_MESSAGES.OCR_CORRUPT);
      }
      out.push({
        page: pageNo,
        mimeType: "image/png",
        bytes: new Uint8Array(png),
        width,
        height,
      });
    }
  } finally {
    try {
      await pdf.destroy?.();
    } catch {
      /* ignore */
    }
  }

  return out;
}
