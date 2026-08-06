/**
 * PDF↔Excel parity after canonicalize: same missing-account groups, no false
 * Mükerrer on double-entry legs, shared reanalyze critical patch.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-pdf-excel-missing-account-parity.mjs
 */
import assert from "node:assert/strict";
import { canonicalToLegacyBankRow } from "@/src/utils/bankCanonicalTransaction.js";
import { buildParserOnlyMovement } from "@/src/utils/bankMovementMapper.js";
import { bankMovementToStandardLucaRows } from "@/src/utils/standardLucaRow.js";
import { analyzeStandardLucaRows, DUPLICATE_VOUCHER_UI_MESSAGE } from "@/src/utils/fisKontrolMerkezi.js";
import { buildCariResolutionGroups } from "@/src/utils/cariMissingResolutionGroups.js";
import { runVoucherControlStage } from "@/src/utils/annveroV1Orchestration.js";
import {
  buildPipelinePatchFromReanalyze,
  reanalyzeAfterMissingAccountApply,
} from "@/src/utils/missingAccountsReanalyze.js";
import { evaluateBankOutputGate } from "@/src/utils/bankOneClickPipeline.js";
import { classifyFisKontrolFindings, FINDING_CLASS } from "@/src/utils/fisKontrolFindingClasses.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

const COMPANY = "parity-mare-co";

/** Four true movements — PDF and Excel share this canonical shape after parse. */
const canonicalMoves = [
  {
    transactionId: "tx-1",
    bank: "VAKIFBANK",
    transactionDate: "02.01.2025",
    description: "GÖND HVL / ACME TEDARIK A.S.",
    direction: "CIKIS",
    amount: 1000,
    balance: 9000,
    currency: "TRY",
    accountIdentity: "TR00",
    sourceRow: 1,
    sourceFileHash: "abc",
  },
  {
    transactionId: "tx-2",
    bank: "VAKIFBANK",
    transactionDate: "03.01.2025",
    description: "GLN HVL / BETA LOJISTIK LTD",
    direction: "GIRIS",
    amount: 2500,
    balance: 11500,
    currency: "TRY",
    accountIdentity: "TR00",
    sourceRow: 2,
    sourceFileHash: "abc",
  },
  {
    transactionId: "tx-3",
    bank: "VAKIFBANK",
    transactionDate: "04.01.2025",
    description: "GÖND HVL / ACME TEDARIK A.S.",
    direction: "CIKIS",
    amount: 400,
    balance: 11100,
    currency: "TRY",
    accountIdentity: "TR00",
    sourceRow: 3,
    sourceFileHash: "abc",
  },
  {
    transactionId: "tx-4",
    bank: "VAKIFBANK",
    transactionDate: "05.01.2025",
    description: "POS TAHSILAT / MAGAZA",
    direction: "GIRIS",
    amount: 800,
    balance: 11900,
    currency: "TRY",
    accountIdentity: "TR00",
    sourceRow: 4,
    sourceFileHash: "abc",
  },
];

function lucaFromCanonical(sourceType) {
  const legacy = canonicalMoves.map((tx) => ({
    ...canonicalToLegacyBankRow(tx),
    sourceType,
  }));
  const context = {
    companyId: COMPANY,
    firmaId: COMPANY,
    bankName: "VAKIFBANK",
    selectedBank: "VAKIFBANK",
  };
  const movements = legacy.map((row, index) =>
    buildParserOnlyMovement(row, context, index)
  );
  const luca = [];
  movements.forEach((movement, index) => {
    luca.push(
      ...bankMovementToStandardLucaRows(movement, index + 1, {
        ...context,
        bankAccountCode: "102.01.001",
      })
    );
  });
  return { legacy, movements, luca };
}

test("PDF ve Excel legacy satırları aynı canonical alanları taşır", () => {
  const pdf = lucaFromCanonical("pdf");
  const xlsx = lucaFromCanonical("xlsx");
  assert.equal(pdf.movements.length, 4);
  assert.equal(xlsx.movements.length, 4);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(pdf.movements[i].direction, xlsx.movements[i].direction);
    assert.equal(
      Math.abs(Number(pdf.movements[i].amount)),
      Math.abs(Number(xlsx.movements[i].amount))
    );
    assert.equal(
      String(pdf.movements[i].description || "").trim(),
      String(xlsx.movements[i].description || "").trim()
    );
  }
});

test("çift kayıt bacakları false Mükerrer üretmez (PDF/Excel ortak Luca)", () => {
  const { luca } = lucaFromCanonical("pdf");
  assert.equal(luca.length, 8, "4 hareket → 8 Luca satırı");
  const analysis = analyzeStandardLucaRows(luca, { firmaId: COMPANY });
  const mukerrerKaynak = (analysis.issues || []).filter(
    (i) => i.type === "Mükerrer kaynak hareket"
  );
  assert.equal(mukerrerKaynak.length, 0, "false Mükerrer kaynak yok");
  assert.ok(
    !(analysis.issues || []).some((i) => i.message === DUPLICATE_VOUCHER_UI_MESSAGE),
    "DUPLICATE_VOUCHER yok"
  );
});

test("PDF ve Excel aynı eksik-hesap çözüm gruplarını üretir", () => {
  const pdf = lucaFromCanonical("pdf");
  const xlsx = lucaFromCanonical("xlsx");
  const markMissing = (rows) =>
    rows.map((r) => {
      const isBank = String(r.hesapKodu || "").startsWith("102");
      if (isBank) return r;
      return {
        ...r,
        hesapKodu: "",
        riskDurumu: "HESAP_EKSIK",
        missingHesapCategory: "Cari bulunamadı",
        cariRequired: true,
      };
    });

  const pdfSnap = buildCariResolutionGroups(markMissing(pdf.luca), {
    selectedBank: "VAKIFBANK",
  });
  const xlsxSnap = buildCariResolutionGroups(markMissing(xlsx.luca), {
    selectedBank: "VAKIFBANK",
  });
  assert.equal(pdfSnap.totalMissing, xlsxSnap.totalMissing);
  assert.equal(pdfSnap.groupCount, xlsxSnap.groupCount);
  assert.ok(pdfSnap.groupCount >= 1);
  const pdfKeys = pdfSnap.groups.map((g) => g.analysisKey || g.id).sort();
  const xlsxKeys = xlsxSnap.groups.map((g) => g.analysisKey || g.id).sort();
  assert.deepEqual(pdfKeys, xlsxKeys);
});

test("reanalyze critical patch stale kalmaz; gate yalnız gerçek eksik hesaba bağlı", () => {
  const { luca } = lucaFromCanonical("pdf");
  const withMissing = luca.map((r) =>
    String(r.hesapKodu || "").startsWith("102")
      ? r
      : {
          ...r,
          hesapKodu: "",
          riskDurumu: "HESAP_EKSIK",
          missingHesapCategory: "Cari bulunamadı",
          cariRequired: true,
        }
  );
  const fis = runVoucherControlStage(withMissing, { companyId: COMPANY });
  const classes = classifyFisKontrolFindings(fis.analysis || {});
  assert.ok(
    classes.classes.some((c) => c.id === FINDING_CLASS.MISSING_ACCOUNT),
    "eksik hesap sınıfı var"
  );
  assert.ok(
    !classes.classes.some((c) => c.id === FINDING_CLASS.DUPLICATE),
    "false mükerrer sınıfı yok"
  );

  const patch = buildPipelinePatchFromReanalyze({
    missingReport: { missingCount: 4, uniqueUnresolvedMovements: 4 },
    fisKontrol: fis,
    findingClasses: classes,
  });
  assert.equal(patch.critical, fis.critical);
  assert.equal(patch.errors, fis.errors);

  const gateBlocked = evaluateBankOutputGate({
    ...patch,
    balanceMatched: true,
    balanceCode: "BALANCE_MATCHED",
    duplicate: false,
    movementCount: 4,
  });
  assert.equal(gateBlocked.code, "CRITICAL_FINDINGS");

  const cleared = withMissing.map((r) =>
    r.hesapKodu
      ? r
      : { ...r, hesapKodu: "320.01.999", riskDurumu: "", missingHesapCategory: "" }
  );
  const re = reanalyzeAfterMissingAccountApply({
    lucaRows: cleared,
    companyId: COMPANY,
    skipMemoryPass: true,
  });
  assert.equal(re.pipelinePatch.critical, re.fisKontrol.critical);
  assert.equal(re.missingReport.missingCount, 0);
  const gateOpen = evaluateBankOutputGate({
    ...re.pipelinePatch,
    balanceMatched: true,
    balanceCode: "BALANCE_MATCHED",
    duplicate: false,
    movementCount: 4,
    lucaReady: true,
  });
  // Fiş Kontrol / düşük güven / review hâlâ engelleyebilir; mükerrer kaynak engeli olmamalı
  assert.notEqual(gateOpen.code, "DUPLICATE_CONTENT");
  assert.ok(
    !(re.findingClasses?.classes || []).some((c) => c.id === FINDING_CLASS.DUPLICATE),
    "temizlenmiş satırlarda mükerrer sınıfı yok"
  );
});

console.log("All pdf-excel-missing-account-parity tests passed.");
