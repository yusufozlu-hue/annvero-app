/**
 * Worker-ready parser bridge with progress events, cancel, timeout and logging hooks.
 */

const parseQueue = [];
let processing = false;
let activeJob = null;
let activeWorker = null;

const listeners = new Set();

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

export function cancelActiveParseJob(reason = "cancelled") {
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }
  if (activeJob) {
    activeJob.status = "cancelled";
    emit({
      type: "cancelled",
      jobId: activeJob.id,
      jobType: activeJob.type,
      reason,
    });
    activeJob = null;
  }
  processing = false;
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

export function runParserWorker({
  workerUrl,
  payload = {},
  transferables = [],
  onProgress,
  timeoutMs = 120_000,
  jobType = "generic",
}) {
  return new Promise((resolve, reject) => {
    cancelActiveParseJob("replaced");

    const requestId = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const worker = new Worker(workerUrl, { type: "module" });
    activeWorker = worker;
    activeJob = {
      id: requestId,
      type: jobType,
      status: "running",
      startedAt: Date.now(),
    };

    emit({ type: "start", jobId: requestId, jobType });

    const timer = setTimeout(() => {
      cancelActiveParseJob("timeout");
      emit({ type: "timeout", jobId: requestId, jobType });
      reject(new Error("Parser zaman aşımına uğradı."));
    }, timeoutMs);

    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "progress") {
        onProgress?.(message);
        emit({ type: "progress", jobId: requestId, jobType, ...message });
        return;
      }
      if (message.requestId !== requestId) return;

      clearTimeout(timer);
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      activeJob = null;

      if (message.type === "success") {
        emit({ type: "done", jobId: requestId, jobType, result: message });
        resolve(message);
        return;
      }

      if (message.type === "cancelled") {
        emit({ type: "cancelled", jobId: requestId, jobType, reason: message.reason || "cancelled" });
        reject(new Error("İşlem iptal edildi."));
        return;
      }

      emit({ type: "error", jobId: requestId, jobType, error: message.error });
      reject(new Error(message.error || "Parser başarısız."));
    };

    worker.onerror = (error) => {
      clearTimeout(timer);
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      activeJob = null;
      const message = error?.message ? error.message : "Worker beklenmedik şekilde durdu.";
      emit({ type: "error", jobId: requestId, jobType, error: message });
      reject(new Error(message));
    };

    worker.postMessage({ requestId, ...payload }, transferables);
  });
}

export function runBankParserWorker({
  workerUrl,
  arrayBuffer,
  context = {},
  onProgress,
  timeoutMs = 120_000,
}) {
  return runParserWorker({
    workerUrl,
    jobType: PARSER_JOB_TYPES.BANK_EXCEL,
    payload: { arrayBuffer, context },
    transferables: arrayBuffer ? [arrayBuffer] : [],
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

export function runEDefterXmlWorker({ workerUrl, arrayBuffer, fileName = "", onProgress, timeoutMs = 180_000 }) {
  return runParserWorker({
    workerUrl,
    jobType: PARSER_JOB_TYPES.EDEFTER_XML,
    payload: { arrayBuffer, fileName },
    transferables: arrayBuffer ? [arrayBuffer] : [],
    onProgress,
    timeoutMs,
  });
}

export function runEDefterAnalyzeWorker({ workerUrl, payload = {}, onProgress, timeoutMs = 180_000 }) {
  return runParserWorker({
    workerUrl,
    jobType: PARSER_JOB_TYPES.EDEFTER_ANALYZE,
    payload,
    onProgress,
    timeoutMs,
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

export function runFisKontrolWorker({ workerUrl, payload = {}, onProgress, timeoutMs = 120_000 }) {
  return runParserWorker({
    workerUrl,
    jobType: PARSER_JOB_TYPES.FIS_KONTROL,
    payload,
    onProgress,
    timeoutMs,
  });
}

export function runExcelSheetWorker({
  workerUrl,
  arrayBuffer,
  mode = "rows",
  onProgress,
  timeoutMs = 90_000,
}) {
  return runParserWorker({
    workerUrl,
    jobType: PARSER_JOB_TYPES.EXCEL_SHEET,
    payload: { arrayBuffer, mode },
    transferables: arrayBuffer ? [arrayBuffer] : [],
    onProgress,
    timeoutMs,
  });
}
