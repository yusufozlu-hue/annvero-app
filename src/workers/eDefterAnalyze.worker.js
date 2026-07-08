import { runEDefterKontrolPipeline } from "@/src/utils/eDefterKontrolEngine";
import { postProgress, WORKER_PARSE_STAGES, yieldToWorker } from "@/src/workers/workerUtils";

self.onmessage = async (event) => {
  const { requestId, payload = {} } = event.data || {};

  try {
    postProgress(WORKER_PARSE_STAGES.ANALYZING, "e-Defter kontrol kuralları çalışıyor", 20);
    await yieldToWorker();

    const result = runEDefterKontrolPipeline(payload);

    postProgress(
      WORKER_PARSE_STAGES.DONE,
      `${result.rows.length} kayıt kontrol edildi`,
      100
    );

    self.postMessage({
      type: "success",
      requestId,
      ...result,
    });
  } catch (error) {
    console.error("[eDefterAnalyze.worker] analyze failed", error);
    self.postMessage({
      type: "error",
      requestId,
      error: error?.message || "e-Defter analizi başarısız.",
    });
  }
};
