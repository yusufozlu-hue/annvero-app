/**
 * Lazy e-Defter / Genel Muhasebe analyze bridge: worker-first, single controlled fallback.
 * Job kinds: E_DEFTER_CONTROL | GENERAL_LEDGER_CONTROL — shared engines only.
 */

import {
  buildCloneSafeAnalyzePayload,
  executeEDefterAnalyzePayload,
  resolveAnalyzeJobKind,
  resultsAreParityEqual,
  sanitizeAnalyzeResult,
  EDEFTER_ANALYZE_JOB_KIND,
  EDEFTER_ANALYZE_PROTOCOL,
} from "@/src/utils/eDefterAnalyzeContract";
import {
  cancelActiveParseJob,
  runEDefterAnalyzeWorker,
} from "@/src/utils/workerParserBridge";
import { PARSER_WORKER_URLS } from "@/src/utils/parserWorkerUrls";

export const analyzeJobStats = {
  workerAttempts: 0,
  workerSuccess: 0,
  fallbackAttempts: 0,
  fallbackSuccess: 0,
  engineInvocations: 0,
  staleIgnored: 0,
  cancelled: 0,
  nestedPayloadOk: 0,
  malformedRejected: 0,
  persistAllowed: 0,
};

export function resetAnalyzeJobStats() {
  for (const key of Object.keys(analyzeJobStats)) {
    analyzeJobStats[key] = 0;
  }
}

let activeRequestId = null;
let activeGeneration = 0;
let jobInFlight = false;

/** Invalidate in-flight analyze jobs (company change / cancel / remount). */
export function bumpAnalyzeGeneration(reason = "reset") {
  activeGeneration += 1;
  activeRequestId = null;
  jobInFlight = false;
  try {
    cancelActiveParseJob(reason);
  } catch {
    /* ignore */
  }
  return activeGeneration;
}

export function getActiveAnalyzeRequestId() {
  return activeRequestId;
}

export function getAnalyzeGeneration() {
  return activeGeneration;
}

export function isAnalyzeJobInFlight() {
  return jobInFlight;
}

function makeRequestId() {
  return `edefter-analyze-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function attachFingerprint(input, result) {
  if (input?.fingerprintSession && input?.parsedUpload?.fingerprint && !result?.duplicate) {
    try {
      input.fingerprintSession.add(input.parsedUpload.fingerprint);
    } catch {
      /* ignore */
    }
  }
  return result;
}

function markPersistAllowed(jobKind) {
  // Genel Muhasebe is local-control only — never open persist gate.
  if (jobKind === EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL) return;
  analyzeJobStats.persistAllowed += 1;
}

async function runMainThreadAnalyze(input, diagnostics = {}) {
  analyzeJobStats.engineInvocations += 1;
  const safe = buildCloneSafeAnalyzePayload(input);
  const jobKind = resolveAnalyzeJobKind(safe.jobKind);
  const raw = await executeEDefterAnalyzePayload(safe);
  return sanitizeAnalyzeResult(raw, {
    execution: "main-thread",
    engineInvocations: 1,
    jobKind,
    ...diagnostics,
  });
}

function assertWorkerContractResult(message) {
  const result = message?.result || message;
  if (!result || result.ok === false) {
    analyzeJobStats.malformedRejected += 1;
    throw Object.assign(new Error(message?.error || "Worker boş sonuç döndü."), {
      code: message?.code || "ANALYZE_WORKER_EMPTY",
    });
  }
  if (!Array.isArray(result.rows) && !result.duplicate) {
    analyzeJobStats.malformedRejected += 1;
    throw Object.assign(new Error("Worker sonucu şema uyumsuz."), {
      code: "ANALYZE_WORKER_SCHEMA",
    });
  }
  return result;
}

/**
 * UI one-click analyze entry.
 * Worker preferred; on failure exactly one main-thread fallback.
 * Successful worker path does not re-run the engine on the main thread.
 */
export async function runEDefterAnalyzeJob(
  input = {},
  {
    workerUrl = PARSER_WORKER_URLS.eDefterAnalyze,
    onProgress,
    timeoutMs = 180_000,
    preferWorker = true,
    signal,
    generation = null,
    WorkerImpl,
    /** When true, refuse overlapping starts (UI click-lock companion). */
    requireExclusive = false,
  } = {}
) {
  if (requireExclusive && jobInFlight) {
    const err = new Error("Analiz zaten sürüyor.");
    err.code = "ANALYZE_IN_FLIGHT";
    throw err;
  }

  const requestId = makeRequestId();
  const jobGeneration = generation == null ? activeGeneration : generation;
  activeRequestId = requestId;
  jobInFlight = true;

  const safePayload = buildCloneSafeAnalyzePayload(input);
  const jobKind = resolveAnalyzeJobKind(safePayload.jobKind || input.jobKind || input.jobType);

  const assertNotStale = () => {
    if (signal?.aborted) {
      analyzeJobStats.cancelled += 1;
      const err = new Error("Analiz iptal edildi.");
      err.code = "ANALYZE_CANCELLED";
      throw err;
    }
    if (jobGeneration !== activeGeneration || activeRequestId !== requestId) {
      analyzeJobStats.staleIgnored += 1;
      const err = new Error("Eski analiz sonucu yok sayıldı.");
      err.code = "ANALYZE_STALE";
      throw err;
    }
  };

  try {
    const canUseWorker =
      preferWorker &&
      (typeof WorkerImpl === "function" || typeof Worker !== "undefined") &&
      Boolean(workerUrl);

    if (canUseWorker) {
      analyzeJobStats.workerAttempts += 1;
      try {
        assertNotStale();
        const nestedEnvelope = {
          payload: safePayload,
          protocolVersion: EDEFTER_ANALYZE_PROTOCOL,
        };
        if (nestedEnvelope.payload && typeof nestedEnvelope.payload === "object") {
          analyzeJobStats.nestedPayloadOk += 1;
        }
        const message = await runEDefterAnalyzeWorker({
          workerUrl,
          payload: nestedEnvelope,
          onProgress,
          timeoutMs,
          WorkerImpl,
          requestId,
        });
        assertNotStale();

        if (message?.requestId && message.requestId !== requestId) {
          analyzeJobStats.malformedRejected += 1;
          throw Object.assign(new Error("Worker requestId eşleşmiyor."), {
            code: "ANALYZE_REQUEST_ID_MISMATCH",
          });
        }

        const result = assertWorkerContractResult(message);

        analyzeJobStats.workerSuccess += 1;
        // Engine ran once inside the worker; do not count a second main-thread run.
        analyzeJobStats.engineInvocations += 1;
        markPersistAllowed(jobKind);
        return attachFingerprint(input, {
          ...result,
          diagnostics: {
            ...(result.diagnostics || {}),
            execution: "worker",
            requestId,
            generation: jobGeneration,
            jobKind,
            engineInvocations: 1,
            fallback: 0,
            mainThreadAnalyze: 0,
          },
        });
      } catch (error) {
        if (error?.code === "ANALYZE_STALE" || error?.code === "ANALYZE_CANCELLED") {
          throw error;
        }
        // Cancel/replace/stale must not consume the single fallback slot.
        assertNotStale();
        analyzeJobStats.fallbackAttempts += 1;
        const fallback = await runMainThreadAnalyze(input, {
          fallbackFrom: error?.code || "WORKER_FAILED",
          fallbackMessage: String(error?.message || "").slice(0, 200),
          requestId,
          generation: jobGeneration,
          jobKind,
          performanceWarning:
            jobKind === EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL
              ? "Analiz worker yedeğe düştü; büyük dosyada tarayıcı yavaşlayabilir."
              : "",
        });
        assertNotStale();
        analyzeJobStats.fallbackSuccess += 1;
        markPersistAllowed(jobKind);
        return attachFingerprint(input, {
          ...fallback,
          diagnostics: {
            ...(fallback.diagnostics || {}),
            execution: "main-thread-fallback",
            requestId,
            generation: jobGeneration,
            jobKind,
            fallback: 1,
            mainThreadAnalyze: 1,
          },
        });
      }
    }

    analyzeJobStats.fallbackAttempts += 1;
    assertNotStale();
    const mainResult = await runMainThreadAnalyze(input, {
      requestId,
      reason: "worker-unavailable",
      generation: jobGeneration,
      jobKind,
      performanceWarning:
        jobKind === EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL
          ? "Analiz worker kullanılamadı; kontrol ana thread’de çalıştı."
          : "",
    });
    assertNotStale();
    analyzeJobStats.fallbackSuccess += 1;
    markPersistAllowed(jobKind);
    return attachFingerprint(input, {
      ...mainResult,
      diagnostics: {
        ...(mainResult.diagnostics || {}),
        execution: "main-thread",
        requestId,
        generation: jobGeneration,
        jobKind,
        fallback: 1,
        mainThreadAnalyze: 1,
      },
    });
  } finally {
    if (activeRequestId === requestId) {
      jobInFlight = false;
    }
  }
}

export {
  resultsAreParityEqual,
  buildCloneSafeAnalyzePayload,
  sanitizeAnalyzeResult,
  EDEFTER_ANALYZE_JOB_KIND,
};
