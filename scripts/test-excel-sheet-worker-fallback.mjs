/**
 * Excel sheet worker → main-thread fallback (detached buffer regression).
 * Run: npm run test:excel-sheet-worker-fallback
 */
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import {
  EXCEL_READ_STAGE,
  excelReadRuntimeStats,
  parseExcelUploadFile,
  readExcelSheetRowsFromFile,
  resetExcelReadRuntimeStats,
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

async function assertRejects(run, expectedCode, msg) {
  try {
    await run();
    assert(false, msg);
  } catch (error) {
    assert(error?.code === expectedCode, msg);
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

// 0) Normal worker success performs zero main-thread XLSX parses.
{
  resetExcelReadRuntimeStats();
  const rows = [["H1"], ["worker-data"]];
  const file = makeXlsxFile(rows, "worker-success.xlsx");
  const parsed = await readExcelSheetRowsFromFile(file, {
    workerUrl: "mock://excel-sheet",
    runWorker: async ({ arrayBuffer }) => {
      assert(arrayBuffer.byteLength > 0, "worker success receives primary buffer");
      return { rows, metadata: { rowCount: rows.length } };
    },
  });
  assert(parsed[1][0] === "worker-data", "worker success returns routed rows");
  assert(excelReadRuntimeStats.workerSuccess === 1, "worker success counted");
  assert(excelReadRuntimeStats.mainThreadParses === 0, "worker success → main parse 0");
  assert(excelReadRuntimeStats.fallbackAttempts === 0, "worker success → fallback 0");
}

// 1) Worker load failure → prepared clone is parsed exactly once
{
  resetExcelReadRuntimeStats();
  const rows = [
    ["Tarih", "Fiş", "Hesap", "Borç", "Alacak"],
    ["01.01.2026", "1", "100.01", "10", "0"],
  ];
  const file = makeXlsxFile(rows, "worker-load-fail.xlsx");
  const parsed = await readExcelSheetRowsFromFile(file, {
    preferWorker: true,
    workerUrl: "https://example.invalid/excelSheet.worker.js",
    runWorker: async ({ arrayBuffer, transferArrayBuffer }) => {
      assert(transferArrayBuffer === true, "worker path transfers primary buffer");
      structuredClone(arrayBuffer, { transfer: [arrayBuffer] });
      throw Object.assign(new Error("Worker modülü yüklenemedi."), {
        code: "WORKER_ONERROR",
      });
    },
  });
  assert(Array.isArray(parsed) && parsed.length === 2, "worker load fail → fallback rows");
  assert(file.arrayBufferCalls === 1, "worker fail → prepared clone avoids second file read");
  assert(excelReadRuntimeStats.fallbackAttempts === 1, "worker fail → one fallback");
  assert(excelReadRuntimeStats.mainThreadParses === 1, "worker fail → one main-thread parse");
}

// 1b) Explicit test-only main-thread mode skips worker
{
  const rows = [
    ["Tarih", "Fiş"],
    ["01.01.2026", "1"],
  ];
  const file = makeXlsxFile(rows, "main-thread-default.xlsx");
  let workerCalled = false;
  const parsed = await readExcelSheetRowsFromFile(file, {
    preferWorker: false,
    workerUrl: "https://example.invalid/should-not-run.js",
    runWorker: async () => {
      workerCalled = true;
      throw new Error("worker should not run");
    },
  });
  assert(workerCalled === false, "explicit main-thread path skips worker");
  assert(parsed.length === 2, "explicit main-thread rows");
  assert(file.arrayBufferCalls === 1, "explicit main-thread path single file read");
}

// 2) Worker parse/validation failure is a real error; fallback is forbidden
{
  resetExcelReadRuntimeStats();
  const rows = [
    ["A", "B"],
    ["x", "y"],
    ["1", "2"],
  ];
  const file = makeXlsxFile(rows, "worker-parse-fail.xlsx");
  await assertRejects(
    () =>
      readExcelSheetRowsFromFile(file, {
        preferWorker: true,
        workerUrl: "mock://excel-sheet",
        runWorker: async ({ arrayBuffer }) => {
          assert(arrayBuffer.byteLength > 0, "worker receives readable primary buffer");
          throw Object.assign(new Error("Parse failed in worker."), {
            code: "WORKER_PARSE_FAILED",
          });
        },
      }),
    "WORKER_PARSE_FAILED",
    "worker parse failure rejects without fallback"
  );
  assert(excelReadRuntimeStats.fallbackAttempts === 0, "parse failure → fallback 0");
}

// 3) Detached transferred primary keeps prepared fallback clone readable
{
  const rows = [["H1"], ["data"]];
  const file = makeXlsxFile(rows, "detached-primary.xlsx");

  const parsed = await readExcelSheetRowsFromFile(file, {
    preferWorker: true,
    workerUrl: "mock://excel-sheet",
    runWorker: async ({ arrayBuffer }) => {
      structuredClone(arrayBuffer, { transfer: [arrayBuffer] });
      throw Object.assign(new Error("Worker crashed."), { code: "WORKER_ONERROR" });
    },
  });
  assert(parsed.length === 2, "detached primary → prepared clone fallback");
  assert(file.arrayBufferCalls === 1, "detached primary does not require file re-read");
}

// 3b) User cancellation never falls back.
{
  resetExcelReadRuntimeStats();
  const file = makeXlsxFile([["H1"], ["data"]], "cancelled.xlsx");
  const controller = new AbortController();
  await assertRejects(
    () =>
      readExcelSheetRowsFromFile(file, {
        workerUrl: "mock://excel-sheet",
        signal: controller.signal,
        runWorker: async () => {
          controller.abort();
          throw Object.assign(new Error("cancelled"), {
            code: "WORKER_CANCELLED",
          });
        },
      }),
    EXCEL_READ_STAGE.CANCELLED,
    "cancel rejects with typed cancellation"
  );
  assert(excelReadRuntimeStats.fallbackAttempts === 0, "cancel → fallback 0");
}

// 3c) Stale generation never falls back.
{
  resetExcelReadRuntimeStats();
  const file = makeXlsxFile([["H1"], ["stale"]], "stale.xlsx");
  await assertRejects(
    () =>
      readExcelSheetRowsFromFile(file, {
        workerUrl: "mock://excel-sheet",
        runWorker: async () => {
          throw Object.assign(new Error("stale"), { code: "WORKER_STALE" });
        },
      }),
    "WORKER_STALE",
    "stale generation rejects with typed status"
  );
  assert(excelReadRuntimeStats.fallbackAttempts === 0, "stale → fallback 0");
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

  const generalLedgerSource = fs.readFileSync(
    path.resolve("app/(annvero)/muhasebe/genel-muhasebe-kontrol/page.jsx"),
    "utf8"
  );
  assert(
    /workerUrl:\s*PARSER_WORKER_URLS\.excelSheet/.test(generalLedgerSource),
    "general ledger normal parse path is worker-first"
  );
  assert(/mountedRef\.current/.test(generalLedgerSource), "unmount state updates are guarded");
  assert(
    /cancelActiveParseJob\("gm-unmount",\s*\{[\s\S]*scopeId: GENERAL_LEDGER_PARSE_SCOPE/.test(
      generalLedgerSource
    ),
    "unmount cancels only component-scoped parse jobs"
  );
  assert(
    (generalLedgerSource.match(/<LedgerFilePicker/g) || []).length === 3,
    "three ledger files render three removable picker fields"
  );
  assert(
    /fileName \? \([\s\S]*aria-label=\{removeLabel\}[\s\S]*Kaldır/.test(
      generalLedgerSource
    ),
    "remove button is visible only when a file is selected"
  );
  assert(
    /className="min-w-0 truncate text-slate-700"/.test(generalLedgerSource) &&
      /title=\{fileName \|\| "Dosya seçilmedi"\}/.test(generalLedgerSource),
    "selected filename truncates visually and keeps full title"
  );
  for (const label of [
    "Muavin dosyasını kaldır",
    "Yevmiye dosyasını kaldır",
    "Mizan dosyasını kaldır",
  ]) {
    assert(
      generalLedgerSource.includes(`removeLabel="${label}"`),
      `${label} aria-label contract`
    );
  }
  assert(
    /selectedCompanyId && muavinFile && yevmiyeFile && mizanFile && !busy/.test(
      generalLedgerSource
    ),
    "start remains disabled unless all three files are selected"
  );
  const removeHandler = generalLedgerSource.slice(
    generalLedgerSource.indexOf("const handleRemoveFile"),
    generalLedgerSource.indexOf("const handleAnalyze")
  );
  assert(
    /fileKind === "muavin"[\s\S]*setMuavinFile\(null\)[\s\S]*muavinInputRef\.current\.value = ""/.test(
      removeHandler
    ),
    "removing Muavin clears only Muavin file state and native input"
  );
  assert(
    /fileKind === "yevmiye"[\s\S]*setYevmiyeFile\(null\)[\s\S]*yevmiyeInputRef\.current\.value = ""/.test(
      removeHandler
    ) &&
      /fileKind === "mizan"[\s\S]*setMizanFile\(null\)[\s\S]*mizanInputRef\.current\.value = ""/.test(
        removeHandler
      ),
    "Yevmiye and Mizan keep independent file/input cleanup"
  );
  assert(
    /cancelActiveParseJob\("stale",[\s\S]*fileKind,[\s\S]*invalidateActive\(`gm-\$\{fileKind\}-remove`\)/.test(
      removeHandler
    ),
    "remove cancels the scoped worker job and invalidates active generation"
  );
  assert(
    !/readSheetRows|fallback/i.test(removeHandler),
    "remove path cannot start worker fallback"
  );
  assert(
    /setResult\(null\)[\s\S]*resetPresentationState\(\)[\s\S]*setError\(""\)[\s\S]*bumpAnalyzeGeneration\(reason\)[\s\S]*abortRef\.current\?\.abort/.test(
      generalLedgerSource
    ),
    "remove invalidation clears result/filter/error and aborts stale work"
  );
}

if (failed) {
  console.error(`${failed} FAIL(s)`);
  process.exit(1);
}
console.log("ALL PASSED");
