import {
  EDEFTER_ANALYZE_PROTOCOL,
  executeEDefterAnalyzePayload,
  sanitizeAnalyzeResult,
} from "@/src/utils/eDefterAnalyzeContract";
import { postProgress, WORKER_PARSE_STAGES, yieldToWorker } from "@/src/workers/workerUtils";

/**
 * Bridge posts: { requestId, payload: CloneSafeAnalyzePayload, protocolVersion? }
 * (via flatten of nested { payload, protocolVersion })
 */
self.onmessage = async (event) => {
  const data = event.data || {};
  const requestId = data.requestId;
  const protocolVersion = Number(data.protocolVersion || 0);
  const payload =
    data.payload && typeof data.payload === "object" && !Array.isArray(data.payload)
      ? data.payload
      : data;

  try {
    if (!requestId) {
      throw Object.assign(new Error("Analyze requestId zorunlu."), {
        code: "ANALYZE_REQUEST_ID_MISSING",
      });
    }
    if (protocolVersion && protocolVersion !== EDEFTER_ANALYZE_PROTOCOL) {
      throw Object.assign(new Error("Analyze worker protokol sürümü uyuşmuyor."), {
        code: "ANALYZE_PROTOCOL_MISMATCH",
      });
    }

    postProgress(WORKER_PARSE_STAGES.ANALYZING, "e-Defter kontrol kuralları çalışıyor", 20);
    await yieldToWorker();

    const startedAt = Date.now();
    const raw = await executeEDefterAnalyzePayload(payload);
    const elapsedMs = Date.now() - startedAt;

    postProgress(
      WORKER_PARSE_STAGES.DONE,
      `${Array.isArray(raw?.rows) ? raw.rows.length : 0} kayıt kontrol edildi`,
      100
    );

    const result = sanitizeAnalyzeResult(raw, {
      execution: "worker",
      engineInvocations: 1,
      elapsedMs,
    });

    self.postMessage({
      type: "success",
      requestId,
      result,
      ...result,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      error: error?.message || "e-Defter analizi başarısız.",
      code: error?.code || "ANALYZE_WORKER_FAILED",
    });
  }
};
