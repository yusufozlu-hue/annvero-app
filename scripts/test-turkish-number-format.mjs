/**
 * TR money display formatter + GM summary card presentation.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-turkish-number-format.mjs
 */
import assert from "node:assert/strict";
import { formatTurkishMoney } from "@/src/utils/turkishNumberFormat.js";

/** Mirrors Genel Muhasebe Kontrol Borç/Alacak card (display only). */
function formatGenelMuhasebeBorcAlacakCard(borcToplam, alacakToplam) {
  return `${formatTurkishMoney(borcToplam)} / ${formatTurkishMoney(alacakToplam)}`;
}

assert.equal(formatTurkishMoney(0), "0,00");
assert.equal(formatTurkishMoney(1234.5), "1.234,50");
assert.equal(formatTurkishMoney(-1234.56), "-1.234,56");
assert.equal(formatTurkishMoney(498312616.35), "498.312.616,35");
assert.equal(formatTurkishMoney(null), "—");
assert.equal(formatTurkishMoney(undefined), "—");
assert.equal(formatTurkishMoney(Number.NaN), "—");
assert.equal(formatTurkishMoney("not-a-number"), "—");

assert.equal(
  formatGenelMuhasebeBorcAlacakCard(498312616.35, 498312616.35),
  "498.312.616,35 / 498.312.616,35"
);
assert.equal(formatGenelMuhasebeBorcAlacakCard(0, 0), "0,00 / 0,00");
assert.equal(formatGenelMuhasebeBorcAlacakCard(null, undefined), "— / —");
assert.equal(formatTurkishMoney(0), "0,00", "Fark kartı 0 → 0,00");

// Count cards must stay integer-like (no forced 2-decimal money format).
assert.notEqual(String(545), formatTurkishMoney(545), "adet ≠ money format");
assert.equal(formatTurkishMoney(545), "545,00");

console.log("ALL PASSED turkish-number-format");
