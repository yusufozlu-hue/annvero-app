/**
 * Smoke tests for bank worker URL resolution + ErrorEvent serialization.
 * Run: node scripts/test-bank-parser-worker-bridge.mjs
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function section(title) {
  console.log(`\n== ${title} ==`);
}

section("1) Worker file location");
const workerPath = path.join(root, "src/workers/bankParser.worker.js");
assert.equal(existsSync(workerPath), true, "src/workers/bankParser.worker.js exists");
const oldPath = path.join(
  root,
  "app/muhasebe/banka-ekstresi/bankParser.worker.js"
);
assert.equal(existsSync(oldPath), false, "old app/ worker path removed");
console.log("OK — worker under src/workers");

section("2) parserWorkerUrls exports bankExcel");
const urlsSource = readFileSync(
  path.join(root, "src/utils/parserWorkerUrls.js"),
  "utf8"
);
assert.match(
  urlsSource,
  /bankExcel:\s*new URL\("\.\.\/workers\/bankParser\.worker\.js"/
);
console.log("OK — bankExcel URL pattern");

section("3) page uses PARSER_WORKER_URLS.bankExcel");
const pageSource = readFileSync(
  path.join(root, "app/muhasebe/banka-ekstresi/page.jsx"),
  "utf8"
);
assert.match(pageSource, /PARSER_WORKER_URLS/);
assert.match(pageSource, /workerUrl:\s*PARSER_WORKER_URLS\.bankExcel/);
assert.match(pageSource, /sheetRows/);
assert.match(pageSource, /bankName:\s*selectedBank/);
assert.doesNotMatch(
  pageSource,
  /new URL\("\.\/bankParser\.worker\.js",\s*import\.meta\.url\)/
);
assert.doesNotMatch(pageSource, /arrayBuffer:\s*workerBuffer/);
console.log("OK — page uses sheetRows + PARSER_WORKER_URLS.bankExcel");

section("4) bridge avoids console.error(ErrorEvent) + classic bank worker");
const bridgeSource = readFileSync(
  path.join(root, "src/utils/workerParserBridge.js"),
  "utf8"
);
assert.match(bridgeSource, /serializeWorkerErrorEvent/);
assert.match(bridgeSource, /console\.warn\("\[workerParserBridge\] worker\.onerror"/);
assert.match(bridgeSource, /classicWorker:\s*true/);
assert.match(bridgeSource, /type:\s*["']parse["']/);
assert.doesNotMatch(
  bridgeSource,
  /console\.error\("\[workerParserBridge\] worker\.onerror",\s*detail,\s*error\)/
);
console.log("OK — overlay-safe warn path + classicWorker");

section("5) serializeWorkerErrorEvent fields");
const bridgeUrl = pathToFileURL(
  path.join(root, "src/utils/workerParserBridge.js")
).href;
const { serializeWorkerErrorEvent, runParserWorker } = await import(bridgeUrl);

const emptyLike = serializeWorkerErrorEvent({});
assert.equal(emptyLike.message, null);
assert.equal(emptyLike.filename, null);

const rich = serializeWorkerErrorEvent({
  message: "Script error.",
  filename: "bankParser.worker.js",
  lineno: 12,
  colno: 3,
  type: "error",
  error: {
    name: "SyntaxError",
    message: "Unexpected token",
    stack: "SyntaxError: Unexpected token\n    at worker",
  },
});
assert.equal(rich.message, "Script error.");
assert.equal(rich.filename, "bankParser.worker.js");
assert.equal(rich.lineno, 12);
assert.equal(rich.colno, 3);
assert.equal(rich.errorName, "SyntaxError");
assert.equal(rich.errorMessage, "Unexpected token");
assert.ok(rich.errorStack.includes("SyntaxError"));
console.log("OK — serializable detail", {
  message: rich.message,
  filename: rich.filename,
  lineno: rich.lineno,
});

section("6) Forced worker failure (fallback contract)");
const hasDomWorker =
  typeof globalThis.Worker === "function" &&
  !String(globalThis.Worker).includes("worker_threads");

if (!hasDomWorker) {
  // Node has worker_threads.Worker with a different API — still verify empty URL path.
  let rejected = false;
  try {
    await runParserWorker({
      workerUrl: "",
      payload: {},
      timeoutMs: 1000,
    });
  } catch (error) {
    rejected = true;
    assert.match(
      String(error?.message || ""),
      /Worker URL|Worker oluşturulamadı|Failed/i
    );
  }
  assert.equal(rejected, true);
  console.log(
    "OK — Node environment: empty URL rejects (DOM Worker smoke skipped)"
  );
} else {
  let rejected = false;
  let rejectMessage = "";
  try {
    await runParserWorker({
      workerUrl: "blob:annvero-invalid",
      payload: { ping: 1 },
      timeoutMs: 3000,
      jobType: "test-fallback",
    });
  } catch (error) {
    rejected = true;
    rejectMessage = error?.message || String(error);
  }
  assert.equal(rejected, true, "bad worker must reject for main-thread fallback");
  assert.ok(rejectMessage.length > 0);
  console.log("OK — forced failure rejects:", rejectMessage.slice(0, 120));
}

console.log("\nAll bank parser worker bridge tests passed.");
