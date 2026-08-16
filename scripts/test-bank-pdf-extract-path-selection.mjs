/**
 * Extract-path selection P0 — sentetik adaylar (PII yok).
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-pdf-extract-path-selection.mjs
 */
import assert from "node:assert/strict";
import {
  probeExtractCandidate,
  scoreExtractCandidate,
  selectBestExtractCandidate,
  scoreExtractedStatementTextLegacy,
  parsePdfMovementLines,
} from "@/src/utils/bankStatementPdf.js";

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.error(String(e?.stack || e));
  }
}

/** Gerçek Garanti P0 profiline benzer: uzun birleşmiş latin1 vs kısa satırlı pdfjs */
function buildBadLatin1Garbage() {
  const junkDates = Array.from({ length: 16 }, (_, i) => {
    const d = String((i % 28) + 1).padStart(2, "0");
    return `stream noise ${d}.03.2026 binary ${"X".repeat(80)}`;
  });
  const merged = Array.from({ length: 40 }, (_, i) => {
    return (
      `obj/Filter/FlateDecode junk line ${i} ` +
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(12) +
      ` trailing ${10 + (i % 9)}.${10 + (i % 9)}.2026 morebytes`
    );
  });
  return ["Garanti BBVA Hesap", ...junkDates, ...merged].join("\n");
}

function buildGoodPdfjsStructure() {
  const rows = [
    "Garanti BBVA Hesap Ekstresi",
    "01.03.2026 HAVALE GELEN ABC LTD 0,00 1.250,00 10.000,00",
    "02.03.2026 EFT GIDEN XYZ AS 500,00 0,00 9.500,00",
    "03.03.2026 POS TAHSILAT 0,00 750,50 10.250,50",
    "04.03.2026 VIRMAN CIKIS 200,00 0,00 10.050,50",
    "05.03.2026 HAVALE GELEN DEMO 0,00 100,00 10.150,50",
    "06.03.2026 MASRAF 15,00 0,00 10.135,50",
    "07.03.2026 EFT GELEN TEST 0,00 2.000,00 12.135,50",
    "08.03.2026 ODEME TALIMAT 300,00 0,00 11.835,50",
    "09.03.2026 FAİZ 0,00 12,25 11.847,75",
    "10.03.2026 HAVALE GIDEN 1.000,00 0,00 10.847,75",
    "11.03.2026 IADE 0,00 50,00 10.897,75",
  ];
  return rows.join("\n");
}

function buildFallbackOnlyLatin1() {
  return [
    "Banka Ekstresi",
    "12.01.2026 ODEME ALINDI 0,00 100,00 100,00",
    "13.01.2026 ODEME YAPILDI 40,00 0,00 60,00",
  ].join("\n");
}

test("legacy score reproduces latin1-over-pdfjs FAIL", () => {
  const latin1 = buildBadLatin1Garbage();
  const pdfjs = buildGoodPdfjsStructure();
  const latinScore = scoreExtractedStatementTextLegacy(latin1);
  const pdfjsScore = scoreExtractedStatementTextLegacy(pdfjs);
  assert.ok(latinScore > pdfjsScore, `legacy latin ${latinScore} should beat pdfjs ${pdfjsScore}`);
  assert.equal(parsePdfMovementLines(latin1).transactions.length, 0);
  assert.ok(parsePdfMovementLines(pdfjs).transactions.length >= 10);
});

test("new selection picks pdfjs over corrupt latin1", () => {
  const latin1 = buildBadLatin1Garbage();
  const pdfjs = buildGoodPdfjsStructure();
  const selection = selectBestExtractCandidate([
    { name: "latin1", text: latin1 },
    { name: "pdfjs", text: pdfjs },
  ]);
  assert.equal(selection.decision, "use");
  assert.equal(selection.winner?.name, "pdfjs");
  assert.ok((selection.winner?.probe?.parsedTx || 0) >= 10);
  const latinProbe = probeExtractCandidate(latin1, { name: "latin1" });
  const pdfjsProbe = probeExtractCandidate(pdfjs, { name: "pdfjs" });
  assert.ok(
    scoreExtractCandidate(pdfjsProbe) > scoreExtractCandidate(latinProbe),
    "pdfjs score must beat latin1"
  );
});

test("movements and balances preserved on pdfjs winner", () => {
  const pdfjs = buildGoodPdfjsStructure();
  const parsed = parsePdfMovementLines(pdfjs);
  assert.ok(parsed.transactions.length >= 10);
  const withBal = parsed.transactions.filter((tx) => Number.isFinite(Number(tx.balance)));
  assert.equal(withBal.length, parsed.transactions.length);
  const dirs = new Set(parsed.transactions.map((tx) => tx.direction));
  assert.ok(dirs.has("GIRIS") && dirs.has("CIKIS"));
});

test("fallback-only latin1 still wins when pdfjs empty", () => {
  const latin1 = buildFallbackOnlyLatin1();
  const selection = selectBestExtractCandidate([
    { name: "pdfjs", text: "" },
    { name: "latin1", text: latin1 },
  ]);
  assert.equal(selection.decision, "use");
  assert.equal(selection.winner?.name, "latin1");
  assert.ok((selection.winner?.probe?.parsedTx || 0) >= 2);
});

test("two unusable candidates → OCR_REQUIRED", () => {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ ".repeat(40);
  const b = "stream /FlateDecode binary noise without statement rows ".repeat(20);
  const selection = selectBestExtractCandidate([
    { name: "latin1", text: a },
    { name: "pdfjs", text: b },
  ]);
  assert.equal(selection.decision, "OCR_REQUIRED");
  assert.equal(selection.winner, null);
});

test("selection is deterministic", () => {
  const latin1 = buildBadLatin1Garbage();
  const pdfjs = buildGoodPdfjsStructure();
  const a = selectBestExtractCandidate([
    { name: "latin1", text: latin1 },
    { name: "pdfjs", text: pdfjs },
  ]);
  const b = selectBestExtractCandidate([
    { name: "pdfjs", text: pdfjs },
    { name: "latin1", text: latin1 },
  ]);
  assert.equal(a.winner?.name, b.winner?.name);
  assert.equal(a.winner?.score, b.winner?.score);
  assert.equal(a.decision, b.decision);
});

test("length alone does not win", () => {
  const shortGood = buildGoodPdfjsStructure();
  const longBad = ("noise " + "Z".repeat(200) + " 01.02.2026\n").repeat(80);
  const selection = selectBestExtractCandidate([
    { name: "latin1", text: longBad },
    { name: "pdfjs", text: shortGood },
  ]);
  assert.equal(selection.winner?.name, "pdfjs");
  assert.ok(longBad.length > shortGood.length);
});

test("split-line pdfjs (needs normalize probe) beats long latin1", () => {
  // Gerçek Garanti profili: tarih satırı + tutar ayrı satır
  const pdfjs = [
    "Garanti BBVA Hesap Ekstresi",
    "Tarih Aciklama Tutar Bakiye",
    "01.03.2026",
    "HAVALE GELEN DEMO FIRMA",
    "1.250,00",
    "10.000,00",
    "02.03.2026",
    "EFT GIDEN DIGER",
    "-500,00",
    "9.500,00",
    "03.03.2026",
    "POS TAHSILAT",
    "750,50",
    "10.250,50",
  ].join("\n");
  const latin1 = buildBadLatin1Garbage();
  const selection = selectBestExtractCandidate([
    { name: "latin1", text: latin1 },
    { name: "pdfjs", text: pdfjs },
  ]);
  assert.equal(selection.winner?.name, "pdfjs");
  assert.ok((selection.winner?.probe?.parsedTx || 0) >= 2);
  assert.equal(selection.winner?.probe?.usedNormalizeProbe, true);
});

test("unit: no second source/job — selection is pure text compare", () => {
  // Safeguard: selector has no side effects / no I/O hooks.
  const before = Object.keys(process.env).length;
  selectBestExtractCandidate([
    { name: "pdfjs", text: buildGoodPdfjsStructure() },
    { name: "latin1", text: buildBadLatin1Garbage() },
  ]);
  assert.equal(Object.keys(process.env).length, before);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll extract-path selection tests passed.");
