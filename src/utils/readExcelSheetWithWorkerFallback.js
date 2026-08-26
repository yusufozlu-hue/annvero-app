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
  "WORKER_POSTMESSAGE_FAILED",
]);

function classifyWorkerFailure(error) {
  if (WORKER_LOAD_CODES.has(error?.code)) {
    return EXCEL_READ_STAGE.WORKER_LOAD;
  }
  return EXCEL_READ_STAGE.WORKER_PARSE;
}

function resolveWorkerUrl(workerUrl) {
  if (!workerUrl) return "";
  if (typeof workerUrl === "object" && typeof workerUrl.href === "string") {
    return workerUrl.href;
  }
  return String(workerUrl);
}

function isArrayBufferReadable(buffer) {
  try {
    return buffer instanceof ArrayBuffer && buffer.byteLength > 0;
  } catch {
    return false;
  }
}

async function readFreshFileBuffer(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw Object.assign(new Error("Geçersiz Excel dosyası."), {
      code: EXCEL_READ_STAGE.FALLBACK_PARSE,
      stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
    });
  }
  const buffer = await file.arrayBuffer();
  if (!isArrayBufferReadable(buffer)) {
    throw Object.assign(new Error("Excel dosyası boş veya okunamadı."), {
      code: EXCEL_READ_STAGE.FALLBACK_PARSE,
      stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
    });
  }
  return buffer;
}

/**
 * Excel sheet rows: worker-first with main-thread fallback.
 * Worker uses structured-clone copy (no transfer) so fallback can always re-read File.
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
  const resolvedWorkerUrl = resolveWorkerUrl(workerUrl);
  let workerStage = null;
  let workerMessage = "";

  if (resolvedWorkerUrl) {
    try {
      const workerBuffer = await readFreshFileBuffer(file);
      const result = await runWorker({
        workerUrl: resolvedWorkerUrl,
        arrayBuffer: workerBuffer,
        mode,
        onProgress,
        timeoutMs,
        transferArrayBuffer: false,
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

  try {
    const fallbackBuffer = await readFreshFileBuffer(file);
    return readSheetRowsFromArrayBuffer(fallbackBuffer);
  } catch (error) {
    throw Object.assign(new Error(error?.message || "Excel okunamadı."), {
      code: error?.code || EXCEL_READ_STAGE.FALLBACK_PARSE,
      stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
      workerStage,
      workerMessage,
      cause: error,
    });
  }
}
