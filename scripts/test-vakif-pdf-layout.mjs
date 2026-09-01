/**
 * VakıfBank PDF — 2-token tutar/bakiye + Ziraat dekont false-positive kapısı.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-vakif-pdf-layout.mjs
 */
import assert from "node:assert/strict";
import {
  parseBankStatementPdf,
  parsePdfMovementLines,
  selectBestExtractCandidate,
  BANK_PDF_DOCUMENT_TYPE,
} from "@/src/utils/bankStatementPdf.js";
import {
  applyVakifRunningBalanceSigns,
  classifyVakifPdfDocument,
  looksLikeVakifStatement,
  parseVakifStatementTextFallback,
} from "@/src/utils/bankPdf/vakifPdfLayout.js";
import {
  buildVakifTwoTokenPdfFixture,
  buildBankStatementPdfFixture,
  buildZiraatDekontPdfFixture,
  buildZiraatDekontOwnershipPdfFixture,
  buildVakifCoordRefBleedPdfFixture,
  buildVakifTextRefBleedPdfFixture,
  buildVakifTextRefBleedLines,
} from "./fixtures/bankPdfFixtures.mjs";
import { bankMovementsToStandardLucaRows } from "@/src/utils/standardLucaRow.js";
import { dedupeCanonicalTransactions } from "@/src/utils/bankCanonicalTransaction.js";
import { evaluateBankOutputGate } from "@/src/utils/bankOneClickPipeline.js";
import { ACCOUNT_OWNERSHIP_UNRESOLVED } from "@/src/utils/bankPdf/ziraatPdfLayout.js";

let failed = 0;
function test(name, fn) {
  try {
    const ret = fn();
    if (ret && typeof ret.then === "function") {
      return ret.then(
        () => console.log(`PASS  ${name}`),
        (e) => {
          failed += 1;
          console.log(`FAIL  ${name}`);
          console.error(String(e?.stack || e));
        }
      );
    }
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.error(String(e?.stack || e));
  }
}

await test("generic 2-token keeps unsigned tutar as GIRIS (old FAIL)", () => {
  const text = [
    "VakifBank Hesap Ekstresi",
    "01.01.2026 EFT GELEN ANON A 1.000,00 11.000,00",
    "02.01.2026 HAVALE GIDEN ANON B 2.000,00 9.000,00",
  ].join("\n");
  const generic = parsePdfMovementLines(text, { selectedBank: "VAKIFBANK" });
  assert.equal(generic.transactions.length, 2);
  assert.equal(generic.transactions[1].direction, "GIRIS");
});

await test("running-balance adapter flips CIKIS from bakiye delta", () => {
  const generic = parsePdfMovementLines(
    [
      "VakifBank Hesap Ekstresi",
      "01.01.2026 EFT GELEN ANON A 1.000,00 11.000,00",
      "02.01.2026 HAVALE GIDEN ANON B 2.000,00 9.000,00",
    ].join("\n"),
    { selectedBank: "VAKIFBANK" }
  );
  const fixed = applyVakifRunningBalanceSigns(generic.transactions);
  assert.equal(fixed[1].direction, "CIKIS");
  assert.ok(Number(fixed[1].amount) < 0);
  assert.equal(Math.abs(Number(fixed[1].amount)), 2000);
});

await test("fixture PDF: BANK_STATEMENT not Ziraat receipt", async () => {
  const bytes = buildVakifTwoTokenPdfFixture();
  const result = await parseBankStatementPdf(bytes);
  assert.equal(result.detectedBank, "VAKIFBANK");
  assert.equal(result.documentType, BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT);
  assert.notEqual(result.documentType, BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT);
  assert.equal((result.transactions || []).length, 2);
  assert.equal(result.transactions[0].direction, "GIRIS");
  assert.equal(result.transactions[1].direction, "CIKIS");
  assert.equal(result.balance?.code, "BALANCE_MATCHED");
  assert.equal(result.balance?.matched, true);
  assert.ok(
    looksLikeVakifStatement("VakifBank Hesap Ekstresi Hesap Hareketleri VADESIZ TL")
  );
  assert.equal(
    classifyVakifPdfDocument("VakifBank Hesap Ekstresi Hesap Hareketleri"),
    BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT
  );
});

await test("canonical + Luca rows stay balanced", async () => {
  const bytes = buildVakifTwoTokenPdfFixture();
  const result = await parseBankStatementPdf(bytes, { companyId: "c1" });
  const { unique, duplicates } = dedupeCanonicalTransactions(result.transactions);
  assert.equal(unique.length, 2);
  assert.equal((duplicates || []).length, 0);
  const luca = bankMovementsToStandardLucaRows(
    unique.map((t) => ({
      ...t,
      description: t.description,
      transactionDate: t.transactionDate,
      bankName: "VAKIFBANK",
      accountCode: "102.01.001",
    })),
    {
      companyId: "c1",
      bankName: "VAKIFBANK",
      kaynakAdi: "VAKIFBANK",
      bankAccounts: [{ bankName: "VAKIFBANK", lucaCode: "102.01.001" }],
    }
  );
  assert.equal(luca.length, unique.length * 2);
  const debit = luca.reduce((s, r) => s + (Number(r.borc) || 0), 0);
  const credit = luca.reduce((s, r) => s + (Number(r.alacak) || 0), 0);
  assert.ok(Math.abs(debit - credit) < 0.02);
});

await test("one-click gate opens when balance matched", async () => {
  const bytes = buildVakifTwoTokenPdfFixture();
  const result = await parseBankStatementPdf(bytes);
  const gate = evaluateBankOutputGate({
    balanceCode: result.balance?.code,
    balanceMatched: result.balance?.matched,
    matched: result.balance?.matched,
    delta: result.balance?.delta,
    openingBalance: result.balance?.openingBalance,
    closingBalance: result.balance?.closingBalance,
    reviewRequired: false,
    errors: 0,
    critical: 0,
    missingCount: 0,
    lucaReady: true,
    fisKontrolPassed: true,
  });
  assert.equal(gate.code, "OUTPUT_READY");
});

await test("3-token Vakıf fixture still parses (no regression)", async () => {
  const bytes = buildBankStatementPdfFixture("VAKIFBANK");
  const result = await parseBankStatementPdf(bytes, { selectedBank: "VAKIFBANK" });
  assert.ok((result.transactions || []).length >= 3);
  assert.equal(result.detectedBank, "VAKIFBANK");
});

await test("Ziraat dekont ownership gate unchanged", async () => {
  const bytes = buildZiraatDekontOwnershipPdfFixture({ firmRole: "sender" });
  const result = await parseBankStatementPdf(bytes, {
    companyId: "c1",
    bankAccounts: [
      { bankName: "ZIRAAT", iban: "TR330001000000000000000001", isActive: true },
    ],
  });
  assert.equal(result.detectedBank, "ZIRAAT");
  assert.equal(result.documentType, BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT);
  assert.equal((result.transactions || []).length, 1);
  assert.equal(result.transactions[0].direction, "CIKIS");
});

await test("Ziraat dekont without ownership stays UNKNOWN", async () => {
  const bytes = buildZiraatDekontPdfFixture();
  const result = await parseBankStatementPdf(bytes);
  assert.equal(result.documentType, BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT);
  assert.equal(result.transactions[0].direction, "UNKNOWN");
  assert.ok(
    result.reviewReason === ACCOUNT_OWNERSHIP_UNRESOLVED ||
      result.transactions[0].reviewReason === ACCOUNT_OWNERSHIP_UNRESOLVED ||
      result.reviewRequired
  );
});

await test("coord fixture: ref suffix 468/757 never bleed into amount", async () => {
  const bytes = buildVakifCoordRefBleedPdfFixture();
  const result = await parseBankStatementPdf(bytes, { selectedBank: "VAKIFBANK" });
  assert.ok((result.transactions || []).length >= 3);
  const amounts = result.transactions.map((t) => Number(t.amount));
  assert.ok(!amounts.some((a) => Math.abs(a) >= 468000000));
  assert.ok(!amounts.some((a) => Math.abs(a - 468173000) < 1));
  assert.equal(Math.abs(amounts[0]), 173000);
  assert.ok(Math.abs(Math.abs(amounts[1]) - 966.9) < 0.02);
  const mareLike = result.transactions.find((t) => Math.abs(Number(t.amount)) >= 1000000);
  assert.ok(mareLike);
  assert.ok(Math.abs(Math.abs(Number(mareLike.amount)) - 1018500) < 0.02);
});

await test("scaled coord fixture still separates columns", async () => {
  const bytes = buildVakifCoordRefBleedPdfFixture({ scale: 1.15 });
  const result = await parseBankStatementPdf(bytes, { selectedBank: "VAKIFBANK" });
  assert.ok((result.transactions || []).length >= 3);
  assert.equal(Math.abs(Number(result.transactions[0].amount)), 173000);
});

await test("multipage coord fixture keeps amounts clean", async () => {
  const bytes = buildVakifCoordRefBleedPdfFixture({ multipage: true });
  const result = await parseBankStatementPdf(bytes, { selectedBank: "VAKIFBANK" });
  assert.ok((result.transactions || []).length >= 3);
  assert.ok(!result.transactions.some((t) => Math.abs(Number(t.amount)) >= 468000000));
});

await test("text fallback strips ref before amount regex", () => {
  const text = buildVakifTextRefBleedLines();
  const parsed = parseVakifStatementTextFallback(text, { selectedBank: "VAKIFBANK" });
  assert.equal(parsed.transactions.length, 4);
  assert.equal(Math.abs(Number(parsed.transactions[0].amount)), 173000);
  assert.ok(Math.abs(Math.abs(Number(parsed.transactions[1].amount)) - 966.9) < 0.02);
  assert.ok(!parsed.transactions.some((t) => Math.abs(Number(t.amount)) >= 468000000));
});

await test("text-bleed PDF fixture via full parse path", async () => {
  const bytes = buildVakifTextRefBleedPdfFixture();
  const result = await parseBankStatementPdf(bytes, { selectedBank: "VAKIFBANK" });
  assert.ok((result.transactions || []).length >= 3);
  assert.equal(Math.abs(Number(result.transactions[0].amount)), 173000);
  assert.ok(!String(JSON.stringify(result)).includes("468173000"));
  assert.ok(!String(JSON.stringify(result)).includes("468000000"));
});

await test("Garanti extract-path pdfjs still wins over latin1 garbage", () => {
  const pdfjs = [
    "Garanti BBVA Hesap Ekstresi",
    "01.03.2026 HAVALE GELEN ABC 0,00 1.250,00 10.000,00",
    "02.03.2026 EFT GIDEN XYZ 500,00 0,00 9.500,00",
  ].join("\n");
  const latin1 = ("stream noise " + "Z".repeat(200) + " 01.02.2026\n").repeat(30);
  const selection = selectBestExtractCandidate([
    { name: "latin1", text: latin1 },
    { name: "pdfjs", text: pdfjs },
  ]);
  assert.equal(selection.winner?.name, "pdfjs");
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll VakıfBank PDF layout checks passed.");
process.exit(0);
