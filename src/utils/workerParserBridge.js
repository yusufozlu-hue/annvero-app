/**
 * Worker-ready parser bridge with progress events, cancel and timeout.
 */

const parseQueue = [];
let processing = false;
let activeJob = null;
let activeWorker = null;

const listeners = new Set();

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
    emit({ type: "cancelled", jobId: activeJob.id, reason });
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
    emit({ type: "done", jobId: job.id, result });
    return result;
  } catch (error) {
    job.status = "failed";
    job.error = error?.message || String(error);
    emit({ type: "error", jobId: job.id, error: job.error });
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
  emit({ type: "queued", jobId: entry.id, queueLength: parseQueue.length });
  drainQueue(runner);
  return entry.id;
}

export function runBankParserWorker({
  workerUrl,
  arrayBuffer,
  context = {},
  onProgress,
  timeoutMs = 120_000,
}) {
  return new Promise((resolve, reject) => {
    cancelActiveParseJob("replaced");

    const requestId = Date.now();
    const worker = new Worker(workerUrl, { type: "module" });
    activeWorker = worker;

    const timer = setTimeout(() => {
      cancelActiveParseJob("timeout");
      reject(new Error("Banka parser zaman aşımına uğradı."));
    }, timeoutMs);

    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "progress") {
        onProgress?.(message);
        emit({ type: "progress", stage: message.stage, detail: message.detail });
        return;
      }
      if (message.requestId !== requestId) return;
      clearTimeout(timer);
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      if (message.type === "success") resolve(message);
      else reject(new Error(message.error || "Parser başarısız."));
    };

    worker.onerror = (error) => {
      clearTimeout(timer);
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      reject(error?.message ? new Error(error.message) : new Error("Worker beklenmedik şekilde durdu."));
    };

    worker.postMessage({ requestId, arrayBuffer, context }, [arrayBuffer]);
  });
}
