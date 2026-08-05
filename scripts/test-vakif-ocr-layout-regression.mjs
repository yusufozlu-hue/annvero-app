/**
 * Redacted VakıfBank OCR layout fixture — OCR_NO_MOVEMENTS regresyonu.
 * Gerçek müşteri metni yok; kolon/çok satır düzenini temsil eder.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-vakif-ocr-layout-regression.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeOcrStatementText } from "@/src/utils/bankOcr/normalizeOcrStatementText.js";
import { finalizeOcrPagesToParseResult } from "@/src/utils/bankOcr/runBankStatementOcr.js";
import { parseBankStatementPdf } from "@/src/utils/bankStatementPdf.js";

await (async function columnarVisionLayout() {
  const columnar = [
    "VakifBank Hesap Ekstresi",
    "Acilis bakiyesi: 10.000,00",
    "02.01.2026",
    "03.01.2026",
    "EFT GELEN REDACTED A",
    "HAVALE GIDEN REDACTED B",
    "1.500,00",
    "0,00",
    "0,00",
    "250,00",
    "11.500,00",
    "11.250,00",
    "Kapanis bakiyesi: 11.250,00",
  ].join("\n");
  const fin = finalizeOcrPagesToParseResult(
    [{ page: 1, text: columnar, confidence: 0.91 }],
    { selectedBank: "VAKIFBANK", ocrProvider: "google-vision" }
  );
  assert.notEqual(fin.code, "OCR_NO_MOVEMENTS");
  assert.equal(fin.ocrUsed, true);
  assert.ok((fin.transactions || []).length >= 2, "columnar txCount>=2");
  console.log("PASS  columnar Vision layout → txs (no OCR_NO_MOVEMENTS)");
})();

await (async function splitRowLayout() {
  const split = [
    "VakifBank Hesap Ekstresi",
    "02.01.2026",
    "EFT GELEN REDACTED C",
    "1.500,00",
    "0,00",
    "11.500,00",
    "03.01.2026",
    "POS TAHSILAT REDACTED D",
    "800,00",
    "0,00",
    "12.300,00",
  ].join("\n");
  const norm = normalizeOcrStatementText(split);
  const fin = finalizeOcrPagesToParseResult(
    [{ page: 1, text: split, confidence: 0.9 }],
    { selectedBank: "VAKIFBANK", ocrProvider: "google-vision" }
  );
  assert.match(norm, /02\.01\.2026/);
  assert.notEqual(fin.code, "OCR_NO_MOVEMENTS");
  assert.ok((fin.transactions || []).length >= 2);
  console.log("PASS  split-row OCR layout → txs");
})();

await (async function apostropheAmount() {
  const raw = [
    "02.01.2026 EFT GELEN REDACTED E 1'500,00 0,00 11.500,00",
  ].join("\n");
  const fin = finalizeOcrPagesToParseResult(
    [{ page: 1, text: raw, confidence: 0.9 }],
    { selectedBank: "VAKIFBANK", ocrProvider: "local-test" }
  );
  assert.ok((fin.transactions || []).length >= 1);
  assert.ok(Math.abs(Math.abs(fin.transactions[0].amount) - 1500) < 0.01);
  console.log("PASS  apostrophe amount 1'500,00");
})();

const PDF_PATH = path.resolve(
  process.env.USERPROFILE || process.env.HOME || "",
  "Desktop",
  "00158018033466201.pdf"
);
if (fs.existsSync(PDF_PATH)) {
  const buf = fs.readFileSync(PDF_PATH);
  const r = await parseBankStatementPdf(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    { selectedBank: "VAKIFBANK" }
  );
  assert.notEqual(r.code, "OCR_NO_MOVEMENTS");
  assert.ok(
    (r.transactions || []).length > 0,
    "real PDF must yield movements via pdfjs+normalize"
  );
  console.log(
    JSON.stringify({
      realPdf: "PASS",
      code: r.code,
      txCount: (r.transactions || []).length,
      ocrRequired: Boolean(r.ocrRequired),
      extractPath: r.extractDiagnostics?.extractPath,
      pdfjsOk: Boolean(r.extractDiagnostics?.pdfjsOk),
    })
  );
  const { extractEmbeddedRasterPages } = await import(
    "@/src/utils/bankOcr/extractEmbeddedRasterPages.js"
  );
  const emb = extractEmbeddedRasterPages(buf, { maxPages: 5 });
  assert.equal(emb.length, 0, "logo JPEG must not be OCR page");
  console.log(JSON.stringify({ embeddedPageCount: emb.length }));
} else {
  console.log("SKIP  real PDF not on Desktop");
}

console.log("All VakıfBank OCR layout regression checks passed.");
