/**
 * Worker URL'leri src/utils üzerinden çözülmeli.
 * App Router page.jsx içindeki import.meta.url chunk URL'sine işaret eder;
 * sibling ./bankParser.worker.js bu yüzden yüklenemez (boş ErrorEvent).
 *
 * bankExcel: zero-import classic Worker (module type YOK — bridge.classicWorker).
 * eDefterAnalyze: prebundled classic IIFE in public/workers (Turbopack media-copy
 * leaves `@/` imports unresolved on the module worker source).
 */
export const PARSER_WORKER_URLS = {
  bankExcel: new URL("../workers/bankParser.worker.js", import.meta.url),
  eDefterXml: new URL("../workers/eDefterXml.worker.js", import.meta.url),
  excelSheet: new URL("../workers/excelSheet.worker.js", import.meta.url),
  riskAnalysis: new URL("../workers/riskAnalysis.worker.js", import.meta.url),
  fisKontrol: new URL("../workers/fisKontrol.worker.js", import.meta.url),
  /** Classic bundled worker — see scripts/bundle-edefter-analyze-worker.mjs */
  eDefterAnalyze: "/workers/eDefterAnalyze.worker.js",
  bankOcr: new URL("../workers/bankOcr.worker.js", import.meta.url),
};
