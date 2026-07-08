import { analyzeKurganRisks } from "@/src/utils/kurganRiskEngine";
import {
  postProgress,
  sortRiskFindingsByPriority,
  WORKER_PARSE_STAGES,
  yieldToWorker,
} from "@/src/workers/workerUtils";

self.onmessage = async (event) => {
  const { requestId, input = {} } = event.data || {};

  try {
    postProgress(WORKER_PARSE_STAGES.ANALYZING, "Veri kaynakları hazırlanıyor", 10);
    await yieldToWorker();

    postProgress(WORKER_PARSE_STAGES.ANALYZING, "Risk kuralları çalışıyor", 45);
    const result = analyzeKurganRisks(input);

    postProgress(WORKER_PARSE_STAGES.BATCHING, "Bulgular önceliklendiriliyor", 80);
    const prioritizedFindings = sortRiskFindingsByPriority(result.findings || []);
    const kritikCount = prioritizedFindings.filter((item) => item.level === "Kritik").length;

    postProgress(
      WORKER_PARSE_STAGES.DONE,
      `${prioritizedFindings.length} bulgu (${kritikCount} kritik)`,
      100
    );

    self.postMessage({
      type: "success",
      requestId,
      findings: prioritizedFindings,
      summary: result.summary,
      sources: result.sources,
      analyzedAt: result.analyzedAt,
      kritikCount,
    });
  } catch (error) {
    console.error("[riskAnalysis.worker] analyze failed", error);
    self.postMessage({
      type: "error",
      requestId,
      error: error?.message || "Risk analizi başarısız.",
    });
  }
};
