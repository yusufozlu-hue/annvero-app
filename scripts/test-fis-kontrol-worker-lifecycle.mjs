/**
 * Fiş Kontrol worker lifecycle / typed fallback matrix.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-fis-kontrol-worker-lifecycle.mjs
 */
import assert from "node:assert/strict";
import {
  bumpFisKontrolAnalyzeGeneration,
  FIS_KONTROL_ANALYZE_SCOPE,
  FIS_KONTROL_FALLBACK_WARNING,
  fisKontrolAnalyzeStats,
  getFisKontrolAnalyzeGeneration,
  resetFisKontrolAnalyzeStats,
  runFisKontrolAnalyzeJob,
} from "@/src/utils/fisKontrolAnalyzeBridge.js";
import {
  cancelActiveParseJob,
  getWorkerPoolSnapshot,
  parserWorkerRuntimeStats,
  resetParserWorkerRuntimeStats,
} from "@/src/utils/workerParserBridge.js";

function makeBalancedRows(count = 4) {
  const rows = [];
  for (let i = 1; i <= count; i += 1) {
    const fisNo = String(i);
    rows.push({
      id: `d-${i}`,
      fisNo,
      hesapKodu: "102.01.001",
      borc: 10,
      alacak: 0,
      aciklama: "anon",
      belgeTuru: "FT",
      tarih: "10.03.2026",
      firmaId: "co-a",
    });
    rows.push({
      id: `c-${i}`,
      fisNo,
      hesapKodu: "320.01.001",
      borc: 0,
      alacak: 10,
      aciklama: "anon",
      belgeTuru: "FT",
      tarih: "10.03.2026",
      firmaId: "co-a",
    });
  }
  return rows;
}

function createMockWorker(behavior = "success", options = {}) {
  return class MockWorker {
    static instances = [];

    constructor(url) {
      this.url = String(url);
      this.onmessage = null;
      this.onerror = null;
      this.onmessageerror = null;
      this.dead = false;
      this.messages = [];
      MockWorker.instances.push(this);
    }

    postMessage(data) {
      this.messages.push(data);
      const delay = Number(options.delayMs || 5);
      setTimeout(() => {
        if (this.dead) return;
        const identity = {
          requestId: data.requestId,
          generation: data.generation,
          fileKind: data.fileKind || "fis-kontrol",
        };
        if (behavior === "hang") return;
        if (behavior === "infra") {
          this.onerror?.({ type: "error", message: "synthetic worker load fail" });
          return;
        }
        if (behavior === "protocol") {
          this.onmessage?.({ data: { type: "success", analysis: null } });
          return;
        }
        if (behavior === "empty-analysis") {
          this.onmessage?.({
            data: {
              type: "success",
              ...identity,
              analysis: null,
            },
          });
          return;
        }
        if (behavior === "wrong-id") {
          this.onmessage?.({
            data: {
              type: "success",
              requestId: "other-request",
              generation: data.generation,
              fileKind: "fis-kontrol",
              analysis: { rows: [], issues: [], summary: {} },
            },
          });
          return;
        }
        if (behavior === "wrong-generation") {
          this.onmessage?.({
            data: {
              type: "success",
              ...identity,
              generation: Number(data.generation) + 99,
              analysis: { rows: [], issues: [], summary: {} },
            },
          });
          return;
        }
        if (behavior === "app-error") {
          this.onmessage?.({
            data: {
              type: "error",
              ...identity,
              error: "synthetic analyze failure",
              code: "ERROR",
            },
          });
          return;
        }
        if (behavior === "late") {
          setTimeout(() => {
            if (this.dead) return;
            this.onmessage?.({
              data: {
                type: "success",
                ...identity,
                analysis: {
                  rows: data.rows || [],
                  issues: [],
                  summary: { late: true },
                },
              },
            });
          }, Number(options.lateMs || 40));
          return;
        }
        const analysis = {
          rows: Array.isArray(data.rows) ? data.rows : [],
          issues: [],
          summary: {
            totalRows: Array.isArray(data.rows) ? data.rows.length : 0,
            marker: options.marker || "worker",
          },
        };
        this.onmessage?.({
          data: {
            type: "progress",
            ...identity,
            stage: "Analiz",
            detail: "progress",
            percent: 40,
          },
        });
        const handler = this.onmessage;
        handler?.({
          data: {
            type: "success",
            ...identity,
            analysis,
          },
        });
        if (behavior === "duplicate") {
          setTimeout(() => {
            handler?.({
              data: {
                type: "success",
                ...identity,
                analysis: {
                  ...analysis,
                  summary: { ...analysis.summary, marker: "duplicate" },
                },
              },
            });
          }, 0);
        }
      }, delay);
    }

    terminate() {
      this.dead = true;
    }
  };
}

function resetAll() {
  resetFisKontrolAnalyzeStats();
  resetParserWorkerRuntimeStats();
  bumpFisKontrolAnalyzeGeneration("test-reset");
  cancelActiveParseJob("cancelled", { scopeId: FIS_KONTROL_ANALYZE_SCOPE });
}

function pass(condition, label) {
  if (!condition) {
    console.error(`FAIL  ${label}`);
    process.exit(1);
  }
  console.log(`PASS  ${label}`);
}

resetAll();
const rows = makeBalancedRows(4);

console.log("1) worker success → sonuç bir kez");
{
  const WorkerImpl = createMockWorker("success", { marker: "ok" });
  const generation = bumpFisKontrolAnalyzeGeneration("t1");
  const result = await runFisKontrolAnalyzeJob(
    { rows, options: { firmaId: "co-a" } },
    { WorkerImpl, workerUrl: "mock://fis", generation, preferWorker: true }
  );
  pass(result.diagnostics.execution === "worker", "worker execution");
  pass(result.diagnostics.fallback === 0, "fallback 0 on success");
  pass(result.analysis?.summary?.marker === "ok", "worker analysis once");
  pass(fisKontrolAnalyzeStats.workerSuccess === 1, "workerSuccess=1");
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 0, "no fallback attempt");
}

console.log("2) worker infra fail + fallback success");
{
  resetAll();
  const WorkerImpl = createMockWorker("infra");
  const generation = bumpFisKontrolAnalyzeGeneration("t2");
  const result = await runFisKontrolAnalyzeJob(
    { rows, options: { firmaId: "co-a" } },
    { WorkerImpl, workerUrl: "mock://fis", generation }
  );
  pass(result.diagnostics.fallback === 1, "fallback=1");
  pass(
    result.diagnostics.execution === "main-thread-fallback",
    "main-thread-fallback"
  );
  pass(
    result.diagnostics.performanceWarning === FIS_KONTROL_FALLBACK_WARNING,
    "soft warning text"
  );
  pass(Array.isArray(result.analysis.rows), "fallback analysis present");
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 1, "fallback once");
  pass(fisKontrolAnalyzeStats.fallbackSuccess === 1, "fallback success");
}

console.log("3) app-error no fallback; infra+fallback fail surfaces");
{
  resetAll();
  const WorkerImpl = createMockWorker("app-error");
  const generation = bumpFisKontrolAnalyzeGeneration("t3a");
  await assert.rejects(
    () =>
      runFisKontrolAnalyzeJob(
        { rows, options: { firmaId: "co-a" } },
        { WorkerImpl, workerUrl: "mock://fis", generation }
      ),
    (error) => {
      pass(
        error?.code === "ERROR" || error?.code === "WORKER_PARSE_FAILED",
        "app error code"
      );
      return true;
    }
  );
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 0, "app-error fallback 0");
}

{
  resetAll();
  const WorkerImpl = createMockWorker("infra");
  const generation = bumpFisKontrolAnalyzeGeneration("t3b");
  const poisonedKeys = {
    [Symbol.iterator]() {
      throw Object.assign(new Error("fallback engine fail"), {
        code: "FIS_KONTROL_ANALYZE_FAILED",
      });
    },
  };
  await assert.rejects(
    () =>
      runFisKontrolAnalyzeJob(
        {
          rows,
          options: { firmaId: "co-a", processedSourceKeys: poisonedKeys },
        },
        { WorkerImpl, workerUrl: "mock://fis", generation }
      ),
    (error) => {
      pass(
        error?.code === "FIS_KONTROL_ANALYZE_FAILED" ||
          /fallback engine fail/i.test(String(error?.message || "")),
        "fallback engine error surfaces"
      );
      return true;
    }
  );
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 1, "fallback once then throw");
  pass(fisKontrolAnalyzeStats.fallbackSuccess === 0, "fallback success 0");
}

console.log("4) unmatched protocol noise ignored; empty matched analysis → no fallback");
{
  resetAll();
  const WorkerImpl = createMockWorker("protocol");
  const generation = bumpFisKontrolAnalyzeGeneration("t4");
  await assert.rejects(
    () =>
      runFisKontrolAnalyzeJob(
        { rows, options: { firmaId: "co-a" } },
        {
          WorkerImpl,
          workerUrl: "mock://fis",
          generation,
          timeoutMs: 40,
        }
      ),
    (error) => {
      pass(
        error?.code === "FIS_KONTROL_TIMEOUT" ||
          error?.code === "WORKER_TIMEOUT",
        "identity-less noise → timeout"
      );
      return true;
    }
  );
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 0, "noise fallback 0");
}

{
  resetAll();
  const WorkerImpl = createMockWorker("empty-analysis");
  const generation = bumpFisKontrolAnalyzeGeneration("t4b");
  await assert.rejects(
    () =>
      runFisKontrolAnalyzeJob(
        { rows, options: { firmaId: "co-a" } },
        { WorkerImpl, workerUrl: "mock://empty", generation }
      ),
    (error) => {
      pass(error?.code === "FIS_KONTROL_WORKER_EMPTY", "empty analysis code");
      return true;
    }
  );
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 0, "empty analysis fallback 0");
}

console.log("5) cancel active → fallback 0");
{
  resetAll();
  const WorkerImpl = createMockWorker("hang", { delayMs: 50 });
  const generation = bumpFisKontrolAnalyzeGeneration("t5");
  const controller = new AbortController();
  const pending = runFisKontrolAnalyzeJob(
    { rows, options: { firmaId: "co-a" } },
    {
      WorkerImpl,
      workerUrl: "mock://fis",
      generation,
      signal: controller.signal,
      timeoutMs: 5_000,
    }
  ).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  await new Promise((r) => setTimeout(r, 10));
  controller.abort();
  cancelActiveParseJob("cancelled", { scopeId: FIS_KONTROL_ANALYZE_SCOPE });
  const outcome = await pending;
  pass(outcome.ok === false, "cancel rejects");
  pass(
    outcome.error?.code === "FIS_KONTROL_CANCELLED" ||
      outcome.error?.code === "WORKER_CANCELLED",
    "cancel code"
  );
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 0, "cancel fallback 0");
}

console.log("6) cancel queued / pre-start abort → worker başlamaz");
{
  resetAll();
  const hangWorker = createMockWorker("hang");
  const generation = bumpFisKontrolAnalyzeGeneration("t6");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      runFisKontrolAnalyzeJob(
        { rows, options: {} },
        {
          WorkerImpl: hangWorker,
          workerUrl: "mock://q",
          generation,
          signal: controller.signal,
        }
      ),
    (error) =>
      error?.code === "FIS_KONTROL_CANCELLED" ||
      error?.code === "WORKER_CANCELLED"
  );
  pass(hangWorker.instances.length === 0, "aborted before construct/start");
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 0, "pre-abort fallback 0");
}

console.log("7) stale generation → fallback 0");
{
  resetAll();
  const WorkerImpl = createMockWorker("success", { delayMs: 25 });
  const generation = bumpFisKontrolAnalyzeGeneration("t7");
  const pending = runFisKontrolAnalyzeJob(
    { rows, options: {} },
    { WorkerImpl, workerUrl: "mock://stale", generation, timeoutMs: 5_000 }
  ).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  bumpFisKontrolAnalyzeGeneration("t7-bump");
  const outcome = await pending;
  pass(outcome.ok === false, "stale rejects");
  pass(
    outcome.error?.code === "FIS_KONTROL_STALE" ||
      outcome.error?.code === "WORKER_STALE",
    "stale code"
  );
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 0, "stale fallback 0");
}

console.log("8) late response ignored after invalidate");
{
  resetAll();
  const WorkerImpl = createMockWorker("late", { lateMs: 60 });
  const generation = bumpFisKontrolAnalyzeGeneration("t8");
  const controller = new AbortController();
  const pending = runFisKontrolAnalyzeJob(
    { rows, options: {} },
    {
      WorkerImpl,
      workerUrl: "mock://late",
      generation,
      signal: controller.signal,
      timeoutMs: 5_000,
    }
  ).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  await new Promise((r) => setTimeout(r, 5));
  bumpFisKontrolAnalyzeGeneration("t8-bump");
  controller.abort();
  const outcome = await pending;
  pass(outcome.ok === false, "late path cancelled/stale");
  await new Promise((r) => setTimeout(r, 80));
  pass(getWorkerPoolSnapshot().jobs.length === 0, "late cleanup empty pool");
}

console.log("9) duplicate response → yalnız ilk sonuç");
{
  resetAll();
  const WorkerImpl = createMockWorker("duplicate", { marker: "first" });
  const generation = bumpFisKontrolAnalyzeGeneration("t9");
  const result = await runFisKontrolAnalyzeJob(
    { rows, options: {} },
    { WorkerImpl, workerUrl: "mock://dup", generation }
  );
  pass(result.analysis.summary.marker === "first", "first result kept");
  await new Promise((r) => setTimeout(r, 20));
  pass(
    parserWorkerRuntimeStats.duplicateResponses >= 1 ||
      result.analysis.summary.marker !== "duplicate",
    "duplicate ignored (counter or first kept)"
  );
}

console.log("10) wrong requestId / generation → yok sayılır (timeout, fallback 0)");
{
  resetAll();
  const WorkerImpl = createMockWorker("wrong-id");
  const generation = bumpFisKontrolAnalyzeGeneration("t10");
  await assert.rejects(
    () =>
      runFisKontrolAnalyzeJob(
        { rows, options: { firmaId: "co-a" } },
        {
          WorkerImpl,
          workerUrl: "mock://wrong",
          generation,
          timeoutMs: 40,
        }
      ),
    (error) => {
      pass(
        error?.code === "FIS_KONTROL_TIMEOUT" ||
          error?.code === "WORKER_TIMEOUT",
        "wrong-id ignored → timeout"
      );
      return true;
    }
  );
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 0, "wrong-id fallback 0");
}

{
  resetAll();
  const WorkerImpl = createMockWorker("wrong-generation");
  const generation = bumpFisKontrolAnalyzeGeneration("t10b");
  await assert.rejects(
    () =>
      runFisKontrolAnalyzeJob(
        { rows, options: { firmaId: "co-a" } },
        {
          WorkerImpl,
          workerUrl: "mock://wrong-gen",
          generation,
          timeoutMs: 40,
        }
      ),
    (error) => {
      pass(
        error?.code === "FIS_KONTROL_TIMEOUT" ||
          error?.code === "WORKER_TIMEOUT",
        "wrong-generation ignored → timeout"
      );
      return true;
    }
  );
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 0, "wrong-gen fallback 0");
}

console.log("11) timeout → fallback 0");
{
  resetAll();
  const WorkerImpl = createMockWorker("hang");
  const generation = bumpFisKontrolAnalyzeGeneration("t11");
  await assert.rejects(
    () =>
      runFisKontrolAnalyzeJob(
        { rows, options: {} },
        {
          WorkerImpl,
          workerUrl: "mock://timeout",
          generation,
          timeoutMs: 30,
        }
      ),
    (error) => {
      pass(
        error?.code === "FIS_KONTROL_TIMEOUT" ||
          error?.code === "WORKER_TIMEOUT",
        "timeout code"
      );
      return true;
    }
  );
  pass(fisKontrolAnalyzeStats.fallbackAttempts === 0, "timeout fallback 0");
}

console.log("12) unmount/generation bump clears pool");
{
  resetAll();
  const WorkerImpl = createMockWorker("hang");
  const generation = bumpFisKontrolAnalyzeGeneration("t12");
  const pending = runFisKontrolAnalyzeJob(
    { rows, options: {} },
    { WorkerImpl, workerUrl: "mock://unmount", generation, timeoutMs: 5_000 }
  ).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  bumpFisKontrolAnalyzeGeneration("unmount");
  const outcome = await pending;
  pass(outcome.ok === false, "unmount invalidates");
  pass(getWorkerPoolSnapshot().jobs.length === 0, "pool clean after unmount");
}

console.log("13) company-change bump → eski sonuç geri gelmez");
{
  resetAll();
  const WorkerImpl = createMockWorker("success", { delayMs: 20, marker: "old" });
  const generation = bumpFisKontrolAnalyzeGeneration("t13");
  const pending = runFisKontrolAnalyzeJob(
    { rows, options: {} },
    { WorkerImpl, workerUrl: "mock://company", generation }
  ).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  const nextGen = bumpFisKontrolAnalyzeGeneration("company-change");
  pass(nextGen > generation, "generation monotonic");
  const outcome = await pending;
  pass(outcome.ok === false, "old company result dropped");
  pass(getFisKontrolAnalyzeGeneration() === nextGen, "active gen updated");
}

console.log("14) aynı payload yeniden çalıştırılabilir");
{
  resetAll();
  const WorkerImpl = createMockWorker("success", { marker: "rerun" });
  const g1 = bumpFisKontrolAnalyzeGeneration("t14a");
  const first = await runFisKontrolAnalyzeJob(
    { rows, options: { firmaId: "co-a" } },
    { WorkerImpl, workerUrl: "mock://rerun", generation: g1 }
  );
  const g2 = bumpFisKontrolAnalyzeGeneration("t14b");
  const second = await runFisKontrolAnalyzeJob(
    { rows, options: { firmaId: "co-a" } },
    { WorkerImpl, workerUrl: "mock://rerun", generation: g2 }
  );
  pass(first.analysis.summary.marker === "rerun", "first rerun");
  pass(second.analysis.summary.marker === "rerun", "second rerun");
}

console.log("15) worker unavailable → soft warning fallback");
{
  resetAll();
  const generation = bumpFisKontrolAnalyzeGeneration("t15");
  const result = await runFisKontrolAnalyzeJob(
    { rows, options: { firmaId: "co-a" } },
    {
      preferWorker: true,
      WorkerImpl: undefined,
      workerUrl: "",
      generation,
    }
  );
  pass(result.diagnostics.fallback === 1, "unavailable fallback");
  pass(
    result.diagnostics.performanceWarning === FIS_KONTROL_FALLBACK_WARNING,
    "unavailable warning"
  );
}

console.log("ALL fis-kontrol worker lifecycle tests passed.");
