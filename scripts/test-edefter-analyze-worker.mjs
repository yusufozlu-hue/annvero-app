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
import fs from "node:fs";
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
  EDEFTER_ANALYZE_JOB_KIND,
  EDEFTER_ANALYZE_PROTOCOL,
} from "@/src/utils/eDefterAnalyzeContract.js";
import {
  analyzeJobStats,
  bumpAnalyzeGeneration,
  resetAnalyzeJobStats,
  runEDefterAnalyzeJob,
} from "@/src/utils/eDefterAnalyzeBridge.js";
import { runGenelMuhasebeKontrol } from "@/src/utils/genelMuhasebeKontrolEngine.js";
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

console.log("10) GENERAL_LEDGER_CONTROL parity + counters + persist=0");
{
  function glSheet(nPairs) {
    const headers = [
      "TARİH",
      "FİŞ NO",
      "YEVMİYE NO",
      "HESAP KODU",
      "AÇIKLAMA",
      "BELGE TÜRÜ",
      "BELGE NO",
      "BORÇ",
      "ALACAK",
    ];
    const body = [];
    for (let i = 0; i < nPairs; i += 1) {
      const fis = String(i + 1);
      body.push(["10.05.2026", fis, fis, "100.01", "anon", "FT", `B${fis}`, "10", "0"]);
      body.push(["10.05.2026", fis, fis, "320.01", "anon", "FT", `B${fis}`, "0", "10"]);
    }
    return [headers, ...body];
  }

  resetAll("success");
  const sheet = glSheet(20);
  const glInput = {
    jobKind: EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL,
    companyId: "gl-co",
    period: "2026/05",
    yevmiyeSheetRows: sheet,
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
  };

  const reference = runGenelMuhasebeKontrol(glInput);
  const generation = bumpAnalyzeGeneration("gl-parity");
  const workerResult = await runEDefterAnalyzeJob(glInput, {
    preferWorker: true,
    WorkerImpl: MockAnalyzeWorker,
    generation,
    requireExclusive: true,
  });

  assert.equal(workerResult.diagnostics?.execution, "worker");
  assert.equal(workerResult.diagnostics?.jobKind, EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL);
  assert.equal(workerResult.diagnostics?.fallback, 0);
  assert.equal(workerResult.diagnostics?.mainThreadAnalyze, 0);
  assert.equal(analyzeJobStats.engineInvocations, 1);
  assert.equal(analyzeJobStats.fallbackAttempts, 0);
  assert.equal(analyzeJobStats.persistAllowed, 0);
  assert.equal(harness.constructs, 1);
  assert.ok(resultsAreParityEqual(reference, workerResult), "GL worker parity vs main reference");
  assert.equal(workerResult.summary?.kesinKarsit, reference.summary?.kesinKarsit);
  assert.equal(workerResult.summary?.toplamFis, reference.summary?.toplamFis);
  console.log("PASS GENERAL_LEDGER_CONTROL parity", {
    constructs: harness.constructs,
    engine: analyzeJobStats.engineInvocations,
    fallback: analyzeJobStats.fallbackAttempts,
    persistAllowed: analyzeJobStats.persistAllowed,
    kesinKarsit: workerResult.summary?.kesinKarsit,
  });
}

console.log("11) GENERAL_LEDGER_CONTROL 1k/10k/100k worker_threads heartbeat");
{
  function glSheet(nPairs) {
    const headers = [
      "TARİH",
      "FİŞ NO",
      "YEVMİYE NO",
      "HESAP KODU",
      "AÇIKLAMA",
      "BELGE TÜRÜ",
      "BELGE NO",
      "BORÇ",
      "ALACAK",
    ];
    const body = [];
    for (let i = 0; i < nPairs; i += 1) {
      const fis = String(i + 1);
      body.push(["10.05.2026", fis, fis, "100.01", "anon", "FT", `B${fis}`, "10", "0"]);
      body.push(["10.05.2026", fis, fis, "320.01", "anon", "FT", `B${fis}`, "0", "10"]);
    }
    return [headers, ...body];
  }

  async function runGlScale(label, pairs) {
    resetAll("success");
    const input = {
      jobKind: EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL,
      companyId: "gl-perf",
      period: "2026/05",
      yevmiyeSheetRows: glSheet(pairs),
      accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
      accountPlanStatus: "loaded",
    };
    const hb = startHeartbeat(8);
    const generation = bumpAnalyzeGeneration(`gl-${label}`);
    const t0 = performance.now();
    const result = await runEDefterAnalyzeJob(input, {
      preferWorker: true,
      workerUrl: "thread://eDefterAnalyze.worker.js",
      WorkerImpl: ThreadAnalyzeWorker,
      generation,
      timeoutMs: 600_000,
    });
    const totalMs = Math.round(performance.now() - t0);
    hb.stop();
    assert.equal(result.diagnostics?.execution, "worker");
    assert.equal(analyzeJobStats.engineInvocations, 1);
    assert.equal(analyzeJobStats.fallbackAttempts, 0);
    assert.equal(analyzeJobStats.persistAllowed, 0);
    assert.equal(harness.constructs, 1);
    assert.ok(hb.state.ticks > 0, `${label} heartbeat ticks`);
    const ids = (result.rows || []).map((r) => r.id).filter(Boolean);
    const dup = ids.length - new Set(ids).size;
    assert.equal(dup, 0, `${label} no duplicate ids`);
    return {
      label,
      rows: result.summary?.toplamSatir,
      totalMs,
      cloneMs: Math.round(harness.lastPostCloneMs || 0),
      payloadBytes: harness.lastPostJsonBytes || 0,
      heartbeatTicks: hb.state.ticks,
      heartbeatMaxGapMs: Math.round(hb.state.maxGapMs),
      engine: analyzeJobStats.engineInvocations,
      fallback: analyzeJobStats.fallbackAttempts,
      constructs: harness.constructs,
      duplicateOutput: dup,
      timing: result.timing || null,
    };
  }

  const s1k = await runGlScale("1k", 500);
  const s10k = await runGlScale("10k", 5000);
  const s100k = await runGlScale("100k", 50000);
  console.log("PASS GENERAL_LEDGER_CONTROL scales", { s1k, s10k, s100k });
}

console.log("12) classic bundled worker asset — no @/ imports; bridge classicWorker");
{
  const bridgeSrc = fs.readFileSync(
    path.resolve("src/utils/workerParserBridge.js"),
    "utf8"
  );
  const urlsSrc = fs.readFileSync(path.resolve("src/utils/parserWorkerUrls.js"), "utf8");
  const pageSrc = fs.readFileSync(
    path.resolve("app/(annvero)/muhasebe/genel-muhasebe-kontrol/page.jsx"),
    "utf8"
  );
  const buildSrc = fs.readFileSync(path.resolve("scripts/run-production-build.mjs"), "utf8");
  const bundlePath = path.resolve("public/workers/eDefterAnalyze.worker.js");
  assert.ok(fs.existsSync(bundlePath), "12 bundled worker exists in public/workers");
  const bundleSrc = fs.readFileSync(bundlePath, "utf8");
  assert.ok(bundleSrc.length > 10_000, "12 bundle is substantial (not media-copy stub)");
  assert.equal(/from\s+["']@\//.test(bundleSrc), false, "12 bundle has no @/ imports");
  assert.equal(/sourceMappingURL/i.test(bundleSrc), false, "12 no sourceMappingURL");
  assert.equal(/process\.env/i.test(bundleSrc), false, "12 no process.env");
  assert.equal(/https?:\/\//i.test(bundleSrc), false, "12 no external http(s) URL");
  assert.match(bridgeSrc, /classicWorker:\s*true/, "12 analyze bridge uses classicWorker");
  assert.match(
    bridgeSrc,
    /classicScriptBootstrap:\s*true/,
    "12 analyze bridge bootstraps classic script via fetch→blob"
  );
  assert.match(
    bridgeSrc,
    /bootstrapClassicWorkerScriptUrl/,
    "12 bootstrap helper present"
  );
  assert.match(urlsSrc, /\/workers\/eDefterAnalyze\.worker\.js/, "12 URL points at public bundle");
  assert.match(buildSrc, /bundle-edefter-analyze-worker/, "12 production build runs bundle first");
  assert.match(pageSrc, /execution === "worker"/, "12 page clears warning on worker success");
  assert.match(
    pageSrc,
    /Analiz worker yedeğe düştü/,
    "12 page keeps fallback warning copy"
  );
  assert.equal(
    /fallbackReasonCode/.test(pageSrc),
    false,
    "12 page does not render fallbackReasonCode"
  );
  const proxySrc = fs.readFileSync(path.resolve("proxy.ts"), "utf8");
  assert.match(proxySrc, /workers\(\?:\/\|\$\)/, "12 proxy excludes /workers from session matcher");
  console.log("PASS classic bundled worker asset", { bytes: bundleSrc.length });
}

console.log("12c) classic bootstrap rejects HTML / accepts JS blob");
{
  const { bootstrapClassicWorkerScriptUrl, parserWorkerRuntimeStats, resetParserWorkerRuntimeStats } =
    await import("@/src/utils/workerParserBridge.js");
  resetParserWorkerRuntimeStats();

  const htmlFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode("<!DOCTYPE html><html><body>vercel login</body></html>").buffer,
  });
  await assert.rejects(
    () =>
      bootstrapClassicWorkerScriptUrl("/workers/eDefterAnalyze.worker.js", {
        fetchImpl: htmlFetch,
      }),
    (err) => err?.code === "WORKER_SCRIPT_HTML",
    "12c HTML body → WORKER_SCRIPT_HTML"
  );
  assert.equal(
    parserWorkerRuntimeStats.classicBootstrapHtmlBlocked >= 1,
    true,
    "12c html blocked counter"
  );

  const jsBody = fs.readFileSync(
    path.resolve("public/workers/eDefterAnalyze.worker.js")
  );
  const created = [];
  const jsFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/javascript; charset=utf-8" },
    arrayBuffer: async () => jsBody.buffer.slice(jsBody.byteOffset, jsBody.byteOffset + jsBody.byteLength),
  });
  const boot = await bootstrapClassicWorkerScriptUrl("/workers/eDefterAnalyze.worker.js", {
    fetchImpl: jsFetch,
    createObjectURL: (blob) => {
      created.push(blob);
      return "blob:test-edefter-worker";
    },
  });
  assert.equal(boot.url, "blob:test-edefter-worker", "12c blob URL returned");
  assert.equal(created.length, 1, "12c one blob created");
  assert.equal(boot.meta.bytes, jsBody.byteLength, "12c byte length preserved");
  boot.revoke();
  console.log("PASS classic bootstrap HTML reject + JS blob");
}

console.log("12b) deterministic + fresh bundle matches committed asset");
{
  const { spawnSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const bundlePath = path.resolve("public/workers/eDefterAnalyze.worker.js");
  const before = fs.readFileSync(bundlePath);
  const run1 = spawnSync(process.execPath, [path.resolve("scripts/bundle-edefter-analyze-worker.mjs")], {
    encoding: "utf8",
  });
  assert.equal(run1.status, 0, `12b bundle run1 ok: ${run1.stderr || run1.stdout}`);
  const mid = fs.readFileSync(bundlePath);
  const run2 = spawnSync(process.execPath, [path.resolve("scripts/bundle-edefter-analyze-worker.mjs")], {
    encoding: "utf8",
  });
  assert.equal(run2.status, 0, `12b bundle run2 ok: ${run2.stderr || run2.stdout}`);
  const after = fs.readFileSync(bundlePath);
  assert.equal(
    createHash("sha256").update(mid).digest("hex"),
    createHash("sha256").update(after).digest("hex"),
    "12b second bundle run is byte-identical (deterministic)"
  );
  assert.equal(
    createHash("sha256").update(before).digest("hex"),
    createHash("sha256").update(after).digest("hex"),
    "12b committed bundle matches fresh rebuild (not stale)"
  );
  console.log("PASS deterministic + non-stale bundle", {
    sha256: createHash("sha256").update(after).digest("hex").slice(0, 16),
    bytes: after.length,
  });
}

console.log("13) fallback reason code + yellow warning contract");
{
  resetAll("error");
  const input = makeInput(20);
  const generation = bumpAnalyzeGeneration("fallback-reason");
  const result = await runEDefterAnalyzeJob(
    {
      ...input,
      jobKind: EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL,
      yevmiyeSheetRows: [
        ["TARİH", "FİŞ NO", "HESAP KODU", "BORÇ", "ALACAK"],
        ["10.05.2026", "1", "100.01", "10", "0"],
        ["10.05.2026", "1", "320.01", "0", "10"],
      ],
    },
    {
      preferWorker: true,
      workerUrl: "mock://eDefterAnalyze.worker.js",
      WorkerImpl: MockAnalyzeWorker,
      generation,
    }
  );
  assert.equal(result.diagnostics?.execution, "main-thread-fallback");
  assert.equal(result.diagnostics?.fallback, 1);
  assert.equal(analyzeJobStats.fallbackAttempts, 1, "13 single fallback attempt");
  assert.ok(analyzeJobStats.lastFallbackReasonCode, "13 reason in telemetry stats");
  assert.equal(
    result.diagnostics?.fallbackReasonCode,
    undefined,
    "13 reason code not in UI/API diagnostics"
  );
  assert.ok(
    result.diagnostics?.performanceWarning,
    "13 real fallback keeps user performance warning"
  );
  assert.equal(
    /yedeğe düştü/.test(result.diagnostics.performanceWarning || ""),
    true,
    "13 yellow warning text on real fallback"
  );

  resetAll("success");
  const ok = await runEDefterAnalyzeJob(
    {
      jobKind: EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL,
      companyId: "gl-warn",
      period: "2026/05",
      yevmiyeSheetRows: [
        ["TARİH", "FİŞ NO", "HESAP KODU", "BORÇ", "ALACAK"],
        ["10.05.2026", "1", "100.01", "10", "0"],
        ["10.05.2026", "1", "320.01", "0", "10"],
      ],
    },
    {
      preferWorker: true,
      WorkerImpl: MockAnalyzeWorker,
      generation: bumpAnalyzeGeneration("no-warn"),
    }
  );
  assert.equal(ok.diagnostics?.execution, "worker");
  assert.equal(ok.diagnostics?.fallback || 0, 0);
  assert.equal(ok.diagnostics?.performanceWarning || "", "", "13 worker success → no yellow warning");
  assert.equal(analyzeJobStats.fallbackAttempts, 0, "13 worker success → no fallback");
  console.log("PASS fallback reason + warning contract", {
    lastFallbackReasonCode: analyzeJobStats.lastFallbackReasonCode || "(cleared on success reset)",
  });
}

console.log("14) clone-safe payload strips ArrayBuffer; detach regression guard");
{
  const buf = new ArrayBuffer(8);
  const safe = buildCloneSafeAnalyzePayload({
    jobKind: EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL,
    companyId: "clone-co",
    muavinSheetRows: [["A"], ["1"]],
    // accidental buffer must not enter wire payload
    rawBuffer: buf,
    arrayBuffer: buf,
  });
  assert.equal(safe.rawBuffer, undefined);
  assert.equal(safe.arrayBuffer, undefined);
  assert.ok(Array.isArray(safe.muavinSheetRows));
  const cloned = structuredClone(safe);
  assert.equal(cloned.jobKind, EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL);
  // Original buffer still usable (no transfer/detach on analyze path).
  assert.equal(buf.byteLength, 8, "14 ArrayBuffer not detached by analyze sanitize");
  console.log("PASS clone-safe + detach guard");
}

console.log("\nAll edefter analyze worker real-path evidence checks passed.");


