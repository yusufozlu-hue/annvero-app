import {
  readSheetObjectsFromArrayBuffer,
  readSheetRowsFromArrayBuffer,
} from "@/src/utils/excelBufferUtils";
import {
  postProgress,
  setWorkerProgressContext,
  WORKER_PARSE_STAGES,
  yieldToWorker,
} from "@/src/workers/workerUtils";

function normalizeCell(value) {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value).slice(0, 500);
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error("Excel satır şeması geçersiz."), {
      code: "EXCEL_VALIDATION_ERROR",
    });
  }
  return rows.slice(0, 200_000).map((row) => {
    if (Array.isArray(row)) return row.slice(0, 64).map(normalizeCell);
    if (row && typeof row === "object") {
      return Object.fromEntries(
        Object.entries(row)
          .slice(0, 64)
          .map(([key, value]) => [String(key).slice(0, 120), normalizeCell(value)])
      );
    }
    return [];
  });
}

self.onmessage = async (event) => {
  const {
    requestId,
    generation = 0,
    fileKind = "excel",
    arrayBuffer,
    mode = "rows",
  } = event.data || {};
  setWorkerProgressContext({ requestId, generation, fileKind });

  try {
    postProgress(WORKER_PARSE_STAGES.READING, "Excel çalışma kitabı okunuyor");
    await yieldToWorker();

    postProgress(WORKER_PARSE_STAGES.PARSING, "Sayfa satırları çıkarılıyor");
    const parsedRows =
      mode === "objects"
        ? readSheetObjectsFromArrayBuffer(arrayBuffer)
        : readSheetRowsFromArrayBuffer(arrayBuffer);
    const rows = normalizeRows(parsedRows);

    postProgress(WORKER_PARSE_STAGES.DONE, "Excel satırları hazır");

    self.postMessage({
      type: "success",
      requestId,
      generation,
      fileKind,
      rows,
      rowCount: rows.length,
      metadata: {
        mode: mode === "objects" ? "objects" : "rows",
        rowCount: rows.length,
        columnCount: rows.reduce(
          (max, row) =>
            Math.max(
              max,
              Array.isArray(row) ? row.length : Object.keys(row || {}).length
            ),
          0
        ),
      },
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      generation,
      fileKind,
      error: "Excel içeriği ayrıştırılamadı.",
      code: error?.code || "EXCEL_PARSE_ERROR",
    });
  }
};
