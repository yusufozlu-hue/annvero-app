import assert from "node:assert/strict";
import {
  bootstrapClassicWorkerScriptUrl,
  cancelParserJobs,
  getWorkerPoolSnapshot,
  parserWorkerRuntimeStats,
  resetParserWorkerRuntimeStats,
  runParserWorker,
} from "@/src/utils/workerParserBridge.js";

const runtime = {
  active: 0,
  peak: 0,
  starts: [],
  finishes: [],
};

class PoolWorker {
  constructor(url) {
    this.url = String(url);
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this.dead = false;
    runtime.active += 1;
    runtime.peak = Math.max(runtime.peak, runtime.active);
  }

  postMessage(data) {
    runtime.starts.push(data.fileKind);
    const delay = Number(data.delayMs || 0);
    setTimeout(() => {
      if (this.dead) return;
      if (data.behavior === "hang") return;
      if (data.behavior === "crash") {
        this.onerror?.({ type: "error", message: "synthetic bootstrap crash" });
        return;
      }
      if (data.behavior === "malformed") {
        this.onmessage?.({ data: { unexpected: true } });
        return;
      }
      const handler = this.onmessage;
      const identity = {
        requestId: data.requestId,
        generation: data.generation,
        fileKind: data.fileKind,
      };
      handler?.({
        data: {
          type: "progress",
          ...identity,
          detail: `${data.fileKind}-progress`,
        },
      });
      handler?.({
        data: {
          type: "success",
          ...identity,
          rows: [[data.fileKind]],
        },
      });
      if (data.behavior === "duplicate") {
        handler?.({
          data: {
            type: "success",
            ...identity,
            rows: [["duplicate"]],
          },
        });
      }
      runtime.finishes.push(data.fileKind);
    }, delay);
  }

  terminate() {
    if (this.dead) return;
    this.dead = true;
    runtime.active = Math.max(0, runtime.active - 1);
  }
}

function run(fileKind, options = {}) {
  return runParserWorker({
    workerUrl: "mock://pool",
    WorkerImpl: PoolWorker,
    requestId: options.requestId || `request-${fileKind}`,
    generation: options.generation ?? 7,
    fileKind,
    scopeId: options.scopeId || "pool-test",
    strictResponseIdentity: true,
    timeoutMs: options.timeoutMs || 2_000,
    signal: options.signal,
    onProgress: options.onProgress,
    payload: {
      delayMs: options.delayMs || 0,
      behavior: options.behavior || "success",
    },
  });
}

console.log("1) three files route correctly with max concurrency=2");
resetParserWorkerRuntimeStats();
const progress = [];
const [muavin, yevmiye, mizan] = await Promise.all([
  run("muavin", { delayMs: 35, onProgress: (event) => progress.push(event) }),
  run("yevmiye", { delayMs: 10, onProgress: (event) => progress.push(event) }),
  run("mizan", { delayMs: 1, onProgress: (event) => progress.push(event) }),
]);
assert.equal(muavin.rows[0][0], "muavin");
assert.equal(yevmiye.rows[0][0], "yevmiye");
assert.equal(mizan.rows[0][0], "mizan");
assert.equal(parserWorkerRuntimeStats.peakWorkers, 2);
assert.equal(runtime.peak, 2);
assert.equal(runtime.finishes[0], "yevmiye", "out-of-order completion is isolated");
assert.deepEqual(
  progress.map((event) => event.fileKind).sort(),
  ["mizan", "muavin", "yevmiye"]
);
assert.equal(getWorkerPoolSnapshot().jobs.length, 0);

console.log("2) queued job cancellation never starts");
const queuedController = new AbortController();
const first = run("queue-a", { delayMs: 40, requestId: "queue-a" });
const second = run("queue-b", { delayMs: 40, requestId: "queue-b" });
const queued = run("queue-c", {
  delayMs: 1,
  requestId: "queue-c",
  signal: queuedController.signal,
}).then(
  () => ({ ok: true }),
  (error) => ({ ok: false, error })
);
queuedController.abort();
const queuedResult = await queued;
assert.equal(queuedResult.ok, false);
assert.equal(queuedResult.error?.code, "WORKER_CANCELLED");
assert.equal(runtime.starts.includes("queue-c"), false);
await Promise.all([first, second]);
assert.equal(getWorkerPoolSnapshot().jobs.length, 0);

console.log("3) crash isolation, malformed response, timeout cleanup");
const isolated = await Promise.allSettled([
  run("crash", { behavior: "crash", requestId: "crash" }),
  run("healthy", { delayMs: 5, requestId: "healthy" }),
]);
assert.equal(isolated[0].status, "rejected");
assert.equal(isolated[0].reason?.code, "WORKER_ONERROR");
assert.equal(isolated[1].status, "fulfilled");
await assert.rejects(
  () => run("malformed", { behavior: "malformed", requestId: "malformed" }),
  (error) => error?.code === "WORKER_PROTOCOL_ERROR"
);
await assert.rejects(
  () =>
    run("timeout", {
      behavior: "hang",
      requestId: "timeout",
      timeoutMs: 20,
    }),
  (error) => error?.code === "WORKER_TIMEOUT"
);
assert.equal(getWorkerPoolSnapshot().jobs.length, 0);

console.log("4) duplicate response settles once");
const duplicateBefore = parserWorkerRuntimeStats.duplicateResponses;
const duplicate = await run("duplicate", {
  behavior: "duplicate",
  requestId: "duplicate",
});
assert.equal(duplicate.rows[0][0], "duplicate");
assert.equal(
  parserWorkerRuntimeStats.duplicateResponses,
  duplicateBefore + 1
);

console.log("5) bootstrap fetch cancellation is typed and leaves no job");
const bootstrapController = new AbortController();
const bootstrap = bootstrapClassicWorkerScriptUrl("/workers/mock.js", {
  signal: bootstrapController.signal,
  fetchImpl: async (_url, options = {}) =>
    new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        "abort",
        () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        },
        { once: true }
      );
    }),
});
bootstrapController.abort();
await assert.rejects(
  () => bootstrap,
  (error) => error?.code === "WORKER_CANCELLED"
);

cancelParserJobs({ scopeId: "pool-test" }, "test-cleanup");
assert.equal(getWorkerPoolSnapshot().jobs.length, 0);
console.log("ALL PASSED");
