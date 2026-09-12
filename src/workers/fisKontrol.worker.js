import { analyzeStandardLucaRows } from "@/src/utils/fisKontrolMerkezi";
import {
  postProgress,
  setWorkerProgressContext,
  WORKER_PARSE_STAGES,
  yieldToWorker,
} from "@/src/workers/workerUtils";

self.onmessage = async (event) => {
  const data = event.data || {};
  const {
    requestId,
    generation = 0,
    fileKind = "fis-kontrol",
    rows = [],
    options = {},
  } = data;

  const identity = { requestId, generation, fileKind };
  setWorkerProgressContext(identity);

  try {
    postProgress(
      WORKER_PARSE_STAGES.ANALYZING,
      `${rows.length} satır kontrol ediliyor`,
      15
    );
    await yieldToWorker();

    postProgress(
      WORKER_PARSE_STAGES.ANALYZING,
      "Fiş dengesi ve mükerrer kayıtlar taranıyor",
      55
    );
    const analysis = analyzeStandardLucaRows(rows, options);

    const kritikCount = (analysis.issues || []).filter((issue) => issue.seviye === "Hata").length;

    postProgress(
      WORKER_PARSE_STAGES.DONE,
      `${analysis.summary?.hataRowCount || kritikCount} hatalı satır, ${analysis.summary?.uyariIssueCount || 0} uyarı`,
      100
    );

    self.postMessage({
      type: "success",
      ...identity,
      analysis,
      kritikCount,
    });
  } catch (error) {
    if (error?.name !== "AbortError") {
      // İçerik loglanmaz
    }
    const aborted = error?.name === "AbortError";
    const code = aborted
      ? "FIS_KONTROL_CANCELLED"
      : "FIS_KONTROL_ANALYZE_FAILED";
    self.postMessage({
      type: "error",
      ...identity,
      error: aborted
        ? "Fiş kontrolü iptal edildi."
        : "Fiş kontrolü tamamlanamadı.",
      code,
    });
  }
};
