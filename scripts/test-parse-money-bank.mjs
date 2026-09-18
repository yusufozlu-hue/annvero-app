/**
 * parseMoney — TR / US / numeric / negatif biçimler (müşteri verisi yok).
 */
import assert from "node:assert/strict";
import { parseMoney } from "../src/utils/bankParserWorkerCore.js";

const cases = [
  ["numeric", 1234.56, 1234.56],
  ["numeric_neg", -3.05, -3.05],
  ["tr", "1.234,56", 1234.56],
  ["tr_neg", "-1.234,56", -1234.56],
  ["us", "1234.56", 1234.56],
  ["us_thousands", "1,234.56", 1234.56],
  ["paren", "(12,50)", -12.5],
  ["empty", "", 0],
  ["dash", "-", 0],
  ["tl_suffix", "10,00 TL", 10],
  ["float_dust", 1e-12, 0],
];

for (const [name, input, expected] of cases) {
  assert.equal(parseMoney(input), expected, name);
}

// US ondalık binlik sanılmamalı
assert.equal(parseMoney("69992.41"), 69992.41);
assert.notEqual(parseMoney("69992.41"), 6999241);

console.log("OK — parseMoney bank formats");
