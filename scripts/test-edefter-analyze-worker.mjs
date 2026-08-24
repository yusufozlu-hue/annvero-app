/**
 * E-Defter analyze — real Worker wiring / heartbeat / cancel / clone evidence.
 *
 * Mock Worker speaks the same postMessage contract as eDefterAnalyze.worker.js
 * and runs executeEDefterAnalyzePayload once. This exercises
 * UI→bridge→runParserWorker→new Worker→nested payload→engine→response,
 * not a stub of runEDefterAnalyzeJob itself.
 *
 * Run:
 *   node --import ./scripts/_alias-loader.mjs ./scripts/test-edefter-analyze-worker.mjs
 */

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";

import { E_DEFTER_KAYNAK } from "@/src/config/eDefterKontrolDefaults.js";
import {
  buildCloneSafeAnalyzePayload,
  executeEDefterAnalyzePayload,
  resultsAreParityEqual,
  sanitizeAnalyzeResult,
  EDEFTER_ANALYZE_PROTOCOL,
} from "@/src/utils/eDefterAnalyzeContract.js";
import {
  analyzeJobStats,
  bumpAnalyzeGeneration,
  resetAnalyzeJobStats,
  runEDefterAnalyzeJob,
} from "@/src/utils/eDefterAnalyzeBridge.js";
import {
  parserWorkerRuntimeStats,
  resetParserWorkerRuntimeStats,
  cancelActiveParseJob,
} from "@/src/utils/workerParserBridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALIAS_LOADER = pathToFileURL(path.join(__dirname, "_alias-loader.mjs")).href;
const THREAD_WORKER_URL = pathToFileURL(
  path.join(__dirname, "_edefter-analyze-thread-worker.mjs")
).href;

const harness = {
  mode: "success",
  constructs: 0,
  terminates: 0,
  postMessages: 0,
  lastPosted: null,
  nestedPayloadSeen: 0,
  engineInvocations: 0,
  delayMs: 5,
  lastPostCloneMs: 0,
  lastPostJsonBytes: 0,
};

function resetHarness(mode = "success") {
  harness.mode = mode;
  harness.constructs = 0;
  harness.terminates = 0;
  harness.postMessages = 0;
  harness.lastPosted = null;
  harness.nestedPayloadSeen = 0;
  harness.engineInvocations = 0;
  harness.delayMs = 5;
  harness.lastPostCloneMs = 0;
  harness.lastPostJsonBytes = 0;
}

class MockAnalyzeWorker {
  constructor(url) {
    harness.constructs += 1;
    this.url = String(url);
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this._dead = false;
    this._timer = null;
  }

  postMessage(data) {
    if (this._dead) return;
    harness.postMessages += 1;
    harness.lastPosted = data;
    const requestId = data?.requestId;
    const protocolVersion = Number(data?.protocolVersion || 0);
    const payload =
      data?.payload && typeof data.payload === "object" && !Array.isArray(data.payload)
        ? data.payload
        : null;
    if (payload) harness.nestedPayloadSeen += 1;

    this._timer = setTimeout(() => {
      this._timer = null;
      void (async () => {
        if (this._dead) return;
        if (harness.mode === "hang") return;

        if (harness.mode === "error") {
          this.onmessage?.({
            data: {
              type: "error",
              requestId,
              error: "synthetic worker failure",
              code: "ANALYZE_WORKER_FAILED",
            },
          });
          return;
        }

        if (harness.mode === "malformed") {
          this.onmessage?.({
            data: {
              type: "success",
              requestId,
              result: { ok: true, summary: { edefterUygun: true } },
            },
          });
          return;
        }

        if (!requestId) {
          this.onmessage?.({
            data: {
              type: "error",
              requestId,
              error: "Analyze requestId zorunlu.",
              code: "ANALYZE_REQUEST_ID_MISSING",
            },
          });
          return;
        }

        if (protocolVersion && protocolVersion !== EDEFTER_ANALYZE_PROTOCOL) {
          this.onmessage?.({
            data: {
              type: "error",
              requestId,
              error: "Analyze worker protokol sürümü uyuşmuyor.",
              code: "ANALYZE_PROTOCOL_MISMATCH",
            },
          });
          return;
        }

        if (!payload) {
          this.onmessage?.({
            data: {
              type: "error",
              requestId,
              error: "Analyze payload zorunlu.",
              code: "ANALYZE_PAYLOAD_MISSING",
            },
          });
          return;
        }

        try {
          harness.engineInvocations += 1;
          const started = performance.now();
          const raw = await executeEDefterAnalyzePayload(payload);
          const result = sanitizeAnalyzeResult(raw, {
            execution: "worker",
            engineInvocations: 1,
            elapsedMs: Math.round(performance.now() - started),
          });
          if (this._dead) return;
          this.onmessage?.({
            data: { type: "success", requestId, result, ...result },
          });
        } catch (error) {
          if (this._dead) return;
          this.onmessage?.({
            data: {
              type: "error",
              requestId,
              error: error?.message || "worker failed",
              code: error?.code || "ANALYZE_WORKER_FAILED",
            },
          });
        }
      })();
    }, harness.delayMs);
  }

  terminate() {
    if (this._dead) return;
    this._dead = true;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    harness.terminates += 1;
  }
}

/**
 * Browser Worker API shim over node:worker_threads.
 * Engine runs off the main event loop — heartbeat evidence.
 */
class ThreadAnalyzeWorker {
  constructor(url) {
    harness.constructs += 1;
    this.url = String(url);
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this._dead = false;
    this._node = new NodeWorker(new URL(THREAD_WORKER_URL), {
      execArgv: [`--import=${ALIAS_LOADER}`],
    });
    this._node.on("message", (data) => {
      if (this._dead) return;
      this.onmessage?.({ data });
    });
    this._node.on("error", (error) => {
      if (this._dead) return;
      this.onerror?.(error);
    });
  }

  postMessage(data) {
    if (this._dead) return;
    harness.postMessages += 1;
    const t0 = performance.now();
    const cloned = structuredClone(data);
    harness.lastPostCloneMs = performance.now() - t0;
    harness.lastPostJsonBytes = Buffer.byteLength(JSON.stringify(cloned));
    harness.lastPosted = cloned;
    if (cloned?.payload) harness.nestedPayloadSeen += 1;
    this._node.postMessage(cloned);
  }

  terminate() {
    if (this._dead) return;
    this._dead = true;
    harness.terminates += 1;
    void this._node.terminate();
  }
}

function row(partial = {}) {
  return {
    id: partial.id || `r-${Math.random().toString(16).slice(2, 8)}`,
    kaynak: E_DEFTER_KAYNAK.YEVMIYE_XML,
    fisNo: partial.fisNo || "1",
    yevmiyeNo: partial.yevmiyeNo || "1",
    belgeNo: partial.belgeNo || "B1",
    belgeTarihi: "2026-05-15",
    fisTarihi: "2026-05-15",
    hesapKodu: partial.hesapKodu || "100.01",
    hesapAdi: "Kasa",
    aciklama: "sentetik",
    borc: partial.borc ?? 100,
    alacak: partial.alacak ?? 0,
    tutar: partial.tutar ?? 100,
    paraBirimi: "TRY",
    companyId: "synth-co",
    period: "2026/05",
    ...partial,
  };
}

function makeBalancedPairs(count) {
  const yevmiyeRows = [];
  for (let i = 0; i < count; i += 1) {
    const fisNo = String(Math.floor(i / 2) + 1);
    const isDebit = i % 2 === 0;
    yevmiyeRows.push(
      row({
        id: `y-${i}`,
        fisNo,
        yevmiyeNo: fisNo,
        belgeNo: `B-${fisNo}`,
        hesapKodu: isDebit ? "100.01" : "320.01",
        hesapAdi: isDebit ? "Kasa" : "Tedarikciler",
        borc: isDebit ? 100 : 0,
        alacak: isDebit ? 0 : 100,
        tutar: 100,
      })
    );
  }
  return yevmiyeRows;
}

function makeInput(count) {
  return {
    yevmiyeRows: makeBalancedPairs(count),
    companyId: "synth-co",
    companyTaxId: "0000000000",
    period: "2026/05",
    coreDecision: { decision_source: "CORE", source: "CORE" },
  };
}

async function runMainReference(input) {
  const raw = await executeEDefterAnalyzePayload(buildCloneSafeAnalyzePayload(input));
  return sanitizeAnalyzeResult(raw, {
    execution: "main-thread-reference",
    engineInvocations: 1,
  });
}

function startHeartbeat(intervalMs = 10) {
  const state = { ticks: 0, maxGapMs: 0, last: performance.now() };
  const id = setInterval(() => {
    const now = performance.now();
    state.maxGapMs = Math.max(state.maxGapMs, now - state.last);
    state.last = now;
    state.ticks += 1;
  }, intervalMs);
  return {
    state,
    stop() {
      clearInterval(id);
    },
  };
}

function measureClone(payload) {
  const jsonBytes = Buffer.byteLength(JSON.stringify(payload));
  const t0 = performance.now();
  const cloned = structuredClone(payload);
  const cloneMs = performance.now() - t0;
  return { jsonBytes, cloneMs, rows: cloned?.yevmiyeRows?.length || 0 };
}

function resetAll(mode = "success") {
  resetHarness(mode);
  resetAnalyzeJobStats();
  resetParserWorkerRuntimeStats();
  cancelActiveParseJob("test-reset");
  bumpAnalyzeGeneration("test-reset");
}

function totalTerminates() {
  return harness.terminates + parserWorkerRuntimeStats.terminates;
}

console.log("1) real Worker path: construct + nested payload + engine=1 + fallback=0");
{
  resetAll("success");
  const input = makeInput(200);
  const reference = await runMainReference(input);
  const generation = bumpAnalyzeGeneration("worker-path");
  const result = await runEDefterAnalyzeJob(input, {
    preferWorker: true,
    workerUrl: "mock://eDefterAnalyze.worker.js",
    WorkerImpl: MockAnalyzeWorker,
    generation,
    timeoutMs: 30_000,
  });

  assert.equal(harness.constructs, 1);
  assert.equal(harness.postMessages, 1);
  assert.equal(harness.nestedPayloadSeen, 1);
  assert.ok(harness.lastPosted?.payload);
  assert.ok(harness.lastPosted?.requestId);
  assert.equal(harness.lastPosted?.protocolVersion, EDEFTER_ANALYZE_PROTOCOL);
  assert.equal(harness.engineInvocations, 1);
  assert.equal(analyzeJobStats.workerAttempts, 1);
  assert.equal(analyzeJobStats.workerSuccess, 1);
  assert.equal(analyzeJobStats.fallbackAttempts, 0);
  assert.equal(analyzeJobStats.engineInvocations, 1);
  assert.equal(result.diagnostics?.execution, "worker");
  assert.equal(result.diagnostics?.requestId, harness.lastPosted.requestId);
  assert.equal(result.diagnostics?.generation, generation);
  assert.ok(resultsAreParityEqual(reference, result));
  assert.ok(totalTerminates() >= 1);
  console.log("PASS real worker path", {
    constructs: harness.constructs,
    engine: harness.engineInvocations,
    fallback: analyzeJobStats.fallbackAttempts,
    terminates: totalTerminates(),
  });
}

console.log("2) malformed worker response → fail-closed + single fallback");
{
  resetAll("malformed");
  const input = makeInput(40);
  const generation = bumpAnalyzeGeneration("malformed");
  const result = await runEDefterAnalyzeJob(input, {
    preferWorker: true,
    workerUrl: "mock://eDefterAnalyze.worker.js",
    WorkerImpl: MockAnalyzeWorker,
    generation,
  });
  assert.equal(harness.constructs, 1);
  assert.equal(analyzeJobStats.malformedRejected, 1);
  assert.equal(analyzeJobStats.fallbackAttempts, 1);
  assert.equal(analyzeJobStats.fallbackSuccess, 1);
  assert.equal(analyzeJobStats.engineInvocations, 1);
  assert.equal(result.diagnostics?.execution, "main-thread-fallback");
  assert.equal(analyzeJobStats.persistAllowed, 1);
  console.log("PASS malformed → one fallback");
}

console.log("3) worker error → single fallback");
{
  resetAll("error");
  const input = makeInput(40);
  const generation = bumpAnalyzeGeneration("error");
  const result = await runEDefterAnalyzeJob(input, {
    preferWorker: true,
    workerUrl: "mock://eDefterAnalyze.worker.js",
    WorkerImpl: MockAnalyzeWorker,
    generation,
  });
  assert.equal(analyzeJobStats.fallbackAttempts, 1);
  assert.equal(analyzeJobStats.engineInvocations, 1);
  assert.equal(analyzeJobStats.persistAllowed, 1);
  assert.equal(result.diagnostics?.fallback, 1);
  console.log("PASS worker error → one fallback");
}

console.log("4) timeout → terminate + at most one fallback");
{
  resetAll("hang");
  harness.delayMs = 60_000;
  const input = makeInput(20);
  const generation = bumpAnalyzeGeneration("timeout");
  const result = await runEDefterAnalyzeJob(input, {
    preferWorker: true,
    workerUrl: "mock://eDefterAnalyze.worker.js",
    WorkerImpl: MockAnalyzeWorker,
    generation,
    timeoutMs: 40,
  });
  assert.equal(harness.constructs, 1);
  assert.ok(totalTerminates() >= 1);
  assert.equal(analyzeJobStats.fallbackAttempts, 1);
  assert.equal(analyzeJobStats.engineInvocations, 1);
  assert.equal(result.diagnostics?.execution, "main-thread-fallback");
  console.log("PASS timeout → terminate + one fallback", { terminates: totalTerminates() });
}

console.log("5) double-click click-lock: second start blocked (constructs===1)");
{
  resetAll("success");
  harness.delayMs = 40;
  const input = makeInput(80);
  const generation = bumpAnalyzeGeneration("click-lock");
  const first = runEDefterAnalyzeJob(input, {
    preferWorker: true,
    workerUrl: "mock://eDefterAnalyze.worker.js",
    WorkerImpl: MockAnalyzeWorker,
    generation,
    requireExclusive: true,
  });
  const secondOutcome = await runEDefterAnalyzeJob(input, {
    preferWorker: true,
    workerUrl: "mock://eDefterAnalyze.worker.js",
    WorkerImpl: MockAnalyzeWorker,
    generation,
    requireExclusive: true,
  }).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  assert.equal(secondOutcome.ok, false);
  assert.equal(secondOutcome.error?.code, "ANALYZE_IN_FLIGHT");
  assert.equal(harness.constructs, 1, "second click must not construct another worker");
  const firstResult = await first;
  assert.equal(firstResult.diagnostics?.execution, "worker");
  assert.equal(firstResult.diagnostics?.engineInvocations, 1);
  assert.equal(analyzeJobStats.engineInvocations, 1);
  assert.equal(analyzeJobStats.workerSuccess, 1);
  assert.equal(analyzeJobStats.persistAllowed, 1);
  assert.equal(harness.constructs, 1);
  console.log("PASS double-click click-lock", {
    constructs: harness.constructs,
    engine: analyzeJobStats.engineInvocations,
    persistAllowed: analyzeJobStats.persistAllowed,
    secondCode: secondOutcome.error?.code,
  });
}

console.log("6) company/file change terminates worker; stale not persisted");
{
  resetAll("success");
  harness.delayMs = 40;
  const input = makeInput(60);
  const g1 = bumpAnalyzeGeneration("job");
  const pending = runEDefterAnalyzeJob(input, {
    preferWorker: true,
    workerUrl: "mock://eDefterAnalyze.worker.js",
    WorkerImpl: MockAnalyzeWorker,
    generation: g1,
  });
  const pendingOutcome = pending.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  const before = totalTerminates();
  bumpAnalyzeGeneration("company-change");
  assert.ok(totalTerminates() > before);
  const settled = await pendingOutcome;
  assert.equal(settled.ok, false);
  assert.equal(settled.error?.code, "ANALYZE_STALE");
  assert.equal(analyzeJobStats.persistAllowed, 0);
  console.log("PASS company-change terminate + no persist");
}

console.log("7) cancel/abort → no persist");
{
  resetAll("success");
  harness.delayMs = 40;
  const input = makeInput(40);
  const controller = new AbortController();
  const generation = bumpAnalyzeGeneration("cancel-job");
  const pending = runEDefterAnalyzeJob(input, {
    preferWorker: true,
    workerUrl: "mock://eDefterAnalyze.worker.js",
    WorkerImpl: MockAnalyzeWorker,
    generation,
    signal: controller.signal,
  });
  const pendingOutcome = pending.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  controller.abort();
  bumpAnalyzeGeneration("cancel");
  const settled = await pendingOutcome;
  assert.equal(settled.ok, false);
  assert.ok(
    settled.error?.code === "ANALYZE_CANCELLED" || settled.error?.code === "ANALYZE_STALE"
  );
  assert.equal(analyzeJobStats.persistAllowed, 0);
  console.log("PASS cancel → no persist");
}

console.log("8) 100k worker_threads path: heartbeat + engine=1 + fallback=0 + parity + clone cost");
{
  resetAll("success");
  const input = makeInput(100_000);
  const safe = buildCloneSafeAnalyzePayload(input);
  const cloneInfo = measureClone(safe);
  const memBefore = process.memoryUsage();
  const reference = await runMainReference(input);

  const hb = startHeartbeat(8);
  const generation = bumpAnalyzeGeneration("100k-worker");
  const t0 = performance.now();
  const result = await runEDefterAnalyzeJob(input, {
    preferWorker: true,
    workerUrl: "thread://eDefterAnalyze.worker.js",
    WorkerImpl: ThreadAnalyzeWorker,
    generation,
    timeoutMs: 300_000,
  });
  const totalMs = Math.round(performance.now() - t0);
  hb.stop();
  const memAfter = process.memoryUsage();
  const analyzeMs = Math.max(
    0,
    totalMs - Math.round(harness.lastPostCloneMs || 0)
  );

  assert.equal(harness.constructs, 1);
  assert.equal(harness.postMessages, 1);
  assert.equal(harness.nestedPayloadSeen, 1);
  assert.equal(analyzeJobStats.fallbackAttempts, 0);
  assert.equal(analyzeJobStats.engineInvocations, 1);
  assert.equal(analyzeJobStats.workerSuccess, 1);
  assert.equal(result.diagnostics?.execution, "worker");
  assert.equal(result.diagnostics?.requestId, harness.lastPosted.requestId);
  assert.equal(result.diagnostics?.generation, generation);
  assert.ok(resultsAreParityEqual(reference, result));
  const cloneMs = Math.round(harness.lastPostCloneMs || cloneInfo.cloneMs || 0);
  // ~30MB structured clone is an expected main-thread cost; analyze itself must not
  // monopolize the event loop (fallback reference shows ticks≈0 for full duration).
  const cloneBoundMs = Math.max(4_000, cloneMs * 1.35);
  assert.ok(
    hb.state.ticks >= 20,
    `expected responsive heartbeat ticks, got ${hb.state.ticks}`
  );
  assert.ok(
    hb.state.maxGapMs < cloneBoundMs,
    `heartbeat gap ${hb.state.maxGapMs}ms exceeds clone-bound ${cloneBoundMs}ms`
  );
  assert.ok(
    totalMs > 0 && hb.state.maxGapMs < totalMs * 0.55,
    "analyze must not fully block main thread for the whole duration"
  );
  assert.ok(
    analyzeMs > 1_000 && hb.state.ticks > Math.floor(analyzeMs / 40),
    "heartbeat must keep ticking while worker analyzes off-thread"
  );

  console.log("PASS 100k worker_threads harness", {
    totalMs,
    postMessageCloneMs: cloneMs,
    analyzeMsApprox: analyzeMs,
    preCloneMs: Math.round(cloneInfo.cloneMs),
    jsonBytes: harness.lastPostJsonBytes || cloneInfo.jsonBytes,
    approxMb: Number(
      ((harness.lastPostJsonBytes || cloneInfo.jsonBytes) / (1024 * 1024)).toFixed(2)
    ),
    heartbeatTicks: hb.state.ticks,
    heartbeatMaxGapMs: Math.round(hb.state.maxGapMs),
    cloneBoundMs: Math.round(cloneBoundMs),
    heapUsedDeltaMb: Number(
      ((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2)
    ),
    rssDeltaMb: Number(((memAfter.rss - memBefore.rss) / (1024 * 1024)).toFixed(2)),
    engine: analyzeJobStats.engineInvocations,
    fallback: analyzeJobStats.fallbackAttempts,
    parity: true,
  });
}

console.log("9) fallback reference (NOT worker perf): main-thread 100k");
{
  resetAll("success");
  const input = makeInput(100_000);
  const hb = startHeartbeat(8);
  const t0 = performance.now();
  const result = await runEDefterAnalyzeJob(input, {
    preferWorker: false,
    generation: bumpAnalyzeGeneration("fallback-ref"),
  });
  const totalMs = Math.round(performance.now() - t0);
  hb.stop();
  assert.equal(result.diagnostics?.execution, "main-thread");
  assert.equal(analyzeJobStats.engineInvocations, 1);
  console.log("INFO fallback-reference (main-thread)", {
    totalMs,
    heartbeatTicks: hb.state.ticks,
    heartbeatMaxGapMs: Math.round(hb.state.maxGapMs),
    note: "Node main-thread path only — not worker performance",
  });
}

console.log("\nAll edefter analyze worker real-path evidence checks passed.");
