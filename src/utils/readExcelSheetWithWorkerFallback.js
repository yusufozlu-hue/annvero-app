import { readSheetRowsFromArrayBuffer } from "@/src/utils/excelBufferUtils";
import { runExcelSheetWorker } from "@/src/utils/workerParserBridge";

export const EXCEL_READ_STAGE = Object.freeze({
  WORKER_LOAD: "EXCEL_WORKER_LOAD",
  WORKER_PARSE: "EXCEL_WORKER_PARSE",
  FALLBACK_PARSE: "EXCEL_FALLBACK_PARSE",
});

const WORKER_LOAD_CODES = new Set([
  "WORKER_ONERROR",
  "WORKER_CONSTRUCT_FAILED",
  "WORKER_UNAVAILABLE",
  "WORKER_MESSAGE_ERROR",
]);

function classifyWorkerFailure(error) {
  if (WORKER_LOAD_CODES.has(error?.code)) {
    return EXCEL_READ_STAGE.WORKER_LOAD;
  }
  return EXCEL_READ_STAGE.WORKER_PARSE;
}

function isArrayBufferReadable(buffer) {
  try {
    return buffer instanceof ArrayBuffer && buffer.byteLength > 0;
  } catch {
    return false;
  }
}

async function resolveFallbackBuffer(file, primaryBuffer) {
  if (isArrayBufferReadable(primaryBuffer)) {
    return primaryBuffer;
  }
  if (file && typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }
  throw Object.assign(new Error("Excel buffer yeniden okunamadı."), {
    code: EXCEL_READ_STAGE.FALLBACK_PARSE,
    stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
  });
}

/**
 * Excel sheet rows: worker-first with main-thread fallback.
 * Worker transfer uses a cloned buffer so the original stays readable on fallback.
 */
export async function readExcelSheetRowsFromFile(
  file,
  {
    workerUrl,
    mode = "rows",
    onProgress,
    timeoutMs = 90_000,
    runWorker = runExcelSheetWorker,
  } = {}
) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw Object.assign(new Error("Geçersiz Excel dosyası."), {
      code: EXCEL_READ_STAGE.FALLBACK_PARSE,
      stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
    });
  }

  let primaryBuffer = await file.arrayBuffer();
  if (!isArrayBufferReadable(primaryBuffer)) {
    primaryBuffer = await resolveFallbackBuffer(file, primaryBuffer);
  }
  if (!isArrayBufferReadable(primaryBuffer)) {
    throw Object.assign(new Error("Excel dosyası boş veya okunamadı."), {
      code: EXCEL_READ_STAGE.FALLBACK_PARSE,
      stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
    });
  }
  let workerStage = null;
  let workerMessage = "";

  if (workerUrl) {
    let workerBuffer;
    try {
      workerBuffer = isArrayBufferReadable(primaryBuffer)
        ? primaryBuffer.slice(0)
        : await file.arrayBuffer();
    } catch {
      workerBuffer = await file.arrayBuffer();
    }

    try {
      const result = await runWorker({
        workerUrl,
        arrayBuffer: workerBuffer,
        mode,
        onProgress,
        timeoutMs,
      });
      if (Array.isArray(result?.rows)) {
        return result.rows;
      }
      workerStage = EXCEL_READ_STAGE.WORKER_PARSE;
      workerMessage = "Worker sonucu satır içermiyor.";
    } catch (error) {
      workerStage = classifyWorkerFailure(error);
      workerMessage = error?.message || String(error);
      if (typeof console !== "undefined") {
        console.debug("[excel-sheet-read]", workerStage, workerMessage);
      }
    }
  }

  let fallbackBuffer;
  try {
    fallbackBuffer = await resolveFallbackBuffer(file, primaryBuffer);
  } catch (error) {
    throw Object.assign(new Error(error?.message || "Excel buffer yeniden okunamadı."), {
      code: EXCEL_READ_STAGE.FALLBACK_PARSE,
      stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
      workerStage,
      workerMessage,
      cause: error,
    });
  }

  try {
    return readSheetRowsFromArrayBuffer(fallbackBuffer);
  } catch (error) {
    throw Object.assign(new Error(error?.message || "Excel okunamadı."), {
      code: EXCEL_READ_STAGE.FALLBACK_PARSE,
      stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
      workerStage,
      workerMessage,
      cause: error,
    });
  }
}
