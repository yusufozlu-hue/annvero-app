/**
 * TEB 7-kolon gerçek dosya gate — yalnız Desktop path (commit dışı).
 * Yoksa skip. Ham müşteri metni / IBAN / tutar yazılmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const desktopPath = path.join(os.homedir(), "Desktop", "TEB GERCEK ESKTRE.xlsx");

if (!fs.existsSync(desktopPath)) {
  console.log("SKIP — TEB 7-col real-file gate (Desktop file missing)");
  process.exit(0);
}

const require = createRequire(path.join(root, "package.json"));
const XLSX = require("xlsx");
const { detectExcelBank } = await import("../src/utils/bankExcelAutoDetect.js");
const { resolveParserBankFromSheet } = await import(
  "../src/utils/bankStatementFormatGuard.js"
);
const { readSheetRowsFromArrayBuffer } = await import(
  "../src/utils/excelBufferUtils.js"
);
const {
  extractBankStatementCompanySignals,
  verifyBankStatementCompanyMatch,
  BANK_COMPANY_GUARD_CODE,
} = await import("../src/utils/bankStatementCompanyGuard.js");

const buf = fs.readFileSync(desktopPath);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: true });
assert.equal(wb.SheetNames.length, 1);
const sheet0 = wb.SheetNames[0];
const ref = String(wb.Sheets[sheet0]["!ref"] || "");
assert.ok(/^A1:G\d+$/i.test(ref), `expected 7-col ref, got ${ref}`);

const sheetRowsDirect = XLSX.utils.sheet_to_json(wb.Sheets[sheet0], {
  header: 1,
  defval: null,
  raw: true,
});
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const sheetRowsUi = readSheetRowsFromArrayBuffer(ab);
const fileName = path.basename(desktopPath);

const direct = detectExcelBank(sheetRowsDirect, {
  fileName,
  sheetName: sheet0,
});
assert.equal(direct.status, "detected");
assert.equal(direct.bankId, "TEB");
assert.ok(
  (direct.diagnostics?.matchedSignals || []).includes("header_teb_seven_column")
);

const uiPath = resolveParserBankFromSheet(sheetRowsUi, {
  fileName,
  companyId: "84384297-270c-47cd-ac5a-d693ba80b84a",
  bankAccounts: [],
  accountPlan102: [],
  formatMemoryRecords: [],
  useCompanyContext: true,
});
assert.equal(uiPath.status, "detected");
assert.equal(uiPath.bankId, "TEB");
assert.equal(uiPath.parserBankId, "TEB");

const signals = extractBankStatementCompanySignals({
  sheetRows: sheetRowsUi,
  fileName,
});
assert.equal(signals.ownerTitles.length, 0);
assert.equal(signals.ownerCores.length, 0);
assert.equal(signals.hasAnySignal, false);

const mare = {
  id: "84384297-270c-47cd-ac5a-d693ba80b84a",
  companyName: "MARE RESORT TURIZM VE OTELCILIK TICARET A.S.",
  bankAccounts: [],
};
const guard = verifyBankStatementCompanyMatch({
  sheetRows: sheetRowsUi,
  fileName,
  selectedCompany: mare,
  companies: [mare],
});
assert.equal(guard.code, BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED);
assert.ok(guard.reasons.includes("no_identity_signal"));
assert.notEqual(guard.code, BANK_COMPANY_GUARD_CODE.MISMATCH);
assert.equal(guard.statementOwnerLabel, "");

console.log(
  JSON.stringify({
    fileBytes: buf.length,
    sheetCount: 1,
    ref,
    rowCount: sheetRowsDirect.length,
    colCount: Math.max(...sheetRowsDirect.map((r) => (r || []).length)),
    direct: "TEB",
    uiCompanyPath: "TEB",
    signal: "header_teb_seven_column",
    ownerTitles: 0,
    companyGuard: "VERIFICATION_REQUIRED",
    reason: "no_identity_signal",
  })
);
console.log("OK — TEB 7-col real-file gate (privacy-safe)");
