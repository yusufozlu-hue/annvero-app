import { parseEDefterUploadBuffer } from "@/src/utils/eDefterXmlParser";
import { postProgress, WORKER_PARSE_STAGES, yieldToWorker } from "@/src/workers/workerUtils";

self.onmessage = async (event) => {
  const { requestId, arrayBuffer, fileName = "" } = event.data || {};

  try {
    postProgress(WORKER_PARSE_STAGES.READING, `${fileName || "Dosya"} okunuyor`, 5);
    await yieldToWorker();

    postProgress(WORKER_PARSE_STAGES.PARSING, "XML/ZIP ayrıştırılıyor", 20);
    const parsed = await parseEDefterUploadBuffer(arrayBuffer, fileName);

    postProgress(
      WORKER_PARSE_STAGES.DONE,
      `${parsed.rows.length} satır, ${parsed.technicalFindings.length} teknik bulgu`,
      100
    );

    self.postMessage({
      type: "success",
      requestId,
      ...parsed,
    });
  } catch (error) {
    console.error("[eDefterXml.worker] parse failed", error);
    self.postMessage({
      type: "error",
      requestId,
      error: error?.message || "XML/ZIP dosyası işlenemedi.",
    });
  }
};
