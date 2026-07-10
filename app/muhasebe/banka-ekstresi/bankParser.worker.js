import * as XLSX from "xlsx";
import {
  BANK_PARSE_STAGES,
  normalizeBankParsedRow,
  parseRowsForBank,
} from "@/src/utils/bankParserWorkerCore";

/**
 * Minimal bank Excel worker.
 * Only: read workbook → parse by bank → plain JSON rows.
 * Luca / learning / NFT / dashboard stay on the main thread.
 */

function formatWorkerError(error, stage = "") {
  const parts = [];
  if (stage) parts.push(`[${stage}]`);
  if (error?.name) parts.push(error.name);
  if (error?.message) parts.push(error.message);
  else parts.push(String(error || "Bilinmeyen worker hatası"));
  if (error?.stack) {
    parts.push(String(error.stack).split("\n").slice(0, 2).join(" | "));
  }
  return parts.filter(Boolean).join(" — ").slice(0, 800);
}

function postProgress(stage, detail = "") {
  self.postMessage({ type: "progress", stage, detail });
}

function postError(requestId, error, stage = "") {
  const message = formatWorkerError(error, stage);
  console.error("[bankParser.worker]", { stage, message, error });
  self.postMessage({
    type: "error",
    requestId,
    error: message,
    stage: stage || null,
    errorName: error?.name || null,
  });
}

function yieldToWorker() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function mapInChunks(items, mapper, chunkSize = 200, onChunk = null) {
  const result = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);
    for (const item of chunk) result.push(mapper(item));
    if (onChunk) onChunk(Math.min(index + chunk.length, items.length), items.length);
    await yieldToWorker();
  }
  return result;
}

self.onmessage = async (event) => {
  const { requestId, arrayBuffer, context } = event.data || {};
  let stage = BANK_PARSE_STAGES.READING;

  try {
    if (!arrayBuffer) throw new Error("Excel verisi (arrayBuffer) worker'a ulaşmadı.");
    if (!context?.selectedBank) {
      throw new Error("Banka seçimi (selectedBank) worker context'te yok.");
    }

    postProgress(stage, "Excel çalışma kitabı okunuyor");
    await yieldToWorker();

    const workbook = XLSX.read(arrayBuffer, { cellDates: true, type: "array" });
    const firstSheetName = workbook.SheetNames?.[0];
    if (!firstSheetName) throw new Error("Excel dosyasında sayfa bulunamadı.");

    const worksheet = workbook.Sheets[firstSheetName];
    const sheetRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
    });
    const rawCount = sheetRows.length;

    stage = BANK_PARSE_STAGES.PARSING;
    postProgress(stage, `${rawCount} ham satır taranıyor (${context.selectedBank})`);
    await yieldToWorker();

    let parsedRows;
    try {
      parsedRows = parseRowsForBank(sheetRows, context.selectedBank);
    } catch (parseError) {
      throw new Error(
        formatWorkerError(parseError, `parseRowsForBank:${context.selectedBank}`)
      );
    }

    postProgress(stage, `${parsedRows.length} satır normalize ediliyor`);

    const normalizedRows = await mapInChunks(
      parsedRows,
      (row) => normalizeBankParsedRow(row, context.selectedBank),
      200,
      (done, total) => postProgress(stage, `${done}/${total} hareket hazırlandı`)
    );

    // Tam JSON clone yok — 200'lük chunk postMessage (structured clone spike sınırlı)
    const CHUNK = 200;
    const totalRows = normalizedRows.length;
    for (let offset = 0; offset < totalRows; offset += CHUNK) {
      const end = Math.min(offset + CHUNK, totalRows);
      const chunk = normalizedRows.slice(offset, end);
      for (let i = offset; i < end; i += 1) {
        normalizedRows[i] = null;
      }
      self.postMessage({
        type: "rows_chunk",
        requestId,
        offset,
        total: totalRows,
        rows: chunk,
      });
      await yieldToWorker();
    }

    self.postMessage({
      type: "success",
      requestId,
      rawCount,
      rowCount: totalRows,
      selectedBank: context.selectedBank,
    });
  } catch (error) {
    postError(requestId, error, stage);
  }
};

self.addEventListener("error", (event) => {
  console.error("[bankParser.worker] uncaught", {
    message: event?.message,
    filename: event?.filename,
    lineno: event?.lineno,
    colno: event?.colno,
    error: event?.error,
  });
  self.postMessage({
    type: "error",
    requestId: null,
    error: formatWorkerError(
      event?.error || new Error(event?.message || "Worker script hatası"),
      "uncaught"
    ),
  });
});

self.addEventListener("unhandledrejection", (event) => {
  console.error("[bankParser.worker] unhandledrejection", event?.reason);
  self.postMessage({
    type: "error",
    requestId: null,
    error: formatWorkerError(event?.reason, "unhandledrejection"),
  });
});
