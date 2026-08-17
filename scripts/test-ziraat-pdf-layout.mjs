/**
 * Ziraat PDF — dekont (havale) vs ekstre ayrımı + yön/tutar/bakiye güvenliği.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-ziraat-pdf-layout.mjs
 *
 * NOT: Gerçek Ziraat hesap ekstresi PDF kabulü bu suite’te yapılmaz.
 * Statement fixture = sentetik; canlı ekstre dosyası yoksa ayrıca raporlanır.
 */
import assert from "node:assert/strict";
import {
  parseBankStatementPdf,
  parsePdfMovementLines,
  selectBestExtractCandidate,
  BANK_PDF_DOCUMENT_TYPE,
  classifyZiraatPdfDocument,
} from "@/src/utils/bankStatementPdf.js";
import {
  looksLikeZiraatPdfLayout,
  parseZiraatPdfLayout,
  parseZiraatDekontFromText,
  parseZiraatStatementFromText,
  ACCOUNT_OWNERSHIP_UNRESOLVED,
  extractZiraatReceiptMainAmount,
} from "@/src/utils/bankPdf/ziraatPdfLayout.js";
import {
  buildZiraatLayoutPdfFixture,
  buildZiraatDekontPdfFixture,
  buildZiraatDekontOwnershipPdfFixture,
  buildBankStatementPdfFixture,
} from "./fixtures/bankPdfFixtures.mjs";
import { bankMovementsToStandardLucaRows } from "@/src/utils/standardLucaRow.js";
import {
  dedupeCanonicalTransactions,
  buildSourceFileHash,
} from "@/src/utils/bankCanonicalTransaction.js";
import { evaluateBankOutputGate } from "@/src/utils/bankOneClickPipeline.js";
import { BALANCE_EVIDENCE_MISSING } from "@/src/utils/bankBalanceReconcile.js";

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

const FIRM_IBAN = "TR330001000000000000000001";
const OTHER_IBAN = "TR330006200000000000000002";

const FIRM_BANK_ACCOUNTS = [
  {
    bankName: "ZIRAAT",
    iban: FIRM_IBAN,
    accountNumber: "1000000000000001",
    lucaAccountCode: "102.01.006",
    isActive: true,
  },
];

const STATEMENT_TEXT = [
  "T.C. Ziraat Bankasi A.S. Hesap Ekstresi",
  "Muh Tarih Valor Sube Fis No Isl Kd Borc Alacak Bakiye",
  "10.01.2026 10.01.2026 ANON F100 EFT 100,00 0,00 900,00",
  "EFT GIDEN ANON FIRMA",
  "DEVAM ACIKLAMA SATIRI",
  "11.01.2026 11.01.2026 ANON F101 GEL 0,00 250,00 0,00",
  "GELEN HAVALE ANON",
  "--- page 2 ---",
  "Muh Tarih Valor Sube Fis No Isl Kd Borc Alacak Bakiye",
  "12.01.2026 12.01.2026 ANON F102 MSR 50,00 0,00 200,00",
  "MASRAF ANON SAYFA IKI",
  "Kapanis bakiyesi: 200,00",
].join("\n");

await test("documentType: statement vs transfer receipt vs unknown", () => {
  assert.equal(
    classifyZiraatPdfDocument(STATEMENT_TEXT),
    BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT
  );
  assert.equal(
    classifyZiraatPdfDocument(
      "Hesaptan TL Havale\nVALOR : 12.08.2025\nHavale Tutari : 10,00 TRY\nAciklama : ANON"
    ),
    BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT
  );
  assert.equal(
    classifyZiraatPdfDocument("T.C. Ziraat Bankasi random note"),
    BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT
  );
});

await test("looksLikeZiraatPdfLayout detects statement + dekont", () => {
  assert.equal(looksLikeZiraatPdfLayout(STATEMENT_TEXT), true);
  assert.equal(
    looksLikeZiraatPdfLayout(
      "Hesaptan TL Havale\nVALOR : 12.08.2025\nHavale Tutari : 10,00 TRY\nAciklama : ANON"
    ),
    true
  );
  assert.equal(looksLikeZiraatPdfLayout("Garanti BBVA random"), false);
});

await test("F) statement text fixture: movements + borc/alacak + balance + page", () => {
  const parsed = parseZiraatStatementFromText(STATEMENT_TEXT, { companyId: "c1" });
  assert.equal(parsed.transactions.length, 3);
  const [a, b, c] = parsed.transactions;
  assert.match(a.description, /EFT GIDEN/);
  assert.match(a.description, /DEVAM ACIKLAMA/);
  assert.equal(a.direction, "CIKIS");
  assert.equal(Number(a.balance), 900);
  assert.equal(b.direction, "GIRIS");
  assert.equal(Number(b.balance), 0);
  assert.equal(c.sourcePage, 2);
  assert.equal(c.direction, "CIKIS");
  const ids = new Set(parsed.transactions.map((t) => t.transactionId));
  assert.equal(ids.size, 3);
});

await test("A) receipt + firm sender certain → 1 CIKIS", () => {
  const text = [
    "T.C. Ziraat Bankasi",
    "Internet Bankaciligi Dekont",
    "VALOR : 12.08.2025",
    `Gonderen IBAN : ${FIRM_IBAN}`,
    `Alici IBAN : ${OTHER_IBAN}`,
    "Aciklama : ANON ODEME",
    "Havale Tutari : 4.770,00 TRY",
  ].join("\n");
  const parsed = parseZiraatDekontFromText(text, {
    companyId: "c1",
    bankAccounts: FIRM_BANK_ACCOUNTS,
  });
  assert.equal(parsed.documentType, BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT);
  assert.equal(parsed.transactions.length, 1);
  assert.equal(parsed.transactions[0].direction, "CIKIS");
  assert.equal(Math.abs(Number(parsed.transactions[0].amount)), 4770);
  assert.equal(parsed.diagnostics.detectedBank, "ZIRAAT");
  assert.equal(parsed.diagnostics.transactionCount, 1);
  assert.ok(parsed.diagnostics.directionResolution?.certain);
});

await test("B) receipt + firm receiver certain → 1 GIRIS", () => {
  const text = [
    "T.C. Ziraat Bankasi",
    "Internet Bankaciligi Dekont",
    "VALOR : 12.08.2025",
    `Gonderen IBAN : ${OTHER_IBAN}`,
    `Alici IBAN : ${FIRM_IBAN}`,
    "Aciklama : ANON TAHSILAT",
    "Havale Tutari : 250,00 TRY",
  ].join("\n");
  const parsed = parseZiraatDekontFromText(text, {
    companyId: "c1",
    bankAccounts: FIRM_BANK_ACCOUNTS,
  });
  assert.equal(parsed.transactions.length, 1);
  assert.equal(parsed.transactions[0].direction, "GIRIS");
  assert.equal(Math.abs(Number(parsed.transactions[0].amount)), 250);
});

await test("C) no ownership → 1 movement UNKNOWN + review + gate closed", async () => {
  const text = [
    "T.C. Ziraat Bankasi",
    "Hesaptan TL Havale",
    "VALOR : 12.08.2025",
    "Aciklama : ANON",
    "Havale Tutari : 100,00 TRY",
  ].join("\n");
  const parsed = parseZiraatDekontFromText(text, { companyId: "c1" });
  assert.equal(parsed.transactions.length, 1, "movement kept");
  assert.equal(parsed.transactions[0].direction, "UNKNOWN");
  assert.equal(parsed.transactions[0].reviewRequired, true);
  assert.equal(parsed.reviewReason, ACCOUNT_OWNERSHIP_UNRESOLVED);
  assert.equal(parsed.diagnostics.balanceEvidence, "none");
  assert.equal(parsed.diagnostics.outputGateClosed, true);

  const bytes = buildZiraatDekontPdfFixture();
  const result = await parseBankStatementPdf(bytes, { companyId: "c1" });
  assert.equal(result.documentType, BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT);
  assert.ok((result.transactions || []).length >= 1, "preview keeps movement");
  assert.equal(result.transactions[0].direction, "UNKNOWN");
  assert.equal(result.code, BALANCE_EVIDENCE_MISSING);
  assert.equal(result.balance?.openingBalance, null);
  assert.equal(result.balance?.closingBalance, null);
  assert.notEqual(result.balance?.openingBalance, 0);
  const gate = evaluateBankOutputGate({
    balanceCode: result.balance?.code,
    balanceMatched: result.balance?.matched,
    openingBalance: result.balance?.openingBalance,
    closingBalance: result.balance?.closingBalance,
    reviewRequired: true,
    fisKontrolPassed: false,
  });
  assert.equal(gate.allowed, false);
  assert.notEqual(gate.code, "OUTPUT_READY");
});

await test("D) transfer + fee + BSMV → main amount only", () => {
  const lines = [
    "T.C. Ziraat Bankasi",
    "VALOR : 12.08.2025",
    `Gonderen IBAN : ${FIRM_IBAN}`,
    `Alici IBAN : ${OTHER_IBAN}`,
    "Aciklama : ANON",
    "Havale Tutari : 1.000,00 TRY",
    "Masraf : 5,00 TRY",
    "BSMV : 1,00 TRY",
    "Toplam Masraf : 6,00 TRY",
  ];
  const amountInfo = extractZiraatReceiptMainAmount(lines);
  assert.equal(amountInfo.amount, 1000);
  assert.ok(amountInfo.feeCandidates.length >= 2);
  assert.equal(amountInfo.feeMovementsAuto, false);

  const parsed = parseZiraatDekontFromText(lines.join("\n"), {
    companyId: "c1",
    bankAccounts: FIRM_BANK_ACCOUNTS,
  });
  assert.equal(parsed.transactions.length, 1);
  assert.equal(Math.abs(Number(parsed.transactions[0].amount)), 1000);
  assert.notEqual(Math.abs(Number(parsed.transactions[0].amount)), 5);
  assert.notEqual(Math.abs(Number(parsed.transactions[0].amount)), 6);
  assert.notEqual(Math.abs(Number(parsed.transactions[0].amount)), 1);
});

await test("E) same receipt again → no duplicate movement/source (spy)", async () => {
  const bytes = buildZiraatDekontOwnershipPdfFixture({ firmRole: "sender" });
  const hash1 = buildSourceFileHash(bytes);
  const hash2 = buildSourceFileHash(bytes);
  assert.equal(hash1, hash2, "same bytes → same source hash");

  const ctx = { companyId: "c1", bankAccounts: FIRM_BANK_ACCOUNTS };
  const a = await parseBankStatementPdf(bytes, ctx);
  const b = await parseBankStatementPdf(bytes, ctx);
  assert.equal(a.sourceFileHash, b.sourceFileHash);
  assert.equal(a.transactions.length, 1);
  assert.equal(b.transactions.length, 1);
  assert.equal(a.transactions[0].transactionId, b.transactions[0].transactionId);

  const { unique, duplicates } = dedupeCanonicalTransactions([
    ...a.transactions,
    ...b.transactions,
  ]);
  assert.equal(unique.length, 1);
  assert.equal(duplicates.length, 1);

  // Drive/job spy: aynı hash ile ikinci persist çağrılmaz (unit stub)
  const driveSpy = { uploads: 0, jobs: 0 };
  const processOnce = (sourceHash, seen) => {
    if (seen.has(sourceHash)) {
      return { code: "DUPLICATE_CONTENT", drive: false, job: false };
    }
    seen.add(sourceHash);
    driveSpy.uploads += 1;
    driveSpy.jobs += 1;
    return { code: "OK", drive: true, job: true };
  };
  const seen = new Set();
  const first = processOnce(a.sourceFileHash, seen);
  const second = processOnce(b.sourceFileHash, seen);
  assert.equal(first.code, "OK");
  assert.equal(second.code, "DUPLICATE_CONTENT");
  assert.equal(driveSpy.uploads, 1);
  assert.equal(driveSpy.jobs, 1);
});

await test("generic parsePdfMovementLines FAILS on dekont (old 0); adapter → 1", () => {
  const dekont = [
    "T.C. Ziraat Bankasi",
    "Hesaptan TL Havale",
    "VALOR : 12.08.2025",
    "Aciklama : ANON",
    "Havale Tutari : 100,00 TRY",
  ].join("\n");
  assert.equal(parsePdfMovementLines(dekont).transactions.length, 0);
  assert.ok(parseZiraatPdfLayout({ text: dekont }).transactions.length >= 1);
});

await test("PDF statement fixture layout: >=3 movements (synthetic ≠ live accept)", async () => {
  const bytes = buildZiraatLayoutPdfFixture();
  const t0 = Date.now();
  const result = await parseBankStatementPdf(bytes, { companyId: "c1" });
  const elapsed = Date.now() - t0;
  assert.ok(
    result.ok || (result.transactions || []).length >= 3,
    `status=${result.status} code=${result.code}`
  );
  const txs = result.transactions || [];
  assert.ok(txs.length >= 3, `expected >=3 got ${txs.length}`);
  assert.equal(result.detectedBank, "ZIRAAT");
  assert.equal(result.documentType, BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT);
  const withBal = txs.filter((t) => t.balance != null && Number.isFinite(Number(t.balance)));
  assert.ok(withBal.length >= 3);
  assert.ok(txs.some((t) => Number(t.balance) === 0), "0,00 balance kept");
  assert.ok(txs.some((t) => t.direction === "CIKIS"));
  assert.ok(txs.some((t) => t.direction === "GIRIS"));
  assert.ok(elapsed < 8000, `perf ${elapsed}ms`);
});

await test("dekont PDF: old 0→1; ownership yok → UNKNOWN; BALANCE_EVIDENCE_MISSING", async () => {
  const bytes = buildZiraatDekontPdfFixture();
  const result = await parseBankStatementPdf(bytes, { companyId: "c1" });
  assert.equal(result.detectedBank || result.transactions?.[0]?.bank, "ZIRAAT");
  assert.ok(
    (result.transactions || []).length >= 1,
    `txs=${result.transactions?.length} code=${result.code}`
  );
  assert.notEqual(result.code, "OCR_REQUIRED");
  assert.equal(result.documentType, BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT);
  assert.equal(result.transactions[0].direction, "UNKNOWN");
  assert.equal(result.code, BALANCE_EVIDENCE_MISSING);
  assert.ok(result.diagnostics?.documentType);
  assert.ok(result.diagnostics?.parserMode);
});

await test("dekont PDF + ownership sender → CIKIS via parseBankStatementPdf", async () => {
  const bytes = buildZiraatDekontOwnershipPdfFixture({ firmRole: "sender" });
  const result = await parseBankStatementPdf(bytes, {
    companyId: "c1",
    bankAccounts: FIRM_BANK_ACCOUNTS,
  });
  assert.equal((result.transactions || []).length, 1);
  assert.equal(result.transactions[0].direction, "CIKIS");
  assert.equal(result.code, BALANCE_EVIDENCE_MISSING);
  assert.equal(result.diagnostics?.outputGateClosed, true);
});

await test("canonical == parse count; Luca = movements x 2 for resolved dirs", async () => {
  const bytes = buildZiraatLayoutPdfFixture();
  const result = await parseBankStatementPdf(bytes, { companyId: "c1" });
  const txs = result.transactions || [];
  assert.ok(txs.length >= 3);
  const movements = txs.map((t, i) => ({
    id: t.transactionId || `m${i}`,
    amount: Number(t.amount) || 0,
    direction: t.direction,
    description: t.description,
    transactionDate: t.transactionDate,
    bankName: "ZIRAAT",
    accountCode: "102.01.006",
  }));
  const luca = bankMovementsToStandardLucaRows(movements, {
    companyId: "c1",
    bankName: "ZIRAAT",
    kaynakAdi: "ZIRAAT",
    bankAccounts: [{ bankName: "ZIRAAT", lucaCode: "102.01.006" }],
  });
  assert.equal(luca.length, movements.length * 2);
  const debit = luca.reduce((s, r) => s + (Number(r.borc) || 0), 0);
  const credit = luca.reduce((s, r) => s + (Number(r.alacak) || 0), 0);
  assert.ok(Math.abs(debit - credit) < 0.02, `debit ${debit} credit ${credit}`);
});

await test("G) Garanti fixture regression (Desktop sample yok → fixture + note)", async () => {
  const bytes = buildBankStatementPdfFixture("GARANTI");
  const result = await parseBankStatementPdf(bytes, {
    companyId: "c1",
    selectedBank: "GARANTI",
  });
  assert.equal((result.transactions || []).length, 3);
  console.log(
    "  note: Desktop Garanti real PDF not found — fixture used (not 11-movement live accept)"
  );
});

await test("extract-path selection still prefers structured pdfjs", () => {
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

await test("unparsed orphan rows → diagnostics not silent", () => {
  const text = [
    "T.C. Ziraat Bankasi Hesap Ekstresi",
    "Muh Tarih Valor Borc Alacak Bakiye",
    "ORPHAN LINE WITHOUT DATE AMOUNT",
    "10.01.2026 10.01.2026 10,00 0,00 100,00",
    "OK HAREKET",
  ].join("\n");
  const parsed = parseZiraatStatementFromText(text, {});
  assert.ok(parsed.warnings.some((w) => w.code === "orphan_row"));
  assert.ok((parsed.diagnostics?.skipped || []).some((s) => s.code === "orphan_row"));
  assert.equal(parsed.transactions.length, 1);
});

await test("havale word alone must NOT invent direction", () => {
  const text = [
    "T.C. Ziraat Bankasi",
    "Havale islemi",
    "VALOR : 01.01.2026",
    "Aciklama : havale",
    "Havale Tutari : 50,00 TRY",
  ].join("\n");
  const parsed = parseZiraatDekontFromText(text, { companyId: "c1" });
  assert.equal(parsed.transactions[0].direction, "UNKNOWN");
});

// —— Destek durumu (dürüst ayrım) ——
console.log("\n--- Destek durumu ---");
console.log(
  "Ziraat transfer receipt (havale dekontu): PASS — parse + ownership/direction + amount + gate"
);
console.log(
  "Ziraat account statement: GERÇEK DOSYA YOK / CANLI KABUL YAPILMADI (sentetik fixture PASS ≠ canlı kabul)"
);
console.log(
  "Garanti: fixture 3 movements PASS; Desktop 11-movement sample YOK"
);

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll Ziraat PDF layout tests passed.");
