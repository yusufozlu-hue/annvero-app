/**
 * TEB gerçek fixture gate — yalnız .local-fixtures (commit dışı).
 * Yoksa skip. Ham müşteri metni yazılmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const xlsxPath = path.join(root, ".local-fixtures", "Hesap Hareketleri (1).xlsx");
const pdfPath = path.join(root, ".local-fixtures", "HesapHareketleri (1).pdf");

if (!fs.existsSync(xlsxPath) || !fs.existsSync(pdfPath)) {
  console.log("SKIP — TEB real-file gate (local fixtures missing)");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const { detectExcelBank } = await import("../src/utils/bankExcelAutoDetect.js");
const { parseRowsForBank } = await import("../src/utils/bankParserWorkerCore.js");
const { legacyBankRowsToCanonical } = await import(
  "../src/utils/bankCanonicalTransaction.js"
);
const { parseBankStatementPdf } = await import("../src/utils/bankStatementPdf.js");

const wb = XLSX.readFile(xlsxPath, { cellDates: true, raw: true });
const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
  header: 1,
  defval: null,
  raw: true,
});
const det = detectExcelBank(sheetRows, {
  fileName: "Hesap Hareketleri (1).xlsx",
});
assert.equal(det.status, "detected");
assert.equal(det.bankId, "TEB");

const excelRows = parseRowsForBank(sheetRows, "TEB");
const excel = legacyBankRowsToCanonical(excelRows, {
  selectedBank: "TEB",
  sourceType: "xlsx",
});
assert.equal(excel.length, 2353);

let sum = 0;
for (const tx of excel) sum += Number(tx.amount) || 0;
const first = excel[0];
const last = excel[excel.length - 1];
const opening =
  excelRows[0]?.openingBalanceHint != null
    ? Number(excelRows[0].openingBalanceHint)
    : Number(first.balance) - Number(first.amount);
assert.ok(Math.abs(sum - -56134.5) < 0.02);
assert.ok(Math.abs(opening - 69992.41) < 0.02);
assert.ok(Math.abs(Number(last.balance) - 13857.91) < 0.02);
assert.ok(Math.abs(opening + sum - Number(last.balance)) < 0.02);

const dates = excel
  .map((t) => t.transactionDate)
  .filter(Boolean)
  .sort((a, b) => {
    const pa = a.split(".").reverse().join("-");
    const pb = b.split(".").reverse().join("-");
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
assert.equal(dates[0], "12.09.2025");
assert.equal(dates[dates.length - 1], "12.09.2026");

const pdf = await parseBankStatementPdf(fs.readFileSync(pdfPath), {
  timeoutMs: 120_000,
});
assert.equal(pdf.ok, true);
assert.equal(pdf.detectedBank || pdf.bank, "TEB");
const ptx = pdf.transactions || [];
assert.equal(ptx.length, 2353);

let match = 0;
let descMatch = 0;
for (let i = 0; i < excel.length; i += 1) {
  const e = excel[i];
  const p = ptx[i];
  const core =
    e.transactionDate === p.transactionDate &&
    (e.valueDate || e.transactionDate) === (p.valueDate || p.transactionDate) &&
    (e.transactionTime || "") === (p.transactionTime || "") &&
    Number(e.amount).toFixed(2) === Number(p.amount).toFixed(2) &&
    Number(e.balance).toFixed(2) === Number(p.balance).toFixed(2);
  if (core) match += 1;
  const ed = String(e.description || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
  const pd = String(p.description || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
  if (ed === pd) descMatch += 1;
}

assert.equal(match, 2353, `core parity ${match}/2353`);
console.log(
  JSON.stringify({
    excelDetect: "TEB",
    pdfDetect: "TEB",
    excelCount: 2353,
    pdfCount: 2353,
    coreParity: `${match}/2353`,
    descParity: `${descMatch}/2353`,
    descDiffCount: 2353 - descMatch,
    opening: 69992.41,
    sum: -56134.5,
    closing: 13857.91,
    mutabakatDiff: 0,
  })
);
console.log("OK — TEB real-file gate");
