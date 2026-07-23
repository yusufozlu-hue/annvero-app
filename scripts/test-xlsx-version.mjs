/**
 * Runtime xlsx sürüm doğrulama — tam olarak 0.20.3 olmalı.
 * Çalıştır: node --import ./scripts/_alias-loader.mjs ./scripts/test-xlsx-version.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import {
  assertSheetJsVersion,
  getSheetJsVersion,
  sanitizeExportValue,
  SAFE_XLSX_READ_DEFAULTS,
} from "../src/utils/safeXlsx.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED = "0.20.3";
const EXPECTED_SHA =
  "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test("runtime XLSX.version === 0.20.3", () => {
  assert.equal(XLSX.version, EXPECTED);
  assert.equal(getSheetJsVersion(), EXPECTED);
  assert.equal(assertSheetJsVersion(EXPECTED), EXPECTED);
});

test("package.json file: vendor tarball", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.dependencies.xlsx, "file:vendor/xlsx-0.20.3.tgz");
});

test("node_modules/xlsx package version", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "node_modules/xlsx/package.json"), "utf8")
  );
  assert.equal(pkg.name, "xlsx");
  assert.equal(pkg.version, EXPECTED);
});

test("vendor tarball SHA-256", () => {
  const buf = fs.readFileSync(path.join(root, "vendor/xlsx-0.20.3.tgz"));
  const sha = createHash("sha256").update(buf).digest("hex");
  assert.equal(sha, EXPECTED_SHA);
});

test("eski 0.18.5 package-lock/package.json içinde yok", () => {
  const lock = fs.readFileSync(path.join(root, "package-lock.json"), "utf8");
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.doesNotMatch(pkg, /0\.18\.5/);
  assert.doesNotMatch(lock, /xlsx.*0\.18\.5|0\.18\.5.*xlsx/);
  // lock içinde başka paketlerin 0.18.5'i olabilir; xlsx resolved kontrolü
  assert.doesNotMatch(lock, /"node_modules\/xlsx"[\s\S]{0,200}"version": "0\.18\.5"/);
});

test("safe read defaults HTML kapalı", () => {
  assert.equal(SAFE_XLSX_READ_DEFAULTS.cellHTML, false);
});

test("formula injection sanitize export", () => {
  assert.equal(sanitizeExportValue("=CMD()"), "'=CMD()");
  assert.equal(sanitizeExportValue("+1+1"), "'+1+1");
  assert.equal(sanitizeExportValue(1234.56), 1234.56);
  assert.equal(sanitizeExportValue("normal açıklama"), "normal açıklama");
});

test("roundtrip write/read AOA", () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Açıklama", "Tutar"],
    ["Türkçe ğüşıöç", 1500.5],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "T");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const read = XLSX.read(buf, { type: "array", cellDates: true, cellHTML: false });
  const rows = XLSX.utils.sheet_to_json(read.Sheets.T, { header: 1, defval: "" });
  assert.equal(rows[1][0], "Türkçe ğüşıöç");
  assert.equal(Number(rows[1][1]), 1500.5);
});

if (process.exitCode) {
  console.error("\nxlsx version tests: FAILED");
} else {
  console.log("\nxlsx version tests: ALL PASSED");
}
