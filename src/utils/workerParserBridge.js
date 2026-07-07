/**
 * Worker-ready parser bridge — queue implementation deferred.
 * Call sites can enqueue parse jobs; main thread runs until worker is wired.
 */

const parseQueue = [];
let processing = false;

export function enqueueParseJob(job) {
  const entry = {
    id: job.id || `parse-${Date.now()}`,
    type: job.type || "generic",
    payload: job.payload || {},
    createdAt: new Date().toISOString(),
    status: "queued",
  };
  parseQueue.push(entry);
  drainQueue(job.runner);
  return entry.id;
}

async function drainQueue(runner) {
  if (processing || !parseQueue.length) return;
  processing = true;

  while (parseQueue.length) {
    const job = parseQueue.shift();
    job.status = "running";
    try {
      if (typeof runner === "function") {
        job.result = await runner(job.payload);
      }
      job.status = "done";
    } catch (error) {
      job.status = "failed";
      job.error = error?.message || String(error);
    }
  }

  processing = false;
}

export function getParseQueueSnapshot() {
  return [...parseQueue];
}

export function createWorkerParserConfig(type, options = {}) {
  return {
    type,
    workerPath: options.workerPath || null,
    chunkSize: options.chunkSize || 500,
    useWorker: Boolean(options.workerPath),
    memoizeKey: options.memoizeKey || type,
  };
}
