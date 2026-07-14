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

export function runParserWorker({
  workerUrl,
  payload = {},
  transferables = [],
  onProgress,
  timeoutMs = 120_000,
  jobType = "generic",
  /**
   * bankParser zero-import classic Worker: Turbopack media kopyası module
   * evaluation (bare/`@/` import) yapamaz. Diğer worker'lar module kalır.
   */
  classicWorker = false,
}) {
  return new Promise((resolve, reject) => {
    cancelActiveParseJob("replaced");

    const requestId = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    let worker;
    try {
      if (!workerUrl) {
        throw new Error("Worker URL tanımsız.");
      }
      worker = classicWorker
        ? new Worker(workerUrl)
        : new Worker(workerUrl, { type: "module" });
    } catch (constructError) {
      const message =
        constructError?.message ||
        "Worker oluşturulamadı (new Worker başarısız).";
      console.warn("[workerParserBridge] Worker construct failed", {
        message,
        workerUrl: String(workerUrl || ""),
      });
      const err = new Error(message);
      err.code = "WORKER_CONSTRUCT_FAILED";
      reject(err);
      return;
    }

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

      if (message.type === "success" || message.type === "result") {
        emit({ type: "done", jobId: requestId, jobType, result: message });
        resolve(message);
        return;
      }

      if (message.type === "cancelled") {
        emit({ type: "cancelled", jobId: requestId, jobType, reason: message.reason || "cancelled" });
        reject(new Error("İşlem iptal edildi."));
        return;
      }

      const errorText =
        message.errorMessage || message.error || "Parser başarısız.";
      emit({
        type: "error",
        jobId: requestId,
        jobType,
        error: errorText,
        phase: message.phase || message.stage || null,
      });
      const err = new Error(errorText);
      if (message.errorCode) err.code = message.errorCode;
      if (message.errorName) err.name = message.errorName;
      if (message.phase) err.phase = message.phase;
      if (message.stack) err.stack = message.stack;
      reject(err);
    };

    worker.onerror = (errorEvent) => {
      clearTimeout(timer);
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      activeJob = null;

      const detail = serializeWorkerErrorEvent(errorEvent);
      const message = formatWorkerLoadFailureMessage(detail);
      // Managed fallback path — do not console.error ErrorEvent (Next overlay).
      console.warn("[workerParserBridge] worker.onerror", {
        ...detail,
        workerUrl: String(workerUrl || ""),
        resolvedMessage: message,
      });

      emit({ type: "error", jobId: requestId, jobType, error: message, detail });
      const err = new Error(message);
      err.code = "WORKER_ONERROR";
      err.detail = detail;
      reject(err);
    };

    worker.onmessageerror = (errorEvent) => {
      clearTimeout(timer);
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      activeJob = null;
      const detail = serializeWorkerErrorEvent(errorEvent);
      const message =
        detail.message ||
        detail.errorMessage ||
        "Worker mesajı işlenemedi (structured clone / serializable olmayan veri).";
      console.warn("[workerParserBridge] worker.onmessageerror", {
        ...detail,
        resolvedMessage: message,
      });
      emit({ type: "error", jobId: requestId, jobType, error: message, detail });
      const err = new Error(message);
      err.code = "WORKER_MESSAGE_ERROR";
      reject(err);
    };

    try {
      worker.postMessage({ requestId, ...payload }, transferables);
    } catch (postError) {
      clearTimeout(timer);
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      activeJob = null;
      const message =
        postError?.message ||
        "Worker'a mesaj gönderilemedi (transferable / clone hatası).";
      console.warn("[workerParserBridge] postMessage failed", { message });
      const err = new Error(message);
      err.code = "WORKER_POSTMESSAGE_FAILED";
      reject(err);
    }
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
