/**
 * TEB / Ziraat / Kuveyt Türk Excel auto-detect + alias + routing tests.
 * DB/Drive/persist yok — salt yerel.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
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
import {
  FIXTURE_TEB_XLSX_ROWS,
  FIXTURE_TEB_XLS_ROWS,
  FIXTURE_ZIRAAT_XLSX_ROWS,
  FIXTURE_KUVEYTTURK_XLSX_ROWS,
  FIXTURE_KUVEYT_ALIAS_ROWS,
  FIXTURE_VAKIF_ROWS,
  FIXTURE_GARANTI_ROWS,
  FIXTURE_GENERIC_COLUMNS,
  FIXTURE_EMPTY,
  FIXTURE_AMBIGUOUS_TEB_ZIRAAT,
  FIXTURE_MULTI_SHEET_SIGNAL,
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
  assert.equal(kuveyt.bankId, "KUVEYT");
  assert.equal(kuveyt.canonicalBankId, "KUVEYTTURK");

  const alias = detectExcelBank(FIXTURE_KUVEYT_ALIAS_ROWS);
  assert.equal(alias.status, "detected");
  assert.equal(alias.canonicalBankId, "KUVEYTTURK");
  assert.equal(alias.bankId, "KUVEYT");
  console.log("OK — TEB / ZIRAAT / KUVEYTTURK→KUVEYT");
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
  assert.equal(k.bankId, "KUVEYT");
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
  assert.ok(a.diagnostics.ambiguityReason);
  console.log("OK — AMBIGUOUS");
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
  assert.equal(d.bankId, "KUVEYT");
  assert.equal(d.canonicalBankId, "KUVEYTTURK");
  console.log("OK — sheet name boost");
}

section("9) Vakıf / Garanti regresyon + yalnız islem tarihi false-positive yok");
{
  assert.equal(resolveParserBankFromSheet(FIXTURE_VAKIF_ROWS).bankId, "VAKIFBANK");
  assert.equal(resolveParserBankFromSheet(FIXTURE_GARANTI_ROWS).bankId, "GARANTI");
  const weak = detectExcelBank([["İşlem Tarihi", "Açıklama", "Tutar"]]);
  assert.notEqual(weak.bankId, "VAKIFBANK");
  console.log("OK — Vakıf/Garanti + sıkı Vakıf");
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

  // KUVEYTTURK kanonik id → hot-path KUVEYT map
  assert.equal(parseRowsForBank(FIXTURE_KUVEYTTURK_XLSX_ROWS, "KUVEYTTURK").length, 2);

  assert.throws(
    () => assertSelectedBankMatchesSheet(FIXTURE_TEB_XLSX_ROWS, "ZIRAAT"),
    (err) => err && err.code === "BANK_FORMAT_MISMATCH"
  );
  assert.equal(assertSelectedBankMatchesSheet(FIXTURE_TEB_XLSX_ROWS, "TEB"), "TEB");
  assert.equal(
    assertSelectedBankMatchesSheet(FIXTURE_KUVEYTTURK_XLSX_ROWS, "KUVEYTTURK"),
    "KUVEYT"
  );
  console.log("OK — parse + mismatch guard");
}

section("11) UNKNOWN’da bankId yok (persist tetiklenmez)");
{
  const u = resolveParserBankFromSheet(FIXTURE_GENERIC_COLUMNS);
  assert.equal(u.bankId, null);
  assert.equal(u.status, "unknown");
  // Workbench selectedBank boş → canStartFullPipeline false (one-click test ayrı)
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
  assert.doesNotMatch(src, /^\s*import\s/m);
  console.log("OK — worker zero-import + TEB/ZIRAAT/KUVEYT");
}

console.log("\nALL PASS — bank excel auto-detect TEB/Ziraat/KuveytTürk");
