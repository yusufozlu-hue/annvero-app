import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";

import {
  excelReadRuntimeStats,
  readExcelSheetRowsFromFile,
  resetExcelReadRuntimeStats,
} from "@/src/utils/readExcelSheetWithWorkerFallback.js";
import {
  parserWorkerRuntimeStats,
  resetParserWorkerRuntimeStats,
} from "@/src/utils/workerParserBridge.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const loaderUrl = pathToFileURL(path.join(scriptDir, "_alias-loader.mjs")).href;
const workerUrl = pathToFileURL(
  path.join(scriptDir, "_excel-sheet-thread-worker.mjs")
).href;

class ExcelThreadWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this.dead = false;
    this.worker = new NodeWorker(new URL(workerUrl), {
      execArgv: [`--import=${loaderUrl}`],
    });
    this.worker.on("message", (data) => {
      if (!this.dead) this.onmessage?.({ data });
    });
    this.worker.on("error", (error) => {
      if (!this.dead) this.onerror?.(error);
    });
    this.worker.on("messageerror", () => {
      if (!this.dead) this.onmessageerror?.();
    });
  }

  postMessage(data, transferables = []) {
    this.worker.postMessage(data, transferables);
  }

  terminate() {
    if (this.dead) return;
    this.dead = true;
    void this.worker.terminate();
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function heartbeat(intervalMs = 5) {
  const state = { ticks: 0, maxGapMs: 0, last: performance.now() };
  const timer = setInterval(() => {
    const now = performance.now();
    state.maxGapMs = Math.max(state.maxGapMs, now - state.last);
    state.last = now;
    state.ticks += 1;
  }, intervalMs);
  return {
    state,
    stop() {
      clearInterval(timer);
    },
  };
}

const desktop = path.join(process.env.USERPROFILE || "", "Desktop");
const fixtures = [
  {
    fileKind: "muavin",
    path: process.env.MARE_MUAVIN_SMOKE || path.join(desktop, "muavin_mare.xlsx"),
  },
  {
    fileKind: "yevmiye",
    path:
      process.env.LUCA_YEVMIYE_SMOKE ||
      path.join(desktop, "yevmiye_defteri_mare.xlsx"),
  },
  {
    fileKind: "mizan",
    path: process.env.MARE_MIZAN_SMOKE || path.join(desktop, "mizan_mare.xlsx"),
  },
];

for (const fixture of fixtures) {
  assert.equal(fs.existsSync(fixture.path), true, `${fixture.fileKind} fixture missing`);
}

resetExcelReadRuntimeStats();
resetParserWorkerRuntimeStats();
const report = [];

for (const fixture of fixtures) {
  const bytes = fs.readFileSync(fixture.path);
  const hashPrefix = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const repeats = [];
  for (let runIndex = 0; runIndex < 3; runIndex += 1) {
    const file = {
      async arrayBuffer() {
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        );
      },
    };
    const hb = heartbeat();
    const rssBefore = process.memoryUsage().rss;
    const startedAt = performance.now();
    const result = await readExcelSheetRowsFromFile(file, {
      workerUrl: "thread://excelSheet.worker.js",
      WorkerImpl: ExcelThreadWorker,
      includeMetadata: true,
      requestId: `benchmark-${fixture.fileKind}-${runIndex + 1}`,
      generation: 1,
      fileKind: fixture.fileKind,
      scopeId: "phase8c-benchmark",
      timeoutMs: 300_000,
    });
    const totalMs = performance.now() - startedAt;
    const rssDelta = process.memoryUsage().rss - rssBefore;
    hb.stop();
    assert.equal(result.status, "worker");
    assert.ok(result.rows.length > 0);
    repeats.push({
      totalMs,
      heartbeatMaxGapMs: hb.state.maxGapMs,
      heartbeatTicks: hb.state.ticks,
      rssDelta,
      rowCount: result.rows.length,
    });
  }
  report.push({
    fileKind: fixture.fileKind,
    hashPrefix,
    rowCount: repeats[0].rowCount,
    medianTotalMs: Math.round(median(repeats.map((run) => run.totalMs))),
    medianHeartbeatMaxGapMs: Math.round(
      median(repeats.map((run) => run.heartbeatMaxGapMs))
    ),
    medianHeartbeatTicks: median(repeats.map((run) => run.heartbeatTicks)),
    medianRssDeltaMb: Number(
      (median(repeats.map((run) => run.rssDelta)) / (1024 * 1024)).toFixed(2)
    ),
  });
}

assert.equal(excelReadRuntimeStats.mainThreadParses, 0);
assert.equal(excelReadRuntimeStats.fallbackAttempts, 0);
assert.equal(excelReadRuntimeStats.workerSuccess, 9);
assert.ok(parserWorkerRuntimeStats.peakWorkers <= 2);

console.log(
  JSON.stringify(
    {
      status: "PHASE8C_EXCEL_WORKER_BENCHMARK_PASS",
      repeats: 3,
      mainThreadParses: excelReadRuntimeStats.mainThreadParses,
      fallbackAttempts: excelReadRuntimeStats.fallbackAttempts,
      peakWorkers: parserWorkerRuntimeStats.peakWorkers,
      report,
    },
    null,
    2
  )
);
