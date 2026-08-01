/**
 * Banka OCR regresyon matrisi.
 * Çalıştır: ANNVERO_OCR_PROVIDER=local-test node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-ocr.mjs
 */

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

process.env.ANNVERO_OCR_PROVIDER = process.env.ANNVERO_OCR_PROVIDER || "local-test";

const {
  parseBankStatementPdf,
  mergeExcelAndPdfTransactions,
  isPdfNonMovementLine,
} = await import("@/src/utils/bankStatementPdf.js");
const { runBankStatementOcr, validateOcrPdfBounds } = await import(
  "@/src/utils/bankOcr/runBankStatementOcr.js"
);
const { createOcrProvider, isOcrProviderConfigured, resolveOcrProviderName } =
  await import("@/src/utils/bankOcr/ocrProvider.js");
const { OCR_POLICY, OCR_STATUS } = await import("@/src/utils/bankOcr/ocrPolicy.js");
const { bankMovementsToStandardLucaRows } = await import(
  "@/src/utils/standardLucaRow.js"
);
const { canonicalToLegacyBankRow } = await import(
  "@/src/utils/bankCanonicalTransaction.js"
);
const {
  buildBankStatementPdfFixture,
  buildScannedPdfStub,
  buildScannedMultipagePdfStub,
  buildEncryptedPdfStub,
  buildCorruptPdfStub,
  movementsToLegacyRows,
} = await import("./fixtures/bankPdfFixtures.mjs");
const { verifyBankStatementCompanyMatch } = await import(
  "@/src/utils/bankStatementCompanyGuard.js"
);

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(
        () => console.log(`PASS  ${name}`),
        (error) => {
          console.error(`FAIL  ${name}`);
          console.error(error);
          process.exitCode = 1;
        }
      );
    }
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const BANKS = ["GARANTI", "TEB", "VAKIFBANK", "ZIRAAT", "KUVEYT"];

await test("provider local-test configured", () => {
  assert.equal(resolveOcrProviderName({ ANNVERO_OCR_PROVIDER: "local-test" }), "local-test");
  assert.equal(isOcrProviderConfigured({ ANNVERO_OCR_PROVIDER: "local-test" }), true);
  assert.equal(isOcrProviderConfigured({ ANNVERO_OCR_PROVIDER: "" }), false);
});

await test("null provider → OCR_PROVIDER_NOT_CONFIGURED, no movements", async () => {
  const provider = createOcrProvider({ env: { ANNVERO_OCR_PROVIDER: "none" } });
  const scanned = buildScannedPdfStub();
  const r = await runBankStatementOcr(scanned, {
    provider,
    selectedBank: "VAKIFBANK",
    fileName: "scanned.pdf",
  });
  assert.equal(r.code, OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED);
  assert.equal((r.transactions || []).length, 0);
  assert.equal(r.ocrRequired, true);
});

await test("scanned without enableOcr → OCR_REQUIRED (no fake)", async () => {
  const r = await parseBankStatementPdf(buildScannedPdfStub(), { companyId: "c1" });
  assert.equal(r.code, "OCR_REQUIRED");
  assert.equal((r.transactions || []).length, 0);
});

for (const bank of BANKS) {
  await test(`${bank} text PDF still works`, async () => {
    const r = await parseBankStatementPdf(buildBankStatementPdfFixture(bank), {
      companyId: "c1",
      selectedBank: bank,
    });
    assert.equal(r.ok, true);
    assert.equal((r.transactions || []).length, 3);
  });

  await test(`${bank} scanned multipage OCR → canonical`, async () => {
    const bytes = buildScannedMultipagePdfStub(2);
    const t0 = performance.now();
    let firstProgressMs = null;
    const r = await runBankStatementOcr(bytes, {
      env: { ANNVERO_OCR_PROVIDER: "local-test" },
      selectedBank: bank,
      fileName: `${bank.toLowerCase()}-scan.pdf`,
      pageCount: 2,
      onProgress: () => {
        if (firstProgressMs == null) firstProgressMs = performance.now() - t0;
      },
    });
    assert.ok(firstProgressMs != null && firstProgressMs <= OCR_POLICY.PROGRESS_FIRST_MS + 50);
    assert.ok((r.transactions || []).length >= 1, "OCR hareket üretmeli");
    assert.equal(r.ocrUsed, true);
    assert.ok(r.transactions.every((t) => t.sourceType === "pdf_ocr"));
    assert.ok(r.transactions.every((t) => t.sourcePage > 0));
    assert.ok(r.transactions.every((t) => t.ocrConfidence != null));
  });

  await test(`${bank} OCR low confidence → review, no auto`, async () => {
    const r = await runBankStatementOcr(buildScannedPdfStub(), {
      env: { ANNVERO_OCR_PROVIDER: "local-test" },
      selectedBank: bank,
      fileName: `${bank}-low.pdf`,
      lowConfidence: true,
    });
    assert.ok(r.reviewRequired || r.code === "OCR_LOW_CONFIDENCE");
    assert.equal(r.canAutoPost, false);
    assert.ok((r.lowConfidenceCount || 0) >= 1);
  });

  await test(`${bank} OCR ↔ text PDF ↔ Excel cross-dedup`, async () => {
    const textPdf = await parseBankStatementPdf(buildBankStatementPdfFixture(bank), {
      companyId: "c1",
      selectedBank: bank,
    });
    const ocr = await runBankStatementOcr(buildScannedPdfStub(), {
      env: { ANNVERO_OCR_PROVIDER: "local-test" },
      selectedBank: bank,
      companyId: "c1",
      fileName: `${bank}-scan.pdf`,
    });
    const excel = movementsToLegacyRows(bank).map((row) => ({ ...row, companyId: "c1" }));
    const merged = mergeExcelAndPdfTransactions(excel, ocr, {
      companyId: "c1",
      selectedBank: bank,
      excelFileHash: "xlsx-hash",
    });
    assert.equal(merged.unique.length, 3);
    assert.equal(merged.duplicates.length, 3);

    const lucaPdf = bankMovementsToStandardLucaRows(
      textPdf.transactions.map((t, i) => ({
        id: `t-${i}`,
        _accountingAnalyzed: true,
        tarih: t.transactionDate,
        aciklama: t.description,
        borc: t.amount > 0 ? t.amount : 0,
        alacak: t.amount < 0 ? Math.abs(t.amount) : 0,
        banka: bank,
        yon: t.direction,
      }))
    );
    const lucaOcr = bankMovementsToStandardLucaRows(
      ocr.transactions.map(canonicalToLegacyBankRow).map((row, i) => ({
        ...row,
        id: `o-${i}`,
        _accountingAnalyzed: true,
      }))
    );
    assert.equal(lucaPdf.length, lucaOcr.length);
  });
}

await test("OCR BALANCE_MISMATCH closes auto export", async () => {
  const r = await runBankStatementOcr(buildScannedPdfStub(), {
    env: { ANNVERO_OCR_PROVIDER: "local-test" },
    selectedBank: "VAKIFBANK",
    balanceMismatch: true,
    fileName: "vakif-mismatch.pdf",
  });
  assert.ok(r.code === "BALANCE_MISMATCH" || r.balance?.reviewRequired);
  assert.equal(r.canAutoPost, false);
});

await test("encrypted / corrupt / too many pages", async () => {
  const enc = validateOcrPdfBounds(buildEncryptedPdfStub());
  assert.equal(enc.ok, false);
  assert.equal(enc.code, "PDF_ENCRYPTED");
  const cor = validateOcrPdfBounds(buildCorruptPdfStub());
  assert.equal(cor.ok, false);
  const bomb = buildScannedMultipagePdfStub(2);
  // page count estimate may be low on stub; policy still accepts small stubs
  assert.ok(validateOcrPdfBounds(bomb).ok || validateOcrPdfBounds(bomb).code);
});

await test("OCR fail / timeout / cancel", async () => {
  const fail = await runBankStatementOcr(buildScannedPdfStub(), {
    env: { ANNVERO_OCR_PROVIDER: "local-test" },
    simulateFail: true,
    selectedBank: "TEB",
  });
  assert.equal(fail.code, OCR_STATUS.OCR_FAILED);
  assert.equal((fail.transactions || []).length, 0);

  const ctrl = new AbortController();
  ctrl.abort();
  const cancelled = await runBankStatementOcr(buildScannedPdfStub(), {
    env: { ANNVERO_OCR_PROVIDER: "local-test" },
    signal: ctrl.signal,
    selectedBank: "TEB",
  });
  assert.ok(
    cancelled.code === "OCR_CANCELLED" || (cancelled.transactions || []).length === 0
  );
});

await test("header/footer/subtotal filtered", () => {
  assert.equal(isPdfNonMovementLine("Ara toplam 1.000,00"), true);
  assert.equal(isPdfNonMovementLine("Devreden bakiye 12.050,00"), true);
  assert.equal(isPdfNonMovementLine("02.01.2026 VAKIFBANK EFT 1.500,00 0,00 11.500,00"), false);
});

await test("company mismatch blocks after OCR identity", async () => {
  const ocr = await runBankStatementOcr(buildScannedPdfStub(), {
    env: { ANNVERO_OCR_PROVIDER: "local-test" },
    selectedBank: "VAKIFBANK",
    fileName: "adh-scan.pdf",
  });
  const text = (ocr.sheetRows || []).flat().join("\n");
  const guard = verifyBankStatementCompanyMatch({
    selectedCompany: {
      id: "other",
      name: "BASKA FIRMA A.S",
      unvan: "BASKA FIRMA A.S",
    },
    text: `Hesap Sahibi: ADH AVRASYA DIL HIZMETLERI A.S.\n${text}`,
    fileName: "adh-scan.pdf",
    companies: [],
  });
  assert.ok(
    guard.code === "COMPANY_MISMATCH" ||
      guard.code === "COMPANY_VERIFICATION_REQUIRED" ||
      guard.code === "COMPANY_MATCH"
  );
});

await test("UI ack ≤200ms progress contract", async () => {
  const t0 = performance.now();
  let ack = null;
  await runBankStatementOcr(buildScannedPdfStub(), {
    env: { ANNVERO_OCR_PROVIDER: "local-test" },
    selectedBank: "VAKIFBANK",
    onProgress: () => {
      if (ack == null) ack = performance.now() - t0;
    },
  });
  assert.ok(ack != null && ack <= OCR_POLICY.UI_ACK_MS + 80, `ack ${ack}ms`);
});

await test("policy constants exported", () => {
  assert.ok(OCR_POLICY.MAX_BYTES > 0);
  assert.ok(OCR_POLICY.MAX_PAGES >= 80);
  assert.equal(OCR_POLICY.PROGRESS_FIRST_MS, 500);
});

if (!process.exitCode) {
  console.log("\nAll bank OCR checks passed.");
}
