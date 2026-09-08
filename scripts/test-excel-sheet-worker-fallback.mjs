/**
 * Excel sheet worker → main-thread fallback (detached buffer regression).
 * Run: npm run test:excel-sheet-worker-fallback
 */
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import {
  EXCEL_READ_STAGE,
  parseExcelUploadFile,
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

// 5) E-Defter UI contract: worker failure + fallback success is success.
{
  const rows = [
    ["Başlık"],
    ...Array.from({ length: 545 }, (_, index) => [`anon-${index + 1}`]),
  ];
  const longName =
    "çok-uzun-muavin-dosya-adı-dar-ekranda-taşmamalı-ve-kısalmalı.xlsx";
  const file = makeXlsxFile(rows, longName);
  const result = await parseExcelUploadFile(file, {
    preferWorker: true,
    workerUrl: "mock://excel-sheet",
    runWorker: async () => {
      throw Object.assign(new Error("Worker modülü yüklenemedi."), {
        code: "WORKER_ONERROR",
      });
    },
    parseRows: (sheetRows) => sheetRows.slice(1),
  });
  assert(result.status === "success", "worker fail + fallback success → success state");
  assert(result.rows.length === 545, "fallback success → 545 parsed rows");
  assert(result.fileName === longName, "fallback success → selected file name preserved");
}

// 6) Worker + fallback failure remains a real error.
{
  const emptyFile = {
    name: "unreadable.xlsx",
    async arrayBuffer() {
      return new ArrayBuffer(0);
    },
  };
  try {
    await parseExcelUploadFile(emptyFile, {
      preferWorker: true,
      workerUrl: "mock://excel-sheet",
      runWorker: async () => {
        throw Object.assign(new Error("Worker modülü yüklenemedi."), {
          code: "WORKER_ONERROR",
        });
      },
      parseRows: (rows) => rows,
    });
    assert(false, "worker + fallback failure should reject");
  } catch (error) {
    assert(
      error.code === EXCEL_READ_STAGE.FALLBACK_PARSE,
      "worker + fallback failure → real error state"
    );
  }
}

// 7) Accessible custom picker keeps native text hidden and filename separate.
{
  const pageSource = fs.readFileSync(
    path.resolve("app/(annvero)/muhasebe/e-defter-kontrol/page.jsx"),
    "utf8"
  );
  assert(/function FilePickerField/.test(pageSource), "custom file picker component exists");
  assert(/htmlFor=\{id\}/.test(pageSource), "file picker label/input relation");
  assert(/className="peer sr-only"/.test(pageSource), "native file input visually hidden");
  assert(/Dosya Seç/.test(pageSource), "single explicit file select label");
  assert(/\{fileName \|\| "Dosya seçilmedi"\}/.test(pageSource), "unselected text separate");
  assert(/min-w-0 flex-1 truncate/.test(pageSource), "long filename ellipsis contract");
  assert(/title=\{fileName \|\| "Dosya seçilmedi"\}/.test(pageSource), "full filename remains discoverable");
  assert(/parserJob\.markSuccess/.test(pageSource), "successful fallback clears error lifecycle");
  assert(/parserJob\.markError\(error\)/.test(pageSource), "total failure marks real error");
  assert(/setToast\(successMessage\)/.test(pageSource), "success toast is not overwritten by worker error");
}

if (failed) {
  console.error(`${failed} FAIL(s)`);
  process.exit(1);
}
console.log("ALL PASSED");
