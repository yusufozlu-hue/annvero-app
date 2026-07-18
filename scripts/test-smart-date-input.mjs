/**
 * Akıllı tarih (Tab yıl tamamlama) unit testleri.
 * Çalıştır: node scripts/test-smart-date-input.mjs
 */

import assert from "node:assert/strict";
import {
  completeSmartDateDisplay,
  completeSmartDateIso,
  resolveSmartDateInput,
} from "../src/utils/smartDateInput.js";

const YEAR = 2026;

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

test("19.11 → mevcut yıl", () => {
  assert.equal(completeSmartDateDisplay("19.11", YEAR), "19.11.2026");
  assert.equal(completeSmartDateIso("19.11", YEAR), "2026-11-19");
});

test("1.2 → sıfır dolgulu + mevcut yıl", () => {
  assert.equal(completeSmartDateDisplay("1.2", YEAR), "01.02.2026");
  assert.equal(completeSmartDateIso("1.2", YEAR), "2026-02-01");
});

test("19/11 → normalize", () => {
  assert.equal(completeSmartDateDisplay("19/11", YEAR), "19.11.2026");
});

test("19-11 → normalize", () => {
  assert.equal(completeSmartDateDisplay("19-11", YEAR), "19.11.2026");
  assert.equal(completeSmartDateDisplay("01-02", YEAR), "01.02.2026");
});

test("19.11.2025 → değişmez", () => {
  assert.equal(completeSmartDateDisplay("19.11.2025", YEAR), "19.11.2025");
  assert.equal(completeSmartDateIso("19.11.2025", YEAR), "2025-11-19");
});

test("boş → boş", () => {
  assert.equal(completeSmartDateDisplay("", YEAR), "");
  assert.equal(completeSmartDateIso("   ", YEAR), "");
  const r = resolveSmartDateInput("", YEAR);
  assert.equal(r.empty, true);
  assert.equal(r.ok, true);
});

test("31.02 → geçersiz", () => {
  assert.equal(completeSmartDateDisplay("31.02", YEAR), "");
  const r = resolveSmartDateInput("31.02", YEAR);
  assert.equal(r.ok, false);
  assert.match(r.error, /Geçersiz/);
});

test("29.02.2024 → geçerli", () => {
  assert.equal(completeSmartDateDisplay("29.02.2024", YEAR), "29.02.2024");
  assert.equal(completeSmartDateIso("29.02.2024", YEAR), "2024-02-29");
});

test("29.02.2025 → geçersiz", () => {
  assert.equal(completeSmartDateDisplay("29.02.2025", YEAR), "");
  assert.equal(resolveSmartDateInput("29.02.2025", YEAR).ok, false);
});

test("yalnız gün rastgele ay üretmez", () => {
  assert.equal(completeSmartDateDisplay("19", YEAR), "");
});

test("yıl dinamik (referenceYear)", () => {
  assert.equal(completeSmartDateDisplay("01.01", 2031), "01.01.2031");
  assert.equal(completeSmartDateDisplay("31.12", 2030), "31.12.2030");
});

if (!process.exitCode) {
  console.log("\nAll smart date tests passed.");
}
