/**
 * Fiş Kontrol analyze bridge: worker-first (≥300 path), single typed infra fallback.
 * Cancel / stale / timeout / app errors do not fall back. No customer row logging.
 */

import { analyzeStandardLucaRows } from "@/src/utils/fisKontrolMerkezi";
import {
  cancelActiveParseJob,
  runFisKontrolWorker,
} from "@/src/utils/workerParserBridge";
import { PARSER_WORKER_URLS } from "@/src/utils/parserWorkerUrls";

export const FIS_KONTROL_ANALYZE_SCOPE = "fis-kontrol-analyze";
export const FIS_KONTROL_WORKER_THRESHOLD = 300;

export const FIS_KONTROL_FALLBACK_WARNING =
  "Worker kullanılamadı; kontrol güvenli yedek yöntemle tamamlandı.";

export const fisKontrolAnalyzeStats = {
  workerAttempts: 0,
  workerSuccess: 0,
  fallbackAttempts: 0,
  fallbackSuccess: 0,
  engineInvocations: 0,
  staleIgnored: 0,
  cancelled: 0,
  lastFallbackReasonCode: "",
};

export function resetFisKontrolAnalyzeStats() {
  for (const key of Object.keys(fisKontrolAnalyzeStats)) {
    fisKontrolAnalyzeStats[key] =
      typeof fisKontrolAnalyzeStats[key] === "string" ? "" : 0;
  }
}

const FIS_KONTROL_INFRASTRUCTURE_FALLBACK_CODES = new Set([
  "WORKER_ONERROR",
  "WORKER_CONSTRUCT_FAILED",
  "WORKER_UNAVAILABLE",
  "WORKER_MESSAGE_ERROR",
  "WORKER_POSTMESSAGE_FAILED",
  "WORKER_SCRIPT_HTML",
  "WORKER_SCRIPT_INVALID",
  "WORKER_SCRIPT_FETCH_FAILED",
  "WORKER_CLONE_FAILED",
  "WORKER_DUPLICATE_REQUEST",
]);

let activeRequestId = null;
let activeGeneration = 0;
let jobInFlight = false;

/** Invalidate in-flight / queued FK analyze jobs (company change / cancel / unmount). */
export function bumpFisKontrolAnalyzeGeneration(reason = "reset") {
  void reason;
  activeGeneration += 1;
  activeRequestId = null;
  jobInFlight = false;
  try {
    cancelActiveParseJob("stale", { scopeId: FIS_KONTROL_ANALYZE_SCOPE });
  } catch {
    /* ignore */
  }
  return activeGeneration;
}

export function getActiveFisKontrolAnalyzeRequestId() {
  return activeRequestId;
}

export function getFisKontrolAnalyzeGeneration() {
  return activeGeneration;
}

export function isFisKontrolAnalyzeJobInFlight() {
  return jobInFlight;
}

function makeRequestId() {
  return `fis-kontrol-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/** Safe telemetry codes only — never surface raw stacks or row content. */
export function resolveFisKontrolFallbackReasonCode(error = null) {
  const code = String(error?.code || "").trim();
  if (FIS_KONTROL_INFRASTRUCTURE_FALLBACK_CODES.has(code)) return code;
  const allowed = new Set([
    "WORKER_CANCELLED",
    "WORKER_STALE",
    "WORKER_TIMEOUT",
    "WORKER_PARSE_FAILED",
    "FIS_KONTROL_CANCELLED",
    "FIS_KONTROL_STALE",
    "FIS_KONTROL_TIMEOUT",
    "FIS_KONTROL_ANALYZE_FAILED",
  ]);
  if (allowed.has(code)) return code;
  const message = String(error?.message || "");
  if (/DataCloneError|structured clone|cloneable/i.test(message)) {
    return "WORKER_CLONE_FAILED";
  }
  if (/timeout/i.test(message) || /zaman aşımı/i.test(message)) {
    return "WORKER_TIMEOUT";
  }
  return "WORKER_FAILED";
}

function runMainThreadAnalyze(rows, options, diagnostics = {}) {
  fisKontrolAnalyzeStats.engineInvocations += 1;
  const analysis = analyzeStandardLucaRows(rows, options);
  return {
    analysis,
    diagnostics: {
      execution: diagnostics.execution || "main-thread",
      requestId: diagnostics.requestId || null,
      generation: diagnostics.generation ?? null,
      engineInvocations: 1,
      fallback: diagnostics.fallback ?? 0,
      performanceWarning: diagnostics.performanceWarning || "",
    },
  };
}

function assertWorkerAnalysisMessage(message) {
  const analysis = message?.analysis;
  if (!analysis || typeof analysis !== "object") {
    throw Object.assign(new Error("Worker boş analiz döndü."), {
      code: "FIS_KONTROL_WORKER_EMPTY",
    });
  }
  if (!Array.isArray(analysis.rows) || !Array.isArray(analysis.issues)) {
    throw Object.assign(new Error("Worker analiz şeması uyumsuz."), {
      code: "FIS_KONTROL_WORKER_SCHEMA",
    });
  }
  return analysis;
}

/**
 * Worker-preferred analyze for the ≥300-row path.
 * Exactly one main-thread fallback on infrastructure failure only.
 */
export async function runFisKontrolAnalyzeJob(
  { rows = [], options = {} } = {},
  {
    workerUrl = PARSER_WORKER_URLS.fisKontrol,
    onProgress,
    timeoutMs = 120_000,
    preferWorker = true,
    signal,
    generation = null,
    WorkerImpl,
    requireExclusive = false,
  } = {}
) {
  if (requireExclusive && jobInFlight) {
    const err = new Error("Fiş kontrol analizi zaten sürüyor.");
    err.code = "FIS_KONTROL_IN_FLIGHT";
    throw err;
  }

  const requestId = makeRequestId();
  const jobGeneration = generation == null ? activeGeneration : generation;
  activeRequestId = requestId;
  jobInFlight = true;

  const assertNotStale = () => {
    if (signal?.aborted) {
      fisKontrolAnalyzeStats.cancelled += 1;
      const err = new Error("Fiş kontrol analizi iptal edildi.");
      err.code = "FIS_KONTROL_CANCELLED";
      throw err;
    }
    if (jobGeneration !== activeGeneration || activeRequestId !== requestId) {
      fisKontrolAnalyzeStats.staleIgnored += 1;
      const err = new Error("Eski fiş kontrol sonucu yok sayıldı.");
      err.code = "FIS_KONTROL_STALE";
      throw err;
    }
  };

  try {
    const canUseWorker =
      preferWorker &&
      (typeof WorkerImpl === "function" || typeof Worker !== "undefined") &&
      Boolean(workerUrl);

    if (canUseWorker) {
      fisKontrolAnalyzeStats.workerAttempts += 1;
      try {
        assertNotStale();
        const message = await runFisKontrolWorker({
          workerUrl,
          payload: { rows, options },
          onProgress,
          timeoutMs,
          WorkerImpl,
          requestId,
          generation: jobGeneration,
          scopeId: FIS_KONTROL_ANALYZE_SCOPE,
          signal,
        });
        assertNotStale();

        if (message?.requestId && message.requestId !== requestId) {
          throw Object.assign(new Error("Worker requestId eşleşmiyor."), {
            code: "FIS_KONTROL_REQUEST_ID_MISMATCH",
          });
        }

        const analysis = assertWorkerAnalysisMessage(message);
        fisKontrolAnalyzeStats.workerSuccess += 1;
        fisKontrolAnalyzeStats.engineInvocations += 1;
        return {
          analysis,
          diagnostics: {
            execution: "worker",
            requestId,
            generation: jobGeneration,
            engineInvocations: 1,
            fallback: 0,
            performanceWarning: "",
          },
        };
      } catch (error) {
        if (
          error?.code === "FIS_KONTROL_STALE" ||
          error?.code === "FIS_KONTROL_CANCELLED"
        ) {
          throw error;
        }
        if (error?.code === "WORKER_CANCELLED") {
          fisKontrolAnalyzeStats.cancelled += 1;
          throw Object.assign(new Error("Fiş kontrol analizi iptal edildi."), {
            code: "FIS_KONTROL_CANCELLED",
          });
        }
        if (error?.code === "WORKER_STALE") {
          fisKontrolAnalyzeStats.staleIgnored += 1;
          throw Object.assign(
            new Error("Eski fiş kontrol sonucu geçersiz kılındı."),
            { code: "FIS_KONTROL_STALE" }
          );
        }
        if (
          error?.code === "WORKER_TIMEOUT" ||
          !FIS_KONTROL_INFRASTRUCTURE_FALLBACK_CODES.has(error?.code)
        ) {
          if (error?.code === "WORKER_TIMEOUT") {
            const timeoutErr = Object.assign(
              new Error(error?.message || "Fiş kontrol zaman aşımı."),
              { code: "FIS_KONTROL_TIMEOUT" }
            );
            throw timeoutErr;
          }
          throw error;
        }

        assertNotStale();
        fisKontrolAnalyzeStats.fallbackAttempts += 1;
        const fallbackReasonCode = resolveFisKontrolFallbackReasonCode(error);
        fisKontrolAnalyzeStats.lastFallbackReasonCode = fallbackReasonCode;
        if (typeof console !== "undefined") {
          console.warn("[fisKontrolAnalyzeBridge] worker→fallback", {
            fallbackReasonCode,
          });
        }

        const fallback = runMainThreadAnalyze(rows, options, {
          execution: "main-thread-fallback",
          requestId,
          generation: jobGeneration,
          fallback: 1,
          performanceWarning: FIS_KONTROL_FALLBACK_WARNING,
        });
        assertNotStale();
        fisKontrolAnalyzeStats.fallbackSuccess += 1;
        return fallback;
      }
    }

    fisKontrolAnalyzeStats.fallbackAttempts += 1;
    fisKontrolAnalyzeStats.lastFallbackReasonCode = "WORKER_UNAVAILABLE";
    assertNotStale();
    const mainResult = runMainThreadAnalyze(rows, options, {
      execution: "main-thread",
      requestId,
      generation: jobGeneration,
      fallback: 1,
      performanceWarning: FIS_KONTROL_FALLBACK_WARNING,
    });
    assertNotStale();
    fisKontrolAnalyzeStats.fallbackSuccess += 1;
    return mainResult;
  } finally {
    if (activeRequestId === requestId) {
      jobInFlight = false;
    }
  }
}
