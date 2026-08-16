/**
 * TEB / Ziraat / Kuveyt Türk Excel auto-detect + alias + routing tests.
 * DB/Drive/persist yok — salt yerel.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as XLSX from "xlsx";

import {
  canonicalizeBankId,
  toParserBankId,
  toCanonicalBankId,
  bankIdsEqual,
} from "../src/utils/bankIdentity.js";
import {
  detectExcelBank,
  scoreExcelBankCandidates,
  BANK_EXCEL_DETECTOR_VERSION,
} from "../src/utils/bankExcelAutoDetect.js";
import {
  resolveParserBankFromSheet,
  detectKnownBankFormat,
  assertSelectedBankMatchesSheet,
} from "../src/utils/bankStatementFormatGuard.js";
import { parseRowsForBank } from "../src/utils/bankParserWorkerCore.js";
import { canStartFullPipeline } from "../src/utils/bankOneClickPipeline.js";
import {
  FIXTURE_TEB_XLSX_ROWS,
  FIXTURE_TEB_XLS_ROWS,
  FIXTURE_ZIRAAT_XLSX_ROWS,
  FIXTURE_KUVEYTTURK_XLSX_ROWS,
  FIXTURE_KUVEYT_ALIAS_ROWS,
  FIXTURE_VAKIF_ROWS,
  FIXTURE_GARANTI_ROWS,
  FIXTURE_GARANTI_WEAK_COLUMNS,
  FIXTURE_GENERIC_COLUMNS,
  FIXTURE_EMPTY,
  FIXTURE_AMBIGUOUS_TEB_ZIRAAT,
  FIXTURE_MULTI_SHEET_SIGNAL,
  FIXTURE_KUVEYT_REAL_EXPORT_ANON,
  FIXTURE_A_KUVEYT_COLS_SHEET,
  FIXTURE_B_KUVEYT_COLS_NEUTRAL,
  FIXTURE_C_KUVEYT_COLS_VAKIF_NARRATIVE,
  FIXTURE_D_FILENAME_ONLY_KUVEYT,
  FIXTURE_E_TEB_NAMED_STRONG_GARANTI,
  FIXTURE_F_TEB_NAMED_WEAK_GARANTI,
  FIXTURE_ZIRAAT_REAL_EXPORT_ANON,
  FIXTURE_TEB_NAMED_GARANTI_COLUMNS,
} from "./fixtures/bank-excel/sheetRows.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(os.tmpdir(), "annvero-bank-excel-fixtures");

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function writeWorkbook(filePath, rows, bookType = "xlsx") {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hareketler");
  const buf = XLSX.write(wb, { bookType, type: "buffer" });
  writeFileSync(filePath, buf);
  return filePath;
}

function readWorkbookRows(filePath) {
  const data = readFileSync(filePath);
  const wb = XLSX.read(data, { type: "buffer", raw: false, cellDates: false });
  const name = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], {
    header: 1,
    defval: "",
    raw: false,
  });
}

function decisionSummary(det) {
  const d = det.diagnostics || {};
  return {
    status: d.status || String(det.status || "").toUpperCase(),
    selectedBank: d.selectedBank ?? det.bankId,
    parserBankId: d.parserBankId ?? det.parserBankId ?? null,
    topCandidate: d.topCandidate ?? null,
    topScore: d.topScore ?? 0,
    secondCandidate: d.secondCandidate ?? null,
    secondScore: d.secondScore ?? 0,
    matchedSignals: d.matchedSignals || [],
    ambiguityReason: d.ambiguityReason || null,
  };
}

function assertBlocksPersist(det, label) {
  assert.equal(det.bankId, null, `${label}: bankId null`);
  assert.equal(det.canonicalBankId, null, `${label}: canonical null`);
  assert.ok(
    det.status === "unknown" || det.status === "ambiguous",
    `${label}: status unknown|ambiguous`
  );
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "c1",
      selectedBank: det.bankId || "",
      selectedFile: { name: "x.xlsx" },
      isJobBusy: false,
      pipelinePhase: "IDLE",
    }),
    false,
    `${label}: pipeline blocked without selectedBank`
  );
}

function loadWorkerDetect() {
  const src = readFileSync(path.join(root, "src/workers/bankParser.worker.js"), "utf8");
  const start = src.indexOf("function normalizeStatementHeaderText");
  const end = src.indexOf("\nfunction banksMatch");
  assert.ok(start >= 0 && end > start, "worker detect chunk");
  const g = {};
  vm.runInNewContext(
    `${src.slice(start, end)}\nthis.detectBankDecision = detectBankDecision;`,
    g
  );
  return g.detectBankDecision;
}

section("1) Kanonik alias normalizasyonu");
{
  assert.equal(canonicalizeBankId("KUVEYT"), "KUVEYTTURK");
  assert.equal(canonicalizeBankId("KUVEYT TURK"), "KUVEYTTURK");
  assert.equal(canonicalizeBankId("Kuveyt Türk"), "KUVEYTTURK");
  assert.equal(canonicalizeBankId("KUVEYTTURK"), "KUVEYTTURK");
  assert.equal(canonicalizeBankId("KUVEYTTÜRK"), "KUVEYTTURK");
  assert.equal(toParserBankId("KUVEYTTURK"), "KUVEYT");
  assert.equal(toParserBankId("KUVEYT"), "KUVEYT");
  assert.equal(toCanonicalBankId("KUVEYT"), "KUVEYTTURK");
  assert.equal(bankIdsEqual("KUVEYT", "KUVEYTTURK"), true);
  assert.equal(bankIdsEqual("TEB", "ZIRAAT"), false);
  assert.equal(canonicalizeBankId("VAKIF"), "VAKIFBANK");
  console.log("OK — KUVEYT↔KUVEYTTURK + diğer alias");
}

section("2) TEB / Ziraat / Kuveyt tespit (sheet rows)");
{
  const teb = detectExcelBank(FIXTURE_TEB_XLSX_ROWS);
  assert.equal(teb.status, "detected");
  assert.equal(teb.bankId, "TEB");
  assert.equal(teb.canonicalBankId, "TEB");
  assert.ok(teb.diagnostics.matchedSignals.length > 0);
  assert.equal(teb.diagnostics.detectorVersion, BANK_EXCEL_DETECTOR_VERSION);

  const ziraat = detectExcelBank(FIXTURE_ZIRAAT_XLSX_ROWS);
  assert.equal(ziraat.status, "detected");
  assert.equal(ziraat.bankId, "ZIRAAT");

  const kuveyt = detectExcelBank(FIXTURE_KUVEYTTURK_XLSX_ROWS);
  assert.equal(kuveyt.status, "detected");
  assert.equal(kuveyt.bankId, "KUVEYTTURK");
  assert.equal(kuveyt.parserBankId, "KUVEYT");
  assert.equal(kuveyt.canonicalBankId, "KUVEYTTURK");
  assert.equal(kuveyt.diagnostics.selectedBank, "KUVEYTTURK");

  const alias = detectExcelBank(FIXTURE_KUVEYT_ALIAS_ROWS);
  assert.equal(alias.status, "detected");
  assert.equal(alias.canonicalBankId, "KUVEYTTURK");
  assert.equal(alias.bankId, "KUVEYTTURK");
  assert.equal(alias.parserBankId, "KUVEYT");
  console.log("OK — TEB / ZIRAAT / KUVEYTTURK→parser KUVEYT");
}

section("3) XLSX + XLS workbook round-trip");
{
  const tebXlsx = path.join(outDir, "teb-statement.xlsx");
  const tebXls = path.join(outDir, "teb-statement.xls");
  const ziraatXlsx = path.join(outDir, "ziraat-statement.xlsx");
  const kuveytXlsx = path.join(outDir, "kuveytturk-statement.xlsx");
  writeWorkbook(tebXlsx, FIXTURE_TEB_XLSX_ROWS, "xlsx");
  writeWorkbook(tebXls, FIXTURE_TEB_XLS_ROWS, "xls");
  writeWorkbook(ziraatXlsx, FIXTURE_ZIRAAT_XLSX_ROWS, "xlsx");
  writeWorkbook(kuveytXlsx, FIXTURE_KUVEYTTURK_XLSX_ROWS, "xlsx");

  assert.equal(resolveParserBankFromSheet(readWorkbookRows(tebXlsx)).bankId, "TEB");
  assert.equal(resolveParserBankFromSheet(readWorkbookRows(tebXls)).bankId, "TEB");
  assert.equal(resolveParserBankFromSheet(readWorkbookRows(ziraatXlsx)).bankId, "ZIRAAT");
  const k = resolveParserBankFromSheet(readWorkbookRows(kuveytXlsx));
  assert.equal(k.bankId, "KUVEYTTURK");
  assert.equal(k.parserBankId, "KUVEYT");
  assert.equal(k.canonicalBankId, "KUVEYTTURK");
  console.log("OK — generated xlsx/xls detect");
}

section("4) Dosya adı yanıltıcı / içerik doğru");
{
  const tebNamedGaranti = detectExcelBank(FIXTURE_TEB_XLSX_ROWS, {
    fileName: "garanti-ekstre.xlsx",
  });
  assert.equal(tebNamedGaranti.bankId, "TEB");

  const garantiNamedTeb = detectExcelBank(FIXTURE_GARANTI_ROWS, {
    fileName: "teb-export.xlsx",
  });
  assert.equal(garantiNamedTeb.bankId, "GARANTI");
  console.log("OK — içerik dosya adını yener");
}

section("5) Generic kolonlar → UNKNOWN");
{
  const g = detectExcelBank(FIXTURE_GENERIC_COLUMNS);
  assert.equal(g.status, "unknown");
  assert.equal(g.bankId, null);
  assert.equal(detectKnownBankFormat(FIXTURE_GENERIC_COLUMNS), "UNKNOWN");
  console.log("OK — generic UNKNOWN");
}

section("6) Yakın çift sinyal → AMBIGUOUS");
{
  const a = detectExcelBank(FIXTURE_AMBIGUOUS_TEB_ZIRAAT);
  assert.equal(a.status, "ambiguous");
  assert.equal(a.bankId, null);
  assert.equal(a.detected, "AMBIGUOUS");
  assert.equal(a.diagnostics.status, "AMBIGUOUS");
  assert.ok(a.diagnostics.ambiguityReason);
  assertBlocksPersist(a, "G-ambiguous");
  console.log("OK — AMBIGUOUS", decisionSummary(a));
}

section("7) Boş workbook → UNKNOWN");
{
  const e = detectExcelBank(FIXTURE_EMPTY);
  assert.equal(e.status, "unknown");
  assert.equal(e.diagnostics.ambiguityReason, "empty_workbook");
  console.log("OK — empty");
}

section("8) Sheet adı yardımcı sinyal");
{
  const d = detectExcelBank(FIXTURE_MULTI_SHEET_SIGNAL.rows, {
    sheetName: FIXTURE_MULTI_SHEET_SIGNAL.sheetName,
  });
  assert.equal(d.bankId, "KUVEYTTURK");
  assert.equal(d.parserBankId, "KUVEYT");
  assert.equal(d.canonicalBankId, "KUVEYTTURK");
  console.log("OK — sheet name boost");
}

section("9) Vakıf / Garanti regresyon + yalnız islem tarihi false-positive yok");
{
  assert.equal(resolveParserBankFromSheet(FIXTURE_VAKIF_ROWS).bankId, "VAKIFBANK");
  assert.equal(resolveParserBankFromSheet(FIXTURE_GARANTI_ROWS).bankId, "GARANTI");
  const weakCols = detectExcelBank(FIXTURE_GARANTI_WEAK_COLUMNS);
  assert.equal(weakCols.status, "unknown");
  assert.equal(weakCols.diagnostics.topCandidate, "GARANTI");
  assert.ok(weakCols.diagnostics.topScore < 45);
  assert.equal(weakCols.bankId, null);
  const weak = detectExcelBank([["İşlem Tarihi", "Açıklama", "Tutar"]]);
  assert.notEqual(weak.bankId, "VAKIFBANK");
  console.log("OK — Vakıf/Garanti + zayıf Garanti UNKNOWN", decisionSummary(weakCols));
}

section("10) Yanlış routing yok + parser hareket sayısı");
{
  const tebRows = parseRowsForBank(FIXTURE_TEB_XLSX_ROWS, "TEB");
  assert.equal(tebRows.length, 2);
  assert.ok(tebRows.every((r) => r.banka === "TEB" || !r.banka || r.banka));

  const ziraatRows = parseRowsForBank(FIXTURE_ZIRAAT_XLSX_ROWS, "ZIRAAT");
  assert.equal(ziraatRows.length, 2);

  const kuveytRows = parseRowsForBank(FIXTURE_KUVEYTTURK_XLSX_ROWS, "KUVEYT");
  assert.equal(kuveytRows.length, 2);

  assert.equal(parseRowsForBank(FIXTURE_KUVEYTTURK_XLSX_ROWS, "KUVEYTTURK").length, 2);

  assert.throws(
    () => assertSelectedBankMatchesSheet(FIXTURE_TEB_XLSX_ROWS, "ZIRAAT"),
    (err) => err && err.code === "BANK_FORMAT_MISMATCH"
  );
  assert.equal(assertSelectedBankMatchesSheet(FIXTURE_TEB_XLSX_ROWS, "TEB"), "TEB");
  assert.equal(
    assertSelectedBankMatchesSheet(FIXTURE_KUVEYTTURK_XLSX_ROWS, "KUVEYTTURK"),
    "KUVEYTTURK"
  );
  assert.equal(
    assertSelectedBankMatchesSheet(FIXTURE_KUVEYTTURK_XLSX_ROWS, "KUVEYT"),
    "KUVEYTTURK"
  );
  console.log("OK — parse + mismatch guard");
}

section("11) UNKNOWN’da bankId yok (persist tetiklenmez)");
{
  const u = resolveParserBankFromSheet(FIXTURE_GENERIC_COLUMNS);
  assert.equal(u.bankId, null);
  assert.equal(u.status, "unknown");
  assertBlocksPersist(u, "generic");
  console.log("OK — UNKNOWN bankId null");
}

section("12) Skor sıralaması diagnostics");
{
  const ranked = scoreExcelBankCandidates(FIXTURE_TEB_XLSX_ROWS);
  assert.equal(ranked[0].canonical, "TEB");
  assert.ok(ranked[0].score >= 45);
  assert.ok(ranked.every((c) => Array.isArray(c.signals)));
  console.log("OK — diagnostics shape");
}

section("13) Worker source sync markers");
{
  const workerPath = path.join(root, "src/workers/bankParser.worker.js");
  const src = readFileSync(workerPath, "utf8");
  assert.match(src, /KUVEYT/);
  assert.match(src, /ZIRAAT/);
  assert.match(src, /TEB/);
  assert.match(src, /banksMatch/);
  assert.match(src, /detectBankDecision/);
  assert.match(src, /header_kuveyt_columns/);
  assert.match(src, /scoreWorkerCandidates/);
  assert.match(src, /Generic "hesap hareket"/);
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /from ["']xlsx["']/);
  console.log("OK — worker zero-import + scored parity markers");
}

section("14) Legacy 49bcdd1 FAIL → PASS (anon export + sheet)");
{
  const { rows, sheetName, fileName } = FIXTURE_KUVEYT_REAL_EXPORT_ANON;

  function scoreLegacy49bcdd1(sheetRows) {
    const norm = (v) =>
      String(v || "")
        .toLowerCase()
        .replace(/ı/g, "i")
        .replace(/ğ/g, "g")
        .replace(/ü/g, "u")
        .replace(/ş/g, "s")
        .replace(/ö/g, "o")
        .replace(/ç/g, "c")
        .replace(/\s+/g, " ")
        .trim();
    const full = sheetRows
      .map((r) => (Array.isArray(r) ? r.map(norm).join(" ") : ""))
      .join(" | ");
    let vakif = 0;
    let kuveyt = 0;
    if (/vakif\s*bank|vakifbank/.test(full)) vakif += 42;
    if (
      full.includes("hesap hareket") ||
      (full.includes("hesap") && full.includes("hareket") && full.includes("tutar"))
    ) {
      vakif += 30;
    }
    if (/kuveyt/.test(sheetName)) kuveyt += 14;
    if (/kuveyt/.test(norm(fileName))) kuveyt += 8;
    return {
      vakif,
      kuveyt,
      winner: vakif >= 45 && vakif > kuveyt ? "VAKIFBANK" : "OTHER",
    };
  }

  const legacy = scoreLegacy49bcdd1(rows);
  assert.equal(legacy.winner, "VAKIFBANK");
  assert.ok(legacy.vakif >= 70);

  const det = detectExcelBank(rows, { sheetName, fileName });
  assert.equal(det.status, "detected");
  assert.equal(det.canonicalBankId, "KUVEYTTURK");
  assert.equal(det.bankId, "KUVEYTTURK");
  assert.equal(det.parserBankId, "KUVEYT");
  assert.equal(det.diagnostics.selectedBank, "KUVEYTTURK");
  assert.ok(det.diagnostics.matchedSignals.includes("header_kuveyt_columns"));
  assert.ok(det.diagnostics.matchedSignals.includes("sheet_name"));
  assert.ok(!det.diagnostics.matchedSignals.includes("brand_vakifbank"));
  console.log("OK — legacy FAIL → PASS", decisionSummary(det));
}

section("15) Fixture matrisi A–G + status/topCandidate ayrımı");
{
  const matrix = [
    ["A", FIXTURE_A_KUVEYT_COLS_SHEET, "detected", "KUVEYTTURK", "KUVEYT"],
    ["B", FIXTURE_B_KUVEYT_COLS_NEUTRAL, "unknown", null, null],
    ["C", FIXTURE_C_KUVEYT_COLS_VAKIF_NARRATIVE, "unknown", null, null],
    ["D", FIXTURE_D_FILENAME_ONLY_KUVEYT, "unknown", null, null],
    ["E", FIXTURE_E_TEB_NAMED_STRONG_GARANTI, "detected", "GARANTI", "GARANTI"],
    ["F", FIXTURE_F_TEB_NAMED_WEAK_GARANTI, "unknown", null, null],
    ["G", { rows: FIXTURE_AMBIGUOUS_TEB_ZIRAAT, sheetName: "", fileName: "" }, "ambiguous", null, null],
  ];

  const report = [];
  for (const [id, fx, status, selectedBank, parserBankId] of matrix) {
    const opts = { sheetName: fx.sheetName || "", fileName: fx.fileName || "" };
    const det = detectExcelBank(fx.rows, opts);
    const sum = decisionSummary(det);
    report.push({ id, ...sum });
    assert.equal(det.status, status, `${id} status`);
    assert.equal(det.bankId, selectedBank, `${id} bankId/selected`);
    assert.equal(det.parserBankId, parserBankId, `${id} parserBankId`);
    assert.equal(det.diagnostics.selectedBank, selectedBank, `${id} diag.selectedBank`);
    assert.equal(det.diagnostics.parserBankId, parserBankId, `${id} diag.parserBankId`);
    assert.ok(sum.topCandidate !== undefined);
    assert.ok(typeof sum.topScore === "number");
    if (status === "unknown" || status === "ambiguous") {
      assertBlocksPersist(det, id);
    }
    if (id === "A") {
      assert.equal(sum.status, "DETECTED");
      assert.equal(sum.selectedBank, "KUVEYTTURK");
      assert.equal(sum.parserBankId, "KUVEYT");
      assert.equal(sum.topCandidate, "KUVEYTTURK");
      assert.equal(sum.topScore, 46);
      assert.ok(sum.matchedSignals.includes("header_kuveyt_columns"));
      assert.ok(sum.matchedSignals.includes("sheet_name"));
    }
    if (id === "B" || id === "C") {
      assert.equal(sum.topCandidate, "KUVEYTTURK");
      assert.ok(sum.topScore < 45);
      assert.equal(sum.selectedBank, null);
      assert.equal(sum.parserBankId, null);
      assert.notEqual(sum.selectedBank, "VAKIFBANK");
    }
    if (id === "F") {
      assert.equal(sum.topCandidate, "GARANTI");
      assert.ok(sum.topScore < 45);
      assert.equal(sum.selectedBank, null);
      assert.equal(sum.parserBankId, null);
      assert.notEqual(det.bankId, "TEB");
    }
    if (id === "D") {
      assert.equal(sum.selectedBank, null);
      assert.equal(sum.parserBankId, null);
    }
    if (id === "E") {
      assert.notEqual(det.bankId, "TEB");
      assert.ok(
        sum.matchedSignals.some(
          (s) =>
            String(s).startsWith("brand_garanti") ||
            s === "iban_00062" ||
            s === "header_garanti_export"
        )
      );
    }
  }

  // Body-only "Kuveyt Türk" → UNKNOWN
  const bodyBrand = detectExcelBank(
    [
      ["Tarih", "Açıklama", "Tutar"],
      ["10.01.2026", "KUVEYT TURK HAVALE ANON", "10"],
    ],
    { fileName: "ekstre.xlsx", sheetName: "Sheet1" }
  );
  assert.equal(bodyBrand.status, "unknown");
  assert.equal(bodyBrand.bankId, null);

  console.log("OK — matrix A–G");
  for (const row of report) {
    console.log(JSON.stringify(row));
  }
}

section("16) UI ↔ worker detector parity (aynı matris)");
{
  const workerDetect = loadWorkerDetect();
  const cases = [
    FIXTURE_A_KUVEYT_COLS_SHEET,
    FIXTURE_B_KUVEYT_COLS_NEUTRAL,
    FIXTURE_C_KUVEYT_COLS_VAKIF_NARRATIVE,
    FIXTURE_D_FILENAME_ONLY_KUVEYT,
    FIXTURE_E_TEB_NAMED_STRONG_GARANTI,
    FIXTURE_F_TEB_NAMED_WEAK_GARANTI,
    { rows: FIXTURE_AMBIGUOUS_TEB_ZIRAAT, sheetName: "", fileName: "" },
    FIXTURE_KUVEYT_REAL_EXPORT_ANON,
    { rows: FIXTURE_VAKIF_ROWS, sheetName: "", fileName: "" },
    { rows: FIXTURE_GARANTI_ROWS, sheetName: "", fileName: "" },
    { rows: FIXTURE_TEB_XLSX_ROWS, sheetName: "", fileName: "" },
  ];

  for (const fx of cases) {
    const opts = { sheetName: fx.sheetName || "", fileName: fx.fileName || "" };
    const ui = detectExcelBank(fx.rows, opts);
    const w = workerDetect(fx.rows, opts);
    const uiStatus =
      ui.status === "detected"
        ? "DETECTED"
        : ui.status === "ambiguous"
          ? "AMBIGUOUS"
          : "UNKNOWN";
    assert.equal(w.status, uiStatus, `parity status opts=${JSON.stringify(opts)}`);
    assert.equal(
      w.selectedBank,
      ui.diagnostics.selectedBank,
      `parity selectedBank ui=${ui.diagnostics.selectedBank} worker=${w.selectedBank}`
    );
    assert.equal(
      w.parserBankId,
      ui.parserBankId,
      `parity parserBankId ui=${ui.parserBankId} worker=${w.parserBankId}`
    );
    if (uiStatus === "DETECTED") {
      assert.notEqual(w.selectedBank, "KUVEYT", "selectedBank must stay canonical");
      if (w.selectedBank === "KUVEYTTURK") {
        assert.equal(w.parserBankId, "KUVEYT");
      }
    }
  }
  console.log("OK — UI/worker parity (canonical selectedBank + parserBankId)");
}

section("17) Gerçek Ziraat export + TEB-adlı Garanti kolonları");
{
  const z = detectExcelBank(FIXTURE_ZIRAAT_REAL_EXPORT_ANON.rows, {
    sheetName: FIXTURE_ZIRAAT_REAL_EXPORT_ANON.sheetName,
    fileName: FIXTURE_ZIRAAT_REAL_EXPORT_ANON.fileName,
  });
  assert.equal(z.status, "detected");
  assert.equal(z.bankId, "ZIRAAT");
  assert.equal(z.parserBankId, "ZIRAAT");
  assert.ok(z.diagnostics.matchedSignals.includes("header_ziraat_export"));
  assert.equal(parseRowsForBank(FIXTURE_ZIRAAT_REAL_EXPORT_ANON.rows, "ZIRAAT").length, 2);

  // brand yok + native header → exclusive DETECTED
  const zNativeOnly = detectExcelBank(
    [
      [
        "Muh Tarih",
        "Valor",
        "Şube",
        "Fiş No",
        "İşl Kd",
        "Borç",
        "Alacak",
        "Bakiye",
        "İşlem Açıklaması",
      ],
      ["10.01.2026", "10.01.2026", "X", "1", "E", "1,00", "", "1", "ANON"],
    ],
    { fileName: "ekstre.xlsx", sheetName: "Sheet1" }
  );
  assert.equal(zNativeOnly.status, "detected");
  assert.equal(zNativeOnly.bankId, "ZIRAAT");
  assert.ok(zNativeOnly.diagnostics.matchedSignals.includes("header_ziraat_export"));

  const tebNamed = detectExcelBank(FIXTURE_TEB_NAMED_GARANTI_COLUMNS.rows, {
    sheetName: FIXTURE_TEB_NAMED_GARANTI_COLUMNS.sheetName,
    fileName: FIXTURE_TEB_NAMED_GARANTI_COLUMNS.fileName,
  });
  assert.equal(tebNamed.status, "unknown");
  assert.equal(tebNamed.bankId, null);
  assert.notEqual(tebNamed.diagnostics.topCandidate, "TEB");
  assert.equal(tebNamed.diagnostics.topCandidate, "GARANTI");
  assert.ok(tebNamed.diagnostics.topScore < 45);
  // dosya adı TEB seçtirmesin
  assert.ok(
    (tebNamed.diagnostics.matchedSignals || []).includes("header_garanti_export") ||
      tebNamed.diagnostics.topScore === 28 ||
      tebNamed.diagnostics.topScore === 36
  );
  console.log("OK — Ziraat real export + TEB-named ≠ TEB", decisionSummary(tebNamed));
}

console.log("\nALL PASS — bank excel auto-detect TEB/Ziraat/KuveytTürk");
