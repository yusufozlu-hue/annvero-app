import { readSheetRowsFromArrayBuffer } from "@/src/utils/excelBufferUtils";
import { runExcelSheetWorker } from "@/src/utils/workerParserBridge";

export const EXCEL_READ_STAGE = Object.freeze({
  WORKER_LOAD: "EXCEL_WORKER_LOAD",
  WORKER_PARSE: "EXCEL_WORKER_PARSE",
  FALLBACK_PARSE: "EXCEL_FALLBACK_PARSE",
  CANCELLED: "EXCEL_CANCELLED",
  STALE: "EXCEL_STALE",
});

export const EXCEL_READ_STATUS = Object.freeze({
  WORKER: "worker",
  FALLBACK: "fallback",
  MAIN_THREAD_TEST: "main-thread-test",
});

const INFRASTRUCTURE_FALLBACK_CODES = new Set([
  "WORKER_ONERROR",
  "WORKER_CONSTRUCT_FAILED",
  "WORKER_UNAVAILABLE",
  "WORKER_MESSAGE_ERROR",
  "WORKER_POSTMESSAGE_FAILED",
  "WORKER_SCRIPT_HTML",
  "WORKER_SCRIPT_INVALID",
  "WORKER_SCRIPT_FETCH_FAILED",
  "WORKER_PROTOCOL_ERROR",
  "WORKER_CLONE_FAILED",
]);

export const excelReadRuntimeStats = {
  workerAttempts: 0,
  workerSuccess: 0,
  fallbackAttempts: 0,
  fallbackSuccess: 0,
  mainThreadParses: 0,
};

export function resetExcelReadRuntimeStats() {
  for (const key of Object.keys(excelReadRuntimeStats)) {
    excelReadRuntimeStats[key] = 0;
  }
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

function cloneBufferForFallback(buffer) {
  try {
    const clone = buffer.slice(0);
    if (!isArrayBufferReadable(clone)) throw new Error("empty clone");
    return clone;
  } catch {
    throw Object.assign(new Error("Excel yedek tamponu hazırlanamadı."), {
      code: "WORKER_CLONE_FAILED",
      stage: EXCEL_READ_STAGE.WORKER_LOAD,
    });
  }
}

function cancellationFromSignal(signal) {
  if (!signal?.aborted) return null;
  return Object.assign(new Error("Excel okuma iptal edildi."), {
    code: EXCEL_READ_STAGE.CANCELLED,
    stage: EXCEL_READ_STAGE.CANCELLED,
    status: "cancelled",
  });
}

function resultShape(rows, status, metadata = {}) {
  return {
    rows,
    status,
    metadata: {
      rowCount: rows.length,
      columnCount: rows.reduce(
        (max, row) =>
          Math.max(
            max,
            Array.isArray(row) ? row.length : Object.keys(row || {}).length
          ),
        0
      ),
      ...metadata,
    },
  };
}

/**
 * Excel workbook open + sheet extraction is worker-first. The original buffer
 * is transferred exactly once after a fallback clone is prepared. Only
 * infrastructure failures may consume the one main-thread fallback.
 */
export async function readExcelSheetRowsFromFile(
  file,
  {
    workerUrl,
    mode = "rows",
    onProgress,
    timeoutMs = 90_000,
    runWorker = runExcelSheetWorker,
    preferWorker = true,
    includeMetadata = false,
    requestId,
    generation = 0,
    fileKind = "excel",
    scopeId = "excel",
    signal,
    WorkerImpl,
  } = {}
) {
  const resolvedWorkerUrl = resolveWorkerUrl(workerUrl);
  const cancelled = cancellationFromSignal(signal);
  if (cancelled) throw cancelled;

  if (!preferWorker || !resolvedWorkerUrl) {
    try {
      const buffer = await readFreshFileBuffer(file);
      const rows = readSheetRowsFromArrayBuffer(buffer);
      excelReadRuntimeStats.mainThreadParses += 1;
      const result = resultShape(rows, EXCEL_READ_STATUS.MAIN_THREAD_TEST);
      return includeMetadata ? result : result.rows;
    } catch (error) {
      throw Object.assign(new Error(error?.message || "Excel okunamadı."), {
        code: error?.code || EXCEL_READ_STAGE.FALLBACK_PARSE,
        stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
        cause: error,
      });
    }
  }

  const workerBuffer = await readFreshFileBuffer(file);
  const fallbackBuffer = cloneBufferForFallback(workerBuffer);
  excelReadRuntimeStats.workerAttempts += 1;
  try {
    const result = await runWorker({
      workerUrl: resolvedWorkerUrl,
      arrayBuffer: workerBuffer,
      mode,
      onProgress,
      timeoutMs,
      transferArrayBuffer: true,
      requestId,
      generation,
      fileKind,
      scopeId,
      signal,
      WorkerImpl,
    });
    if (Array.isArray(result?.rows)) {
      excelReadRuntimeStats.workerSuccess += 1;
      const output = resultShape(
        result.rows,
        EXCEL_READ_STATUS.WORKER,
        result.metadata || {}
      );
      return includeMetadata ? output : output.rows;
    }
    throw Object.assign(new Error("Worker sonucu satır içermiyor."), {
      code: "WORKER_PROTOCOL_ERROR",
    });
  } catch (error) {
    const signalError = cancellationFromSignal(signal);
    if (signalError) throw signalError;
    if (
      error?.code === "WORKER_CANCELLED" ||
      error?.code === "WORKER_STALE" ||
      error?.code === "WORKER_TIMEOUT"
    ) {
      throw error;
    }
    if (!INFRASTRUCTURE_FALLBACK_CODES.has(error?.code)) {
      throw Object.assign(new Error("Excel içeriği ayrıştırılamadı."), {
        code: error?.code || "EXCEL_PARSE_ERROR",
        stage: EXCEL_READ_STAGE.WORKER_PARSE,
      });
    }

    excelReadRuntimeStats.fallbackAttempts += 1;
    try {
      const rows = readSheetRowsFromArrayBuffer(fallbackBuffer);
      excelReadRuntimeStats.mainThreadParses += 1;
      excelReadRuntimeStats.fallbackSuccess += 1;
      const output = resultShape(rows, EXCEL_READ_STATUS.FALLBACK, {
        fallbackReasonCode: error.code,
      });
      return includeMetadata ? output : output.rows;
    } catch (fallbackError) {
      throw Object.assign(new Error("Excel dosyası okunamadı."), {
        code: EXCEL_READ_STAGE.FALLBACK_PARSE,
        stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
        cause: fallbackError,
      });
    }
  }
}

/**
 * UI upload contract: only a fully read and parsed workbook returns success.
 * Worker failure remains internal when the main-thread fallback succeeds.
 */
export async function parseExcelUploadFile(
  file,
  {
    parseRows,
    ...readOptions
  } = {}
) {
  if (typeof parseRows !== "function") {
    throw Object.assign(new Error("Excel parser tanımlı değil."), {
      code: EXCEL_READ_STAGE.FALLBACK_PARSE,
      stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
    });
  }

  const sheetRows = await readExcelSheetRowsFromFile(file, readOptions);
  const rows = parseRows(sheetRows);
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error("Excel satırları işlenemedi."), {
      code: EXCEL_READ_STAGE.FALLBACK_PARSE,
      stage: EXCEL_READ_STAGE.FALLBACK_PARSE,
    });
  }

  return {
    status: "success",
    rows,
    fileName: String(file?.name || "").trim(),
  };
}
