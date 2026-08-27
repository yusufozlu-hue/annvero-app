/**
 * Excel sheet worker → main-thread fallback (detached buffer regression).
 * Run: npm run test:excel-sheet-worker-fallback
 */
import * as XLSX from "xlsx";
import {
  EXCEL_READ_STAGE,
  readExcelSheetRowsFromFile,
} from "@/src/utils/readExcelSheetWithWorkerFallback.js";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else {
    console.log(`PASS  ${msg}`);
  }
}

function makeXlsxFile(rows, name = "fixture.xlsx") {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const written = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const bytes =
    written instanceof ArrayBuffer
      ? new Uint8Array(written)
      : written instanceof Uint8Array
        ? written
        : Uint8Array.from(written);
  let arrayBufferCalls = 0;
  return {
    name,
    bytes,
    get arrayBufferCalls() {
      return arrayBufferCalls;
    },
    async arrayBuffer() {
      arrayBufferCalls += 1;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

// 1) Worker load failure → fallback re-reads file and parses
{
  const rows = [
    ["Tarih", "Fiş", "Hesap", "Borç", "Alacak"],
    ["01.01.2026", "1", "100.01", "10", "0"],
  ];
  const file = makeXlsxFile(rows, "worker-load-fail.xlsx");
  const parsed = await readExcelSheetRowsFromFile(file, {
    preferWorker: true,
    workerUrl: "https://example.invalid/excelSheet.worker.js",
    runWorker: async ({ arrayBuffer, transferArrayBuffer }) => {
      assert(transferArrayBuffer === false, "worker path disables buffer transfer");
      arrayBuffer.transfer?.();
      throw Object.assign(new Error("Worker modülü yüklenemedi."), {
        code: "WORKER_ONERROR",
      });
    },
  });
  assert(Array.isArray(parsed) && parsed.length === 2, "worker load fail → fallback rows");
  assert(file.arrayBufferCalls === 2, "worker fail → fresh file read on fallback");
}

// 1b) Default preferWorker=false → main thread only (no worker call)
{
  const rows = [
    ["Tarih", "Fiş"],
    ["01.01.2026", "1"],
  ];
  const file = makeXlsxFile(rows, "main-thread-default.xlsx");
  let workerCalled = false;
  const parsed = await readExcelSheetRowsFromFile(file, {
    workerUrl: "https://example.invalid/should-not-run.js",
    runWorker: async () => {
      workerCalled = true;
      throw new Error("worker should not run");
    },
  });
  assert(workerCalled === false, "default path skips worker");
  assert(parsed.length === 2, "default main-thread rows");
  assert(file.arrayBufferCalls === 1, "default path single file read");
}

// 2) Worker parse failure after transfer → fallback succeeds
{
  const rows = [
    ["A", "B"],
    ["x", "y"],
    ["1", "2"],
  ];
  const file = makeXlsxFile(rows, "worker-parse-fail.xlsx");
  const parsed = await readExcelSheetRowsFromFile(file, {
    preferWorker: true,
    workerUrl: "mock://excel-sheet",
    runWorker: async ({ arrayBuffer }) => {
      assert(arrayBuffer.byteLength > 0, "worker receives cloned buffer");
      throw Object.assign(new Error("Parse failed in worker."), { code: "WORKER_PARSE_FAILED" });
    },
  });
  assert(parsed.length === 3, "worker parse fail → fallback row count");
  assert(parsed[1][0] === "x", "worker parse fail → fallback content");
}

// 3) Detached primary buffer forces file re-read on fallback
{
  const rows = [["H1"], ["data"]];
  const base = makeXlsxFile(rows, "detached-primary.xlsx");
  let calls = 0;
  const file = {
    name: base.name,
    async arrayBuffer() {
      calls += 1;
      const fresh = await base.arrayBuffer();
      if (calls === 1) {
        try {
          new MessageChannel().port1.postMessage(fresh, [fresh]);
        } catch {
          /* ignore */
        }
        return fresh;
      }
      return fresh;
    },
  };

  const parsed = await readExcelSheetRowsFromFile(file, {
    preferWorker: true,
    workerUrl: "mock://excel-sheet",
    runWorker: async () => {
      throw Object.assign(new Error("Worker crashed."), { code: "WORKER_ONERROR" });
    },
  });
  assert(parsed.length === 2, "detached primary → re-read fallback");
  assert(calls >= 2, "detached primary triggers file.arrayBuffer re-read");
}

// 4) Error codes preserved on total failure
{
  const emptyFile = {
    name: "empty.xlsx",
    async arrayBuffer() {
      return new ArrayBuffer(0);
    },
  };
  try {
    await readExcelSheetRowsFromFile(emptyFile, { workerUrl: null });
    assert(false, "empty buffer should fail");
  } catch (error) {
    assert(error.code === EXCEL_READ_STAGE.FALLBACK_PARSE, "empty file → EXCEL_FALLBACK_PARSE");
  }
}

if (failed) {
  console.error(`${failed} FAIL(s)`);
  process.exit(1);
}
console.log("ALL PASSED");
