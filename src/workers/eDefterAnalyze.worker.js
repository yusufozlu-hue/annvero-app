import {
  EDEFTER_ANALYZE_JOB_KIND,
  EDEFTER_ANALYZE_PROTOCOL,
  executeEDefterAnalyzePayload,
  resolveAnalyzeJobKind,
  sanitizeAnalyzeResult,
} from "@/src/utils/eDefterAnalyzeContract";
import { postProgress, WORKER_PARSE_STAGES, yieldToWorker } from "@/src/workers/workerUtils";

/**
 * Bridge posts: { requestId, payload: CloneSafeAnalyzePayload, protocolVersion? }
 * payload.jobKind: E_DEFTER_CONTROL (default) | GENERAL_LEDGER_CONTROL
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

    const jobKind = resolveAnalyzeJobKind(payload?.jobKind || payload?.jobType);
    const analyzingLabel =
      jobKind === EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL
        ? "Genel muhasebe kontrol kuralları çalışıyor"
        : "e-Defter kontrol kuralları çalışıyor";

    postProgress(WORKER_PARSE_STAGES.ANALYZING, analyzingLabel, 20);
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
      jobKind,
      mainThreadAnalyze: 0,
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
      error: error?.message || "Analiz başarısız.",
      code: error?.code || "ANALYZE_WORKER_FAILED",
    });
  }
};
