export const WORKER_PARSE_STAGES = {
  READING: "Dosya okunuyor",
  PARSING: "Veri ayrıştırılıyor",
  NORMALIZING: "Satırlar normalize ediliyor",
  ANALYZING: "Analiz çalışıyor",
  BATCHING: "Sonuçlar hazırlanıyor",
  DONE: "Tamamlandı",
};

export function yieldToWorker() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function postProgress(stage, detail = "", percent = null) {
  self.postMessage({
    type: "progress",
    stage,
    detail,
    percent,
  });
}

export async function mapInChunks(items, mapper, chunkSize = 200, onChunk = null) {
  const result = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);

    for (const item of chunk) {
      result.push(mapper(item));
    }

    if (onChunk) {
      onChunk(Math.min(index + chunk.length, items.length), items.length);
    }

    await yieldToWorker();
  }

  return result;
}

export function sortRiskFindingsByPriority(findings = []) {
  const order = { Kritik: 0, Yüksek: 1, Orta: 2, Düşük: 3 };
  return [...findings].sort((a, b) => {
    const left = order[a.level] ?? order[a.riskLevel] ?? 9;
    const right = order[b.level] ?? order[b.riskLevel] ?? 9;
    return left - right;
  });
}
