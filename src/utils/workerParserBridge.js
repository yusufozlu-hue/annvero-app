/**
 * Worker-ready parser bridge with progress events, cancel, timeout and logging hooks.
 */

const parseQueue = [];
let processing = false;
let activeJob = null;
let activeWorker = null;
/** Settles the in-flight runParserWorker promise on cancel/timeout/replace. */
let activeSettler = null;

const WORKER_POOL_MAX_CONCURRENCY = 2;
const workerPoolQueue = [];
const workerPoolJobs = new Map();
let workerPoolRunning = 0;
let requestSequence = 0;

const listeners = new Set();

/** Observability for tests / diagnostics — not a second control path. */
export const parserWorkerRuntimeStats = {
  constructs: 0,
  terminates: 0,
  postMessages: 0,
  timeouts: 0,
  cancels: 0,
  queued: 0,
  peakWorkers: 0,
  duplicateResponses: 0,
  malformedResponses: 0,
  classicBootstraps: 0,
  classicBootstrapHtmlBlocked: 0,
};

/**
 * Classic public/workers scripts must not be passed straight to `new Worker(url)`
 * on Vercel Authentication previews: the Worker script request (Sec-Fetch-Dest:
 * worker) often receives the SSO HTML interstitial instead of JS → WORKER_ONERROR.
 * Main-thread fetch keeps the auth cookie, validates the body, then uses a blob:
 * URL (allowed by worker-src 'self' blob:).
 *
 * @param {string|URL} workerUrl
 * @param {{ fetchImpl?: typeof fetch, createObjectURL?: typeof URL.createObjectURL, signal?: AbortSignal }} [opts]
 */
export async function bootstrapClassicWorkerScriptUrl(workerUrl, opts = {}) {
  const href = String(workerUrl || "");
  if (!href) {
    throw Object.assign(new Error("Worker URL tanımsız."), {
      code: "WORKER_SCRIPT_FETCH_FAILED",
    });
  }

  const fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (typeof fetchImpl !== "function") {
    throw Object.assign(new Error("fetch API kullanılamıyor (classic worker bootstrap)."), {
      code: "WORKER_SCRIPT_FETCH_FAILED",
    });
  }

  let response;
  try {
    response = await fetchImpl(href, {
      credentials: "same-origin",
      cache: "no-cache",
      headers: { Accept: "text/javascript, application/javascript, */*;q=0.1" },
      signal: opts.signal,
    });
  } catch (networkError) {
    if (opts.signal?.aborted || networkError?.name === "AbortError") {
      throw cancellationError("cancelled");
    }
    throw Object.assign(
      new Error(networkError?.message || "Worker script fetch başarısız."),
      { code: "WORKER_SCRIPT_FETCH_FAILED" }
    );
  }

  const contentType = String(response.headers?.get?.("content-type") || "");
  const buffer = await response.arrayBuffer();
  const bytes = buffer?.byteLength || 0;
  const head = new TextDecoder("utf-8", { fatal: false }).decode(
    buffer.slice(0, Math.min(240, bytes))
  );
  const isHtml =
    /text\/html/i.test(contentType) ||
    /^\s*<!DOCTYPE/i.test(head) ||
    /^\s*<html[\s>]/i.test(head);
  const looksLikeWorker =
    /annvero eDefterAnalyze classic worker/i.test(head) ||
    /["']use strict["']/.test(head) ||
    /\bonmessage\b/.test(head);

  if (!response.ok || isHtml || !looksLikeWorker || bytes < 1_000) {
    parserWorkerRuntimeStats.classicBootstrapHtmlBlocked += 1;
    const err = new Error(
      isHtml
        ? "Worker script HTML döndü (auth/SSO veya 404 sayfası). Classic blob bootstrap reddetti."
        : `Worker script geçersiz (status=${response.status}, type=${contentType || "?"}, bytes=${bytes}).`
    );
    err.code = isHtml ? "WORKER_SCRIPT_HTML" : "WORKER_SCRIPT_INVALID";
    err.detail = {
      status: response.status,
      contentType,
      bytes,
    };
    throw err;
  }

  const createObjectURL =
    opts.createObjectURL ||
    (typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL.bind(URL)
      : null);
  if (typeof createObjectURL !== "function") {
    throw Object.assign(new Error("URL.createObjectURL kullanılamıyor."), {
      code: "WORKER_SCRIPT_INVALID",
    });
  }

  const blob = new Blob([buffer], { type: "text/javascript" });
  const blobUrl = createObjectURL(blob);
  parserWorkerRuntimeStats.classicBootstraps += 1;

  return {
    url: blobUrl,
    sourceHref: href,
    meta: { status: response.status, contentType, bytes },
    revoke() {
      try {
        if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(blobUrl);
        }
      } catch {
        /* ignore */
      }
    },
  };
}

export function resetParserWorkerRuntimeStats() {
  for (const key of Object.keys(parserWorkerRuntimeStats)) {
    parserWorkerRuntimeStats[key] = 0;
  }
}

export const PARSER_JOB_TYPES = {
  BANK_EXCEL: "bank-excel",
  LUCA_EXCEL: "luca-excel",
  EDEFTER_XML: "edefter-xml",
  EDEFTER_ANALYZE: "edefter-analyze",
  RISK_ANALYSIS: "risk-analysis",
  FIS_KONTROL: "fis-kontrol",
  EXCEL_SHEET: "excel-sheet",
};

export function subscribeParserEvents(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event = {}) {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.error("[parser-bridge] listener error", error);
    }
  });
}

function matchesPoolSelector(job, selector = {}) {
  if (!job) return false;
  if (selector.requestId && job.requestId !== selector.requestId) return false;
  if (selector.scopeId && job.scopeId !== selector.scopeId) return false;
  if (
    selector.generation != null &&
    String(job.generation) !== String(selector.generation)
  ) {
    return false;
  }
  if (selector.fileKind && job.fileKind !== selector.fileKind) return false;
  return true;
}

function cancellationError(reason) {
  const timeout = reason === "timeout";
  const stale = reason === "stale" || reason === "replaced";
  return Object.assign(
    new Error(
      timeout
        ? "Parser zaman aşımına uğradı."
        : stale
          ? "Parser işi geçersiz kılındı."
          : "İşlem iptal edildi."
    ),
    {
      code: timeout
        ? "WORKER_TIMEOUT"
        : stale
          ? "WORKER_STALE"
          : "WORKER_CANCELLED",
      status: timeout ? "timeout" : stale ? "stale" : "cancelled",
    }
  );
}

function cancelPoolJob(job, reason) {
  if (!job || job.settled) return false;
  job.cancelled = true;
  job.status = reason === "timeout" ? "timeout" : "cancelled";
  parserWorkerRuntimeStats.cancels += reason === "timeout" ? 0 : 1;
  job.finish?.("reject", cancellationError(reason));
  return true;
}

/**
 * Cancel request-aware jobs. Pass a selector for component/run scoped cleanup.
 * The no-selector form is retained only for legacy callers.
 */
export function cancelActiveParseJob(reason = "cancelled", selector = {}) {
  const hasSelector = Boolean(
    selector?.requestId ||
      selector?.scopeId ||
      selector?.generation != null ||
      selector?.fileKind
  );
  for (const job of [...workerPoolJobs.values()]) {
    if (!hasSelector || matchesPoolSelector(job, selector)) {
      cancelPoolJob(job, reason);
    }
  }
  if (hasSelector) return;

  const settler = activeSettler;
  activeSettler = null;
  if (settler) {
    try {
      settler.clearTimer?.();
    } catch {
      /* ignore */
    }
  }
  if (activeWorker) {
    try {
      activeWorker.terminate();
      parserWorkerRuntimeStats.terminates += 1;
    } catch {
      /* ignore */
    }
    activeWorker = null;
  }
  if (activeJob) {
    activeJob.status = "cancelled";
    parserWorkerRuntimeStats.cancels += 1;
    emit({
      type: "cancelled",
      jobId: activeJob.id,
      jobType: activeJob.type,
      reason,
    });
    activeJob = null;
  }
  processing = false;
  if (settler) {
    const err = new Error(
      reason === "timeout"
        ? "Parser zaman aşımına uğradı."
        : reason === "replaced"
          ? "Parser işi değiştirildi."
          : "İşlem iptal edildi."
    );
    err.code =
      reason === "timeout"
        ? "WORKER_TIMEOUT"
        : reason === "replaced"
          ? "WORKER_REPLACED"
          : "WORKER_CANCELLED";
    try {
      settler.reject(err);
    } catch {
      /* ignore */
    }
  }
}

export function cancelParserJobs(selector = {}, reason = "cancelled") {
  return cancelActiveParseJob(reason, selector);
}

export function getWorkerPoolSnapshot() {
  return {
    maxConcurrency: WORKER_POOL_MAX_CONCURRENCY,
    running: workerPoolRunning,
    queued: workerPoolQueue.filter((job) => !job.settled).length,
    jobs: [...workerPoolJobs.values()].map((job) => ({
      requestId: job.requestId,
      generation: job.generation,
      fileKind: job.fileKind,
      scopeId: job.scopeId,
      jobType: job.jobType,
      status: job.status,
    })),
  };
}

export function getActiveParseJob() {
  return activeJob ? { ...activeJob } : null;
}

export function getParseQueueSnapshot() {
  return parseQueue.map((job) => ({ ...job }));
}

export function createWorkerParserConfig(type, options = {}) {
  return {
    type,
    workerPath: options.workerPath || null,
    chunkSize: options.chunkSize || 500,
    useWorker: Boolean(options.workerPath),
    memoizeKey: options.memoizeKey || type,
    timeoutMs: options.timeoutMs || 120_000,
  };
}

function runWithTimeout(promise, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Parser zaman aşımına uğradı.")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function executeJob(job, runner) {
  activeJob = job;
  job.status = "running";
  emit({ type: "start", jobId: job.id, jobType: job.type });

  try {
    const result = await runWithTimeout(runner(job.payload, job), job.config?.timeoutMs || 120_000);
    job.status = "done";
    job.result = result;
    emit({ type: "done", jobId: job.id, jobType: job.type, result });
    return result;
  } catch (error) {
    job.status = "failed";
    job.error = error?.message || String(error);
    const isTimeout = /zaman aşımı/i.test(job.error);
    emit({
      type: isTimeout ? "timeout" : "error",
      jobId: job.id,
      jobType: job.type,
      error: job.error,
    });
    throw error;
  } finally {
    activeJob = null;
    activeWorker = null;
  }
}

async function drainQueue(runner) {
  if (processing || !parseQueue.length) return;
  processing = true;

  while (parseQueue.length) {
    const job = parseQueue.shift();
    try {
      await executeJob(job, runner);
    } catch {
      // error already emitted
    }
  }

  processing = false;
}

export function enqueueParseJob(job = {}, runner) {
  const entry = {
    id: job.id || `parse-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    type: job.type || "generic",
    payload: job.payload || {},
    config: job.config || createWorkerParserConfig(job.type || "generic"),
    createdAt: new Date().toISOString(),
    status: "queued",
  };
  parseQueue.push(entry);
  emit({ type: "queued", jobId: entry.id, jobType: entry.type, queueLength: parseQueue.length });
  drainQueue(runner);
  return entry.id;
}

/**
 * ErrorEvent çoğu ortamda JSON/console'da `{}` görünür.
 * Next.js dev overlay console.error + ErrorEvent yüzünden tüm ekranı kapatır.
 * Yalnızca düz JSON-serializable alanlar loglanır.
 */
export function serializeWorkerErrorEvent(errorEvent) {
  const nested = errorEvent?.error;
  return {
    message:
      (typeof errorEvent?.message === "string" && errorEvent.message) ||
      nested?.message ||
      null,
    filename: errorEvent?.filename || null,
    lineno: Number.isFinite(errorEvent?.lineno) ? errorEvent.lineno : null,
    colno: Number.isFinite(errorEvent?.colno) ? errorEvent.colno : null,
    type: errorEvent?.type || null,
    errorName: nested?.name || null,
    errorMessage: nested?.message || null,
    errorStack: nested?.stack ? String(nested.stack).split("\n").slice(0, 4).join("\n") : null,
  };
}

function formatWorkerLoadFailureMessage(detail) {
  const parts = [
    detail.message,
    detail.errorMessage && detail.errorMessage !== detail.message
      ? detail.errorMessage
      : null,
    detail.errorName ? `name=${detail.errorName}` : null,
    detail.filename ? `file=${detail.filename}` : null,
    Number.isFinite(detail.lineno) ? `line=${detail.lineno}` : null,
    Number.isFinite(detail.colno) ? `col=${detail.colno}` : null,
  ].filter(Boolean);

  if (parts.length > 0) return parts.join(" | ");
  return "Worker modülü yüklenemedi (URL/bundle çözümleme hatası). Ana thread fallback kullanılacak.";
}

function makeWorkerRequestId() {
  requestSequence += 1;
  return `worker-${Date.now()}-${requestSequence}`;
}

function responseMatchesJob(message, job) {
  if (message?.requestId !== job.requestId) return false;
  if (job.strictResponseIdentity) {
    return (
      String(message?.generation) === String(job.generation) &&
      message?.fileKind === job.fileKind
    );
  }
  if (
    message?.generation != null &&
    String(message.generation) !== String(job.generation)
  ) {
    return false;
  }
  if (message?.fileKind && message.fileKind !== job.fileKind) return false;
  return true;
}

function drainWorkerPool() {
  while (
    workerPoolRunning < WORKER_POOL_MAX_CONCURRENCY &&
    workerPoolQueue.length
  ) {
    const job = workerPoolQueue.shift();
    if (!job || job.settled || job.cancelled) continue;
    job.start();
  }
}

export function runParserWorker({
  workerUrl,
  payload = {},
  transferables = [],
  onProgress,
  timeoutMs = 120_000,
  jobType = "generic",
  classicWorker = false,
  classicScriptBootstrap = false,
  WorkerImpl = typeof Worker !== "undefined" ? Worker : undefined,
  requestId: requestIdOption,
  generation = 0,
  fileKind = jobType,
  scopeId = "global",
  signal,
  fetchImpl,
  createObjectURL,
  strictResponseIdentity = false,
}) {
  const requestId =
    typeof requestIdOption === "string" && requestIdOption
      ? requestIdOption
      : makeWorkerRequestId();
  const responseKey = `${requestId}::${generation}::${fileKind}`;

  return new Promise((resolve, reject) => {
    if (workerPoolJobs.has(responseKey)) {
      reject(
        Object.assign(new Error("Worker request anahtarı zaten kullanımda."), {
          code: "WORKER_DUPLICATE_REQUEST",
        })
      );
      return;
    }

    const job = {
      requestId,
      responseKey,
      generation,
      fileKind,
      scopeId,
      jobType,
      status: "queued",
      worker: null,
      timer: null,
      revokeBlobUrl: null,
      bootstrapController: null,
      abortHandler: null,
      started: false,
      settled: false,
      cancelled: false,
      strictResponseIdentity,
      finish(mode, value) {
        if (job.settled) {
          parserWorkerRuntimeStats.duplicateResponses += 1;
          return;
        }
        job.settled = true;
        clearTimeout(job.timer);
        job.timer = null;
        try {
          job.bootstrapController?.abort();
        } catch {
          /* ignore */
        }
        job.bootstrapController = null;
        if (signal && job.abortHandler) {
          signal.removeEventListener("abort", job.abortHandler);
        }
        if (job.worker) {
          job.worker.onmessage = null;
          job.worker.onerror = null;
          job.worker.onmessageerror = null;
          try {
            job.worker.terminate();
            parserWorkerRuntimeStats.terminates += 1;
          } catch {
            /* ignore */
          }
          job.worker = null;
        }
        try {
          job.revokeBlobUrl?.();
        } catch {
          /* ignore */
        }
        job.revokeBlobUrl = null;
        workerPoolJobs.delete(responseKey);
        if (job.started) {
          workerPoolRunning = Math.max(0, workerPoolRunning - 1);
        }
        if (mode === "resolve") resolve(value);
        else reject(value);
        queueMicrotask(drainWorkerPool);
      },
      async start() {
        if (job.settled || job.cancelled) return;
        job.started = true;
        job.status = "running";
        workerPoolRunning += 1;
        parserWorkerRuntimeStats.peakWorkers = Math.max(
          parserWorkerRuntimeStats.peakWorkers,
          workerPoolRunning
        );
        emit({
          type: "start",
          jobId: requestId,
          requestId,
          generation,
          fileKind,
          scopeId,
          jobType,
        });

        job.timer = setTimeout(() => {
          if (job.settled) return;
          parserWorkerRuntimeStats.timeouts += 1;
          emit({
            type: "timeout",
            jobId: requestId,
            requestId,
            generation,
            fileKind,
            scopeId,
            jobType,
          });
          job.finish("reject", cancellationError("timeout"));
        }, timeoutMs);

        let resolvedUrl = workerUrl;
        const defaultWorker =
          typeof Worker !== "undefined" ? Worker : undefined;
        const useBootstrap =
          classicWorker &&
          classicScriptBootstrap &&
          WorkerImpl === defaultWorker &&
          typeof (fetchImpl || (typeof fetch !== "undefined" ? fetch : null)) ===
            "function";
        try {
          if (useBootstrap) {
            job.bootstrapController = new AbortController();
            const boot = await bootstrapClassicWorkerScriptUrl(workerUrl, {
              fetchImpl,
              createObjectURL,
              signal: job.bootstrapController.signal,
            });
            if (job.settled) {
              boot.revoke();
              return;
            }
            resolvedUrl = boot.url;
            job.revokeBlobUrl = boot.revoke;
          }
          if (!resolvedUrl) {
            throw Object.assign(new Error("Worker URL tanımsız."), {
              code: "WORKER_UNAVAILABLE",
            });
          }
          if (typeof WorkerImpl !== "function") {
            throw Object.assign(new Error("Worker API kullanılamıyor."), {
              code: "WORKER_UNAVAILABLE",
            });
          }
          job.worker = classicWorker
            ? new WorkerImpl(resolvedUrl)
            : new WorkerImpl(resolvedUrl, { type: "module" });
          parserWorkerRuntimeStats.constructs += 1;
        } catch (error) {
          const err = Object.assign(
            new Error(error?.message || "Worker oluşturulamadı."),
            { code: error?.code || "WORKER_CONSTRUCT_FAILED" }
          );
          job.finish("reject", err);
          return;
        }

        job.worker.onmessage = (event) => {
          const message = event?.data;
          if (!message || typeof message !== "object") {
            parserWorkerRuntimeStats.malformedResponses += 1;
            job.finish(
              "reject",
              Object.assign(new Error("Worker yanıtı geçersiz."), {
                code: "WORKER_PROTOCOL_ERROR",
              })
            );
            return;
          }
          if (message.type === "lifecycle" && !message.requestId) {
            emit({
              ...message,
              type: "lifecycle",
              jobId: requestId,
              jobType,
              scopeId,
            });
            return;
          }
          if (!responseMatchesJob(message, job)) {
            if (!job.strictResponseIdentity) return;
            parserWorkerRuntimeStats.malformedResponses += 1;
            job.finish(
              "reject",
              Object.assign(new Error("Worker yanıt kimliği eşleşmiyor."), {
                code: "WORKER_PROTOCOL_ERROR",
              })
            );
            return;
          }

          const scoped = {
            ...message,
            requestId,
            generation,
            fileKind,
            scopeId,
          };
          if (message.type === "lifecycle") {
            emit({ ...scoped, type: "lifecycle", jobId: requestId, jobType });
            return;
          }
          if (message.type === "progress") {
            onProgress?.(scoped);
            emit({ ...scoped, type: "progress", jobId: requestId, jobType });
            return;
          }
          if (message.type === "success" || message.type === "result") {
            job.status = "done";
            emit({
              type: "done",
              jobId: requestId,
              jobType,
              requestId,
              generation,
              fileKind,
              scopeId,
              result: message,
            });
            job.finish("resolve", scoped);
            return;
          }
          if (message.type === "cancelled") {
            job.finish("reject", cancellationError("cancelled"));
            return;
          }
          if (message.type !== "error") {
            parserWorkerRuntimeStats.malformedResponses += 1;
            job.finish(
              "reject",
              Object.assign(new Error("Worker yanıt türü bilinmiyor."), {
                code: "WORKER_PROTOCOL_ERROR",
              })
            );
            return;
          }
          const errorText =
            message.errorMessage || message.error || "Parser başarısız.";
          const err = new Error(errorText);
          err.code =
            message.errorCode || message.code || "WORKER_PARSE_FAILED";
          err.phase = message.phase || message.stage || null;
          job.finish("reject", err);
        };

        job.worker.onerror = (errorEvent) => {
          const detail = serializeWorkerErrorEvent(errorEvent);
          console.warn("[workerParserBridge] worker.onerror", {
            code: "WORKER_ONERROR",
            type: detail.type,
            errorName: detail.errorName,
          });
          const err = new Error(formatWorkerLoadFailureMessage(detail));
          err.code = "WORKER_ONERROR";
          job.finish("reject", err);
        };

        job.worker.onmessageerror = () => {
          job.finish(
            "reject",
            Object.assign(new Error("Worker mesajı işlenemedi."), {
              code: "WORKER_MESSAGE_ERROR",
            })
          );
        };

        try {
          job.worker.postMessage(
            { requestId, generation, fileKind, ...payload },
            transferables
          );
          parserWorkerRuntimeStats.postMessages += 1;
        } catch (error) {
          job.finish(
            "reject",
            Object.assign(new Error("Worker'a mesaj gönderilemedi."), {
              code: "WORKER_POSTMESSAGE_FAILED",
              cause: error,
            })
          );
        }
      },
    };

    job.abortHandler = () => cancelPoolJob(job, "cancelled");
    if (signal?.aborted) {
      job.cancelled = true;
      job.settled = true;
      reject(cancellationError("cancelled"));
      return;
    }
    signal?.addEventListener("abort", job.abortHandler, { once: true });
    workerPoolJobs.set(responseKey, job);
    workerPoolQueue.push(job);
    parserWorkerRuntimeStats.queued += 1;
    emit({
      type: "queued",
      jobId: requestId,
      requestId,
      generation,
      fileKind,
      scopeId,
      jobType,
      queueLength: workerPoolQueue.filter((item) => !item.settled).length,
    });
    drainWorkerPool();
  });
}

/**
 * Banka Excel worker — ana thread XLSX okur; worker yalnızca sheetRows parse eder.
 * Classic + zero-import worker (Turbopack media bundle etmez).
 */
export function runBankParserWorker({
  workerUrl,
  sheetRows,
  bankName,
  options = {},
  /** @deprecated arrayBuffer artık gönderilmez; ana thread'de okuyun */
  arrayBuffer,
  /** @deprecated selectedBank için bankName kullanın */
  context = {},
  onProgress,
  timeoutMs = 120_000,
}) {
  const resolvedBank = bankName || context?.selectedBank || "";
  if (arrayBuffer && !sheetRows) {
    const err = new Error(
      "runBankParserWorker artık arrayBuffer kabul etmez; sheetRows gönderin (ana thread XLSX)."
    );
    err.code = "WORKER_PROTOCOL";
    return Promise.reject(err);
  }

  return runParserWorker({
    workerUrl,
    jobType: PARSER_JOB_TYPES.BANK_EXCEL,
    classicWorker: true,
    payload: {
      type: "parse",
      bankName: resolvedBank,
      sheetRows,
      options: {
        ...options,
        selectedCompanyId: options.selectedCompanyId ?? context?.selectedCompanyId,
      },
    },
    transferables: [],
    onProgress,
    timeoutMs,
  });
}

export function runLucaExcelWorker({ workerUrl, arrayBuffer, onProgress, timeoutMs = 90_000 }) {
  return runParserWorker({
    workerUrl,
    jobType: PARSER_JOB_TYPES.LUCA_EXCEL,
    payload: { arrayBuffer, mode: "objects" },
    transferables: arrayBuffer ? [arrayBuffer] : [],
    onProgress,
    timeoutMs,
  });
}

export function runEDefterXmlWorker({
  workerUrl,
  arrayBuffer,
  fileName = "",
  companyTaxId = "",
  knownFingerprints = [],
  onProgress,
  timeoutMs = 180_000,
}) {
  return runParserWorker({
    workerUrl,
    jobType: PARSER_JOB_TYPES.EDEFTER_XML,
    payload: { arrayBuffer, fileName, companyTaxId, knownFingerprints, timeoutMs },
    transferables: arrayBuffer ? [arrayBuffer] : [],
    onProgress,
    timeoutMs,
  });
}

export function runEDefterAnalyzeWorker({
  workerUrl,
  payload = {},
  onProgress,
  timeoutMs = 180_000,
  WorkerImpl,
  requestId,
  generation = 0,
  scopeId = "edefter-analyze",
  signal,
}) {
  // Keep nested `payload` so flatten postMessage({ requestId, ...payload })
  // yields { requestId, payload: analyzePayload } for eDefterAnalyze.worker.
  const nested =
    payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "payload")
      ? payload
      : { payload };
  return runParserWorker({
    workerUrl,
    jobType: PARSER_JOB_TYPES.EDEFTER_ANALYZE,
    // Prebundled public/workers IIFE — classic (no module @/ resolution).
    classicWorker: true,
    // Vercel SSO / HTML interstitial: fetch(+cookie) → blob Worker.
    classicScriptBootstrap: true,
    payload: nested,
    onProgress,
    timeoutMs,
    WorkerImpl,
    requestId,
    generation,
    fileKind: "analysis",
    scopeId,
    signal,
    strictResponseIdentity: true,
  });
}

export function runRiskAnalysisWorker({ workerUrl, payload = {}, onProgress, timeoutMs = 180_000 }) {
  return runParserWorker({
    workerUrl,
    jobType: PARSER_JOB_TYPES.RISK_ANALYSIS,
    payload,
    onProgress,
    timeoutMs,
  });
}

export function runFisKontrolWorker({
  workerUrl,
  payload = {},
  onProgress,
  timeoutMs = 120_000,
  WorkerImpl,
  requestId,
  generation = 0,
  scopeId = "fis-kontrol-analyze",
  signal,
}) {
  return runParserWorker({
    workerUrl,
    jobType: PARSER_JOB_TYPES.FIS_KONTROL,
    payload,
    onProgress,
    timeoutMs,
    WorkerImpl,
    requestId,
    generation,
    fileKind: "fis-kontrol",
    scopeId,
    signal,
    // Wrong requestId/generation messages are ignored (not settled as protocol fail).
    // Matching success still requires requestId (+ generation when present).
    strictResponseIdentity: false,
  });
}

export function runExcelSheetWorker({
  workerUrl,
  arrayBuffer,
  mode = "rows",
  onProgress,
  timeoutMs = 90_000,
  /** Backup clone must exist before this transfer is enabled. */
  transferArrayBuffer = true,
  requestId,
  generation = 0,
  fileKind = "excel",
  scopeId = "excel",
  signal,
  WorkerImpl,
}) {
  const resolvedWorkerUrl =
    workerUrl && typeof workerUrl === "object" && typeof workerUrl.href === "string"
      ? workerUrl.href
      : String(workerUrl || "");

  return runParserWorker({
    workerUrl: resolvedWorkerUrl,
    jobType: PARSER_JOB_TYPES.EXCEL_SHEET,
    classicWorker: true,
    classicScriptBootstrap: true,
    payload: { arrayBuffer, mode },
    transferables: transferArrayBuffer && arrayBuffer ? [arrayBuffer] : [],
    onProgress,
    timeoutMs,
    requestId,
    generation,
    fileKind,
    scopeId,
    signal,
    WorkerImpl,
    strictResponseIdentity: true,
  });
}
