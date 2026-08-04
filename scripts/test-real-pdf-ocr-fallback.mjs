/**
 * Gerçek PDF (00158018033466201.pdf) — OCR fallback sözleşmesi.
 * Sentetik fixture kabul edilmez. Vision çağrısı opsiyonel (ANNVERO_LIVE_OCR=1).
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-real-pdf-ocr-fallback.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isPdfBuffer,
  parseBankStatementPdf,
  shouldTriggerPdfOcrFallback,
} from "@/src/utils/bankStatementPdf.js";
import { createBankStatementSourceCheckpoint } from "@/src/utils/bankStatementSourceCheckpoint.js";

const PDF_PATH =
  process.env.ANNVERO_REAL_PDF_PATH ||
  path.resolve(
    process.env.USERPROFILE || process.env.HOME || "",
    "Desktop",
    "00158018033466201.pdf"
  );

assert.ok(fs.existsSync(PDF_PATH), `Gerçek PDF yok: ${PDF_PATH}`);
const buf = fs.readFileSync(PDF_PATH);
assert.ok(buf.byteLength > 1000, `PDF boş/çok küçük: ${buf.byteLength}`);
assert.equal(isPdfBuffer(buf), true, "PDF imzası %PDF- değil");
console.log(
  JSON.stringify({
    pathTail: path.basename(PDF_PATH),
    byteLength: buf.byteLength,
    pdfSig: buf.subarray(0, 8).toString("ascii"),
  })
);

const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const parsed = await parseBankStatementPdf(ab, {
  selectedBank: "VAKIFBANK",
  companyId: "84384297-270c-47cd-ac5a-d693ba80b84a",
});

assert.notEqual(
  parsed.code,
  "PDF_UNSUPPORTED_LAYOUT",
  "UNSUPPORTED OCR’siz kullanıcıya dönmemeli"
);
// pdf.js geometri + normalize ile hareket çıkarsa OCR gerekmez;
// aksi halde OCR_REQUIRED tetiklenmeli (UNSUPPORTED değil).
if ((parsed.transactions || []).length > 0) {
  assert.notEqual(parsed.code, "OCR_NO_MOVEMENTS");
  console.log(
    JSON.stringify({
      path: "pdfjs-text",
      code: parsed.code,
      tx: (parsed.transactions || []).length,
    })
  );
  console.log("PASS  real PDF → movements (no UNSUPPORTED / OCR_NO_MOVEMENTS)");
} else {
  assert.equal(shouldTriggerPdfOcrFallback(parsed), true);
  assert.equal(parsed.ocrRequired, true);
  assert.equal(parsed.code, "OCR_REQUIRED");
  console.log("PASS  real PDF → OCR_REQUIRED (not UNSUPPORTED)");
}

const cp = await createBankStatementSourceCheckpoint(
  new File([buf], "00158018033466201.pdf", { type: "application/pdf" })
);
assert.ok(cp.uint8Bytes.byteLength === buf.byteLength);
console.log("PASS  immutable checkpoint holds full real PDF bytes");

if (process.env.ANNVERO_LIVE_OCR === "1") {
  const { runBankStatementOcr } = await import(
    "@/src/utils/bankOcr/runBankStatementOcr.js"
  );
  const { createOcrProvider } = await import(
    "@/src/utils/bankOcr/ocrProvider.js"
  );
  const provider = createOcrProvider();
  const ocr = await runBankStatementOcr({
    bytes: ab,
    provider,
    selectedBank: "VAKIFBANK",
    companyId: "84384297-270c-47cd-ac5a-d693ba80b84a",
    fileName: "00158018033466201.pdf",
  });
  console.log(
    JSON.stringify({
      ocrUsed: ocr.ocrUsed,
      ocrProvider: ocr.ocrProvider,
      txCount: (ocr.transactions || []).length,
      code: ocr.code,
      reviewRequired: ocr.reviewRequired,
    })
  );
  assert.equal(ocr.ocrUsed, true);
  assert.ok((ocr.transactions || []).length > 0, "OCR txCount>0 beklenir");
  console.log("PASS  live OCR txCount>0");
} else {
  console.log("SKIP  live OCR (set ANNVERO_LIVE_OCR=1 + Vision creds)");
}

console.log("All real-pdf OCR fallback contract checks passed.");
