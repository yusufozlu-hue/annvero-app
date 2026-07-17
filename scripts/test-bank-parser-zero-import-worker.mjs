/**
 * Zero-import bankParser worker: boot, parse parity, fallback, artifact checks.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-parser-zero-import-worker.mjs
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.join(root, "src/workers/bankParser.worker.js");

function section(title) {
  console.log(`\n== ${title} ==`);
}

function fingerprint(rows) {
  return (rows || []).map((r) =>
    [
      r.banka,
      r.tarih,
      r.dekontNo,
      r.aciklama,
      r.unvan || "",
      Number(r.borc) || 0,
      Number(r.alacak) || 0,
      Number(r.tutar) || 0,
      r.yon,
      r.islemTipi || "",
      r.iban || "",
    ].join("|")
  );
}

function assertSameFingerprints(actual, expected, label) {
  const a = JSON.stringify(fingerprint(actual));
  const b = JSON.stringify(fingerprint(expected));
  assert.equal(a, b, `${label} fingerprint mismatch\n worker=${a}\n   core=${b}`);
}

async function loadCore() {
  const href = pathToFileURL(
    path.join(root, "src/utils/bankParserWorkerCore.js")
  ).href;
  return import(href);
}

/**
 * Eval zero-import classic worker source in a sandbox (Node has no DOM Worker).
 */
function runClassicWorkerParse({ bankName, sheetRows, requestId = "test-1" }) {
  return new Promise((resolve, reject) => {
    const source = readFileSync(workerPath, "utf8");
    let settled = false;
    const finish = (value, isError) => {
      if (settled) return;
      settled = true;
      if (isError) reject(value);
      else resolve(value);
    };

    const self = {
      onmessage: null,
      addEventListener() {},
      postMessage(msg) {
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "progress") return;
        if (msg.type === "result") finish(msg, false);
        else if (msg.type === "error") {
          const err = new Error(msg.errorMessage || msg.error || "worker error");
          err.name = msg.errorName || "Error";
          err.phase = msg.phase;
          err.stack = msg.stack || err.stack;
          finish(err, true);
        }
      },
    };

    const sandbox = {
      self,
      console,
      setTimeout,
      clearTimeout,
      Date,
      Math,
      String,
      Number,
      Array,
      Object,
      Promise,
      RegExp,
      Boolean,
      Error,
      JSON,
      undefined,
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: "bankParser.worker.js" });

    assert.equal(typeof sandbox.self.onmessage, "function", "worker must set onmessage");

    sandbox.self.onmessage({
      data: {
        type: "parse",
        requestId,
        bankName,
        sheetRows,
        options: {},
      },
    });

    setTimeout(() => {
      finish(new Error("worker harness timeout"), true);
    }, 10_000);
  });
}

// ——— Fixtures ———
const vakifRows = [
  ["Hesap No", "TR330001000000000000000001", "", "", "", ""],
  [
    "HESAP HAREKETLERİ",
    "İŞLEM TARİHİ",
    "AÇIKLAMA",
    "FİŞ NO",
    "TUTAR",
    "B/A",
    "BAKİYE",
  ],
  ["", "01.02.2026", "EFT GELEN TEST", "1001", "1500,00", "A", "5000"],
  ["", "02.02.2026", "HAVALE GIDEN TEST", "1002", "200,00", "B", "4800"],
];

const garantiRows = [
  ["Tarih", "Açıklama", "Etiket", "Tutar", "Bakiye", "Dekont No"],
  ["01.03.2026", "EFT ALACAK", "", "1000,00", "1000", "G1"],
  ["02.03.2026", "POS HARCAMASI", "", "-50,00", "950", "G2"],
];

const tebRows = [
  ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye", "İşlem No"],
  ["10.01.2026", "HAVALE REF 998877", "0", "300,00", "1300", "D100"],
  ["10.01.2026", "MASRAF BSMV", "12,00", "", "1288", ""],
];

const ziraatRows = [
  ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"],
  ["11.01.2026", "ZIRAAT HAVALE", "100,00", "", "900"],
  ["12.01.2026", "ZIRAAT TAHSILAT", "", "250,00", "1150"],
];

const kuveytRows = [
  ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"],
  ["13.01.2026", "KUVEYT EFT", "75,00", "", "925"],
  ["14.01.2026", "KUVEYT GELEN", "", "40,00", "965"],
];

section("1) Worker source zero-import");
assert.equal(existsSync(workerPath), true);
const workerSource = readFileSync(workerPath, "utf8");
assert.doesNotMatch(workerSource, /^\s*import\s/m);
assert.doesNotMatch(workerSource, /\bfrom\s+["']xlsx["']/);
assert.doesNotMatch(workerSource, /["']@\//);
assert.doesNotMatch(workerSource, /\bimport\s*\(/);
assert.match(workerSource, /type:\s*["']result["']/);
assert.match(workerSource, /type:\s*["']parse["']/);
console.log("OK — no import / xlsx / @/ / dynamic import()");

section("2) Bridge classicWorker + sheetRows protocol");
const bridgeSource = readFileSync(
  path.join(root, "src/utils/workerParserBridge.js"),
  "utf8"
);
assert.match(bridgeSource, /classicWorker:\s*true/);
assert.match(bridgeSource, /type:\s*["']parse["']/);
assert.match(bridgeSource, /sheetRows/);
assert.match(bridgeSource, /message\.type === "success" \|\| message\.type === "result"/);
assert.match(bridgeSource, /console\.warn\("\[workerParserBridge\] worker\.onerror"/);
console.log("OK — classic worker + result protocol");

section("3) Page: single XLSX + sheetRows to worker / fallback");
const pageSource = readFileSync(
  path.join(root, "app/(annvero)/muhasebe/banka-ekstresi/page.jsx"),
  "utf8"
);
assert.match(pageSource, /sheetRows/);
assert.match(pageSource, /bankName:\s*selectedBank/);
assert.match(pageSource, /parseBankExcelOnMainThread\(file,\s*selectedBank,\s*onProgress,\s*\{\s*sheetRows/);
assert.doesNotMatch(pageSource, /arrayBuffer:\s*workerBuffer/);
assert.doesNotMatch(pageSource, /JSON\.stringify/);
assert.doesNotMatch(pageSource, /JSON\.parse/);
console.log("OK — page wire-up");

section("4) Worker boot + parse: Vakıfbank");
{
  const core = await loadCore();
  const workerResult = await runClassicWorkerParse({
    bankName: "VAKIFBANK",
    sheetRows: vakifRows,
  });
  assert.equal(workerResult.parseMode, "worker");
  assert.ok(workerResult.timings?.totalMs >= 0);
  const coreParsed = core.parseRowsForBank(vakifRows, "VAKIFBANK");
  const coreNorm = coreParsed.map((r) =>
    core.normalizeBankParsedRow(r, "VAKIFBANK")
  );
  assertSameFingerprints(
    workerResult.normalizedRows,
    coreNorm,
    "VAKIFBANK"
  );
  console.log("OK — Vakıfbank parity", {
    rows: workerResult.normalizedRows.length,
  });
}

section("5) Garanti regression");
{
  const core = await loadCore();
  const workerResult = await runClassicWorkerParse({
    bankName: "GARANTI",
    sheetRows: garantiRows,
  });
  const coreNorm = core
    .parseRowsForBank(garantiRows, "GARANTI")
    .map((r) => core.normalizeBankParsedRow(r, "GARANTI"));
  assertSameFingerprints(
    workerResult.normalizedRows,
    coreNorm,
    "GARANTI"
  );
  console.log("OK — Garanti", { rows: workerResult.normalizedRows.length });
}

section("6) TEB regression");
{
  const core = await loadCore();
  const workerResult = await runClassicWorkerParse({
    bankName: "TEB",
    sheetRows: tebRows,
  });
  const coreNorm = core
    .parseRowsForBank(tebRows, "TEB")
    .map((r) => core.normalizeBankParsedRow(r, "TEB"));
  assertSameFingerprints(
    workerResult.normalizedRows,
    coreNorm,
    "TEB"
  );
  assert.ok(
    workerResult.normalizedRows.some((r) => String(r.dekontNo || "").includes("D100") || String(r.dekontNo || "").includes("998877"))
  );
  console.log("OK — TEB", { rows: workerResult.normalizedRows.length });
}

section("7) Ziraat regression");
{
  const core = await loadCore();
  const workerResult = await runClassicWorkerParse({
    bankName: "ZIRAAT",
    sheetRows: ziraatRows,
  });
  const coreNorm = core
    .parseRowsForBank(ziraatRows, "ZIRAAT")
    .map((r) => core.normalizeBankParsedRow(r, "ZIRAAT"));
  assertSameFingerprints(
    workerResult.normalizedRows,
    coreNorm,
    "ZIRAAT"
  );
  console.log("OK — Ziraat", { rows: workerResult.normalizedRows.length });
}

section("8) Kuveyt Türk regression");
{
  const core = await loadCore();
  const workerResult = await runClassicWorkerParse({
    bankName: "KUVEYT",
    sheetRows: kuveytRows,
  });
  const coreNorm = core
    .parseRowsForBank(kuveytRows, "KUVEYT")
    .map((r) => core.normalizeBankParsedRow(r, "KUVEYT"));
  assertSameFingerprints(
    workerResult.normalizedRows,
    coreNorm,
    "KUVEYT"
  );
  console.log("OK — Kuveyt", { rows: workerResult.normalizedRows.length });
}

section("9) Forced failure → main-thread sheetRows fallback (no re-read)");
{
  const { parseBankExcelOnMainThread } = await import(
    pathToFileURL(path.join(root, "src/utils/bankExcelMainThreadParse.js")).href
  );
  let fileArrayBufferCalls = 0;
  const fakeFile = {
    name: "x.xlsx",
    async arrayBuffer() {
      fileArrayBufferCalls += 1;
      throw new Error("must not re-read file");
    },
  };
  const fallback = await parseBankExcelOnMainThread(fakeFile, "TEB", () => {}, {
    sheetRows: tebRows,
  });
  assert.equal(fileArrayBufferCalls, 0);
  assert.equal(fallback.parseMode, "main-thread-fallback");
  assert.ok((fallback.normalizedRows || []).length >= 1);
  console.log("OK — fallback uses sheetRows", {
    rows: fallback.normalizedRows.length,
  });
}

section("10) Worker rejects arrayBuffer-only protocol from bridge helper");
{
  const { runBankParserWorker } = await import(
    pathToFileURL(path.join(root, "src/utils/workerParserBridge.js")).href
  );
  let rejected = false;
  try {
    await runBankParserWorker({
      workerUrl: "blob:unused",
      arrayBuffer: new ArrayBuffer(8),
      context: { selectedBank: "TEB" },
    });
  } catch (error) {
    rejected = true;
    assert.match(String(error?.message || ""), /sheetRows/i);
    assert.equal(error?.code, "WORKER_PROTOCOL");
  }
  assert.equal(rejected, true);
  console.log("OK — arrayBuffer-only rejected");
}

section("11) Field shape sample");
{
  const workerResult = await runClassicWorkerParse({
    bankName: "VAKIFBANK",
    sheetRows: vakifRows,
  });
  const row = workerResult.normalizedRows[0];
  for (const key of [
    "banka",
    "tarih",
    "dekontNo",
    "aciklama",
    "borc",
    "alacak",
    "tutar",
    "yon",
    "islemTipi",
  ]) {
    assert.ok(key in row, `missing field ${key}`);
  }
  console.log("OK — normalized field shape");
}

console.log("\nAll zero-import bank parser worker tests passed.");
