import { parseEDefterUploadBuffer } from "@/src/utils/eDefterXmlParser";
import { postProgress, WORKER_PARSE_STAGES, yieldToWorker } from "@/src/workers/workerUtils";

self.onmessage = async (event) => {
  const {
    requestId,
    arrayBuffer,
    fileName = "",
    companyTaxId = "",
    knownFingerprints = [],
    timeoutMs,
  } = event.data || {};

  try {
    postProgress(WORKER_PARSE_STAGES.READING, "Dosya okunuyor", 5);
    await yieldToWorker();

    postProgress(WORKER_PARSE_STAGES.PARSING, "XML/ZIP ayrıştırılıyor", 20);
    const fingerprintSet = new Set(Array.isArray(knownFingerprints) ? knownFingerprints : []);
    const parsed = await parseEDefterUploadBuffer(arrayBuffer, fileName, {
      companyTaxId,
      knownFingerprints: fingerprintSet,
      timeoutMs,
    });

    postProgress(
      WORKER_PARSE_STAGES.DONE,
      parsed.duplicate
        ? "Mükerrer dosya"
        : `${parsed.rows.length} satır, ${parsed.technicalFindings.length} teknik bulgu`,
      100
    );

    self.postMessage({
      type: "success",
      requestId,
      ...parsed,
      knownFingerprints: [...fingerprintSet],
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      error: error?.message || "XML/ZIP dosyası işlenemedi.",
      code: error?.code || "",
    });
  }
};
