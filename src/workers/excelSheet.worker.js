import {
  readSheetObjectsFromArrayBuffer,
  readSheetRowsFromArrayBuffer,
} from "@/src/utils/excelBufferUtils";
import { postProgress, WORKER_PARSE_STAGES, yieldToWorker } from "@/src/workers/workerUtils";

self.onmessage = async (event) => {
  const { requestId, arrayBuffer, mode = "rows" } = event.data || {};

  try {
    postProgress(WORKER_PARSE_STAGES.READING, "Excel çalışma kitabı okunuyor", 10);
    await yieldToWorker();

    postProgress(WORKER_PARSE_STAGES.PARSING, "Sayfa satırları çıkarılıyor", 35);
    const rows =
      mode === "objects"
        ? readSheetObjectsFromArrayBuffer(arrayBuffer)
        : readSheetRowsFromArrayBuffer(arrayBuffer);

    postProgress(WORKER_PARSE_STAGES.DONE, `${rows.length} satır hazır`, 100);

    self.postMessage({
      type: "success",
      requestId,
      rows,
      rowCount: rows.length,
    });
  } catch (error) {
    console.error("[excelSheet.worker] parse failed", error);
    self.postMessage({
      type: "error",
      requestId,
      error: error?.message || "Excel dosyası okunamadı.",
    });
  }
};
