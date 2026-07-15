/**
 * Kredi Kartı Motoru V1 — unit tests
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-credit-card-engine.mjs
 */
import assert from "node:assert/strict";
import {
  isCreditCardPaymentDescription,
  isPosOrCommissionNotCardDebt,
  extractCardLast4FromText,
  extractStatementPeriodFromText,
  resolveCreditCardPayment,
  getCreditCardAccount,
  findCreditCardAccountsByPlanName,
  buildCreditCardGroupKey,
  creditCardStatementPeriodKey,
  CREDIT_CARD_CLASSIFICATION,
} from "@/src/utils/creditCardAccountResolver.js";
import {
  buildCariResolutionGroups,
  isCreditCardMissingRow,
  isCariMissingRow,
  searchCreditCardResolutionCandidates,
  buildCariApplyGroupPayload,
} from "@/src/utils/cariMissingResolutionGroups.js";
import { isVirmanCandidateTransfer } from "@/src/utils/bankInternalTransfer.js";
import {
  classifyMissingHesapCategory,
  MISSING_HESAP_CATEGORY,
} from "@/src/utils/previewExportValidation.js";
import { BANK_TRANSACTION_TYPE } from "@/src/utils/bankTransactionType.js";

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result
        .then(() => console.log(`PASS ${name}`))
        .catch((e) => {
          console.error(`FAIL ${name}`);
          throw e;
        });
    }
    console.log(`PASS ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("1) ****6725 MAYIS 2026 EKSTRESİ ÖDEME → CREDIT_CARD_PAYMENT", () => {
  const desc = "****6725 MAYIS 2026 EKSTRESİ ÖDEME";
  assert.equal(isCreditCardPaymentDescription(desc), true);
  const r = resolveCreditCardPayment({ description: desc });
  assert.equal(r.isCreditCardPayment, true);
  assert.equal(r.classification, CREDIT_CARD_CLASSIFICATION);
  assert.equal(r.lastFourDigits, "6725");
  assert.equal(r.periodMonth, 5);
  assert.equal(r.periodYear, 2026);
});

test("2) Firma kartında ****6725 + Garanti → doğru 309", () => {
  const company = {
    creditCards: [
      {
        bankName: "GARANTI",
        cardName: "Bonus",
        lastFourDigits: "6725",
        trackingMethod: "TEK_HESAP",
        singleLucaAccountCode: "309.01.001",
        isActive: true,
      },
    ],
  };
  const plan = [
    {
      accountCode: "309.01.001",
      accountName: "Garanti Bonus ****6725",
      isActive: true,
    },
  ];
  const r = resolveCreditCardPayment({
    company,
    description: "****6725 MAYIS 2026 EKSTRESİ ÖDEME",
    paymentDate: "15.06.2026",
    selectedBank: "GARANTI",
    companyPlans: plan,
  });
  assert.equal(r.accountCode, "309.01.001");
  assert.equal(r.ambiguous, false);
  assert.ok(r.confidence >= 75);
});

test("3) Aynı son 4 hane iki kartta → otomatik yok", () => {
  const company = {
    creditCards: [
      {
        bankName: "GARANTI",
        lastFourDigits: "6725",
        trackingMethod: "TEK_HESAP",
        singleLucaAccountCode: "309.01.001",
        isActive: true,
      },
      {
        bankName: "VAKIFBANK",
        lastFourDigits: "6725",
        trackingMethod: "TEK_HESAP",
        singleLucaAccountCode: "309.02.001",
        isActive: true,
      },
    ],
  };
  const r = resolveCreditCardPayment({
    company,
    description: "****6725 EKSTRE ÖDEME",
    selectedBank: "",
  });
  assert.equal(r.ambiguous, true);
  assert.equal(r.accountCode, "");
  assert.ok(r.matches.length >= 2);
});

test("4) POS tahsilatı → kart borcu değil", () => {
  assert.equal(isPosOrCommissionNotCardDebt("POS TAHSILAT UYE ISYERI"), true);
  assert.equal(
    isCreditCardPaymentDescription("POS TAHSILAT ****6725"),
    false
  );
});

test("5) Kart komisyonu → kart borcu değil", () => {
  assert.equal(
    isCreditCardPaymentDescription("KREDI KARTI KOMISYON ****6725"),
    false
  );
});

test("6) Banka→kart: TEK_HESAP 309 borç kodu", () => {
  const card = {
    trackingMethod: "TEK_HESAP",
    singleLucaAccountCode: "309.01.001",
    lastFourDigits: "4289",
    statementPeriodRule: "ONCEKI_AY",
  };
  const g = getCreditCardAccount({
    creditCard: card,
    paymentDate: "10.06.2026",
    description: "****4289 MAYIS 2026 EKSTRESİ ÖDEME",
  });
  assert.equal(g.accountCode, "309.01.001");
  assert.equal(g.periodMonth, 5);
  assert.equal(g.periodYear, 2026);
});

test("7) Kart hesabı yok → çözüm grubuna düşer", () => {
  const rows = [
    {
      id: "kk1",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI,
      cariRequired: false,
      classification: CREDIT_CARD_CLASSIFICATION,
      missingHesapCategory: MISSING_HESAP_CATEGORY.KREDI_KARTI,
      detayAciklama: "****6725 MAYIS 2026 EKSTRESİ ÖDEME",
      borc: 1000,
      alacak: 0,
      fisTarihi: "2026-06-10",
      analysisKey: "kk|6725|CIKIS",
    },
  ];
  assert.equal(isCreditCardMissingRow(rows[0], {}), true);
  assert.equal(isCariMissingRow(rows[0], {}), false);
  const snap = buildCariResolutionGroups(rows, {}, {
    initialCandidateGroups: false,
  });
  assert.equal(snap.creditCardMissingCount, 1);
  assert.equal(snap.creditCardGroupCount, 1);
  assert.equal(snap.groupCount, 0);
  assert.equal(snap.virmanCandidateCount, 0);
});

test("8) Cari çözüm merkezine düşmez", () => {
  const row = {
    id: "kk2",
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
    transactionType: BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI,
    cariRequired: false,
    classification: CREDIT_CARD_CLASSIFICATION,
    missingHesapCategory: MISSING_HESAP_CATEGORY.KREDI_KARTI,
    detayAciklama: "KK ODEME ****4289",
    borc: 50,
    alacak: 0,
  };
  assert.equal(
    classifyMissingHesapCategory(row),
    MISSING_HESAP_CATEGORY.KREDI_KARTI
  );
  assert.equal(isCariMissingRow(row, {}), false);
});

test("9) Virman adayına düşmez", () => {
  const row = {
    id: "kk3",
    detayAciklama: "****6725 MAYIS 2026 EKSTRESİ ÖDEME",
    transactionType: BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI,
    virmanCandidate: false,
  };
  assert.equal(isVirmanCandidateTransfer(row, {}), false);
});

test("10) AY_BAZLI: hesap adından eşle — kod üretmez", () => {
  const period = extractStatementPeriodFromText(
    "*8444 MAYIS 2026 EKSTRESİ ÖDEME"
  );
  assert.equal(period.month, 5);
  assert.equal(period.year, 2026);
  const plan = [
    {
      accountCode: "309.01.005",
      accountName: "*8444 MAYIS AYI EKSTRESİ",
      isActive: true,
    },
    {
      accountCode: "309.01.006",
      accountName: "*8444 HAZIRAN AYI EKSTRESİ",
      isActive: true,
    },
  ];
  const card = {
    trackingMethod: "AY_BAZLI_309",
    monthly309BaseAccount: "309.01",
    lastFourDigits: "8444",
    statementPeriodRule: "ONCEKI_AY",
  };
  const g = getCreditCardAccount({
    creditCard: card,
    paymentDate: "15.06.2026",
    description: "*8444 MAYIS 2026 EKSTRESİ ÖDEME",
    companyPlans: plan,
  });
  assert.equal(g.periodMonth, 5);
  assert.equal(g.accountCode, "309.01.005");
  assert.equal(g.matchReason, "plan_name");
});

test("10b) AY_BAZLI: planda yoksa kod uydurma", () => {
  const card = {
    trackingMethod: "AY_BAZLI_309",
    monthly309BaseAccount: "309.01",
    lastFourDigits: "8444",
  };
  const g = getCreditCardAccount({
    creditCard: card,
    paymentDate: "15.06.2026",
    description: "*8444 MAYIS 2026 EKSTRESİ ÖDEME",
    companyPlans: [
      {
        accountCode: "309.01.001",
        accountName: "Diğer kart *9999",
        isActive: true,
      },
    ],
  });
  assert.equal(g.accountCode, "");
  assert.notEqual(g.accountCode, "309.01.005");
});

test("10c) birden fazla güçlü aday → manuel", () => {
  const plan = [
    {
      accountCode: "309.01.005",
      accountName: "*8444 MAYIS AYI EKSTRESİ",
      isActive: true,
    },
    {
      accountCode: "309.01.015",
      accountName: "*8444 MAYIS 2026 EKSTRE",
      isActive: true,
    },
  ];
  const found = findCreditCardAccountsByPlanName({
    companyPlans: plan,
    lastFourDigits: "8444",
    periodMonth: 5,
    periodYear: 2026,
  });
  assert.equal(found.ambiguous, true);
  assert.equal(found.autoCode, "");
  assert.ok(found.candidates.length >= 2);

  const g = getCreditCardAccount({
    creditCard: {
      trackingMethod: "AY_BAZLI_309",
      monthly309BaseAccount: "309.01",
      lastFourDigits: "8444",
    },
    description: "*8444 MAYIS 2026 EKSTRESİ",
    companyPlans: plan,
  });
  assert.equal(g.accountCode, "");
  assert.equal(g.ambiguous, true);
});

test("11) Seçili satırlara uygulama payload", () => {
  const group = {
    id: "kk:x",
    creditCardGroup: true,
    rowIds: ["a", "b", "c"],
    seedRow: { id: "a" },
    transactions: [
      { id: "a", learnSeed: { id: "a" } },
      { id: "b", learnSeed: { id: "b" } },
      { id: "c", learnSeed: { id: "c" } },
    ],
  };
  const payload = buildCariApplyGroupPayload(group, ["a", "c"]);
  assert.equal(payload.rowIds.length, 2);
  assert.equal(payload.isPartialApply, true);
});

test("12) Plan 309 aday arama", () => {
  const plan = [
    { accountCode: "309.01.001", accountName: "KK 6725", isActive: true },
    { accountCode: "320.01.001", accountName: "TEDARIK", isActive: true },
    { accountCode: "409.01.001", accountName: "KK uzun", isActive: true },
  ];
  const hits = searchCreditCardResolutionCandidates(plan, {
    lastFourDigits: "6725",
    limit: 5,
  });
  assert.ok(
    hits.every((h) => h.code.startsWith("309") || h.code.startsWith("409"))
  );
  assert.ok(hits.some((h) => h.code === "309.01.001"));
  assert.ok(!hits.some((h) => h.code.startsWith("320")));
});

test("13) Farklı ekstre ayları ayrı grup", () => {
  const rows = [
    {
      id: "m1",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI,
      classification: CREDIT_CARD_CLASSIFICATION,
      missingHesapCategory: MISSING_HESAP_CATEGORY.KREDI_KARTI,
      detayAciklama: "****6725 MAYIS 2026 EKSTRESİ ÖDEME",
      borc: 100,
      alacak: 0,
      fisTarihi: "2026-06-10",
    },
    {
      id: "m2",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI,
      classification: CREDIT_CARD_CLASSIFICATION,
      missingHesapCategory: MISSING_HESAP_CATEGORY.KREDI_KARTI,
      detayAciklama: "****6725 NISAN 2026 EKSTRESİ ÖDEME",
      borc: 200,
      alacak: 0,
      fisTarihi: "2026-05-10",
    },
    {
      id: "m3",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI,
      classification: CREDIT_CARD_CLASSIFICATION,
      missingHesapCategory: MISSING_HESAP_CATEGORY.KREDI_KARTI,
      detayAciklama: "KK ODEME ****6725",
      borc: 50,
      alacak: 0,
      fisTarihi: "2026-06-01",
    },
  ];
  const snap = buildCariResolutionGroups(
    rows,
    { selectedBank: "VAKIFBANK" },
    { initialCandidateGroups: false }
  );
  assert.equal(snap.creditCardMissingCount, 3);
  assert.ok(snap.creditCardGroupCount >= 2);
  const periods = new Set(
    snap.creditCardGroups.map((g) => g.statementPeriodKey)
  );
  assert.ok(periods.has("2026-05"));
  assert.ok(periods.has("2026-04"));
  assert.ok(periods.has("belirsiz"));

  const tx = snap.creditCardGroups[0].transactions[0];
  assert.ok(tx.creditCardRow);
  assert.ok("lastFourDigits" in tx);
  assert.ok("statementPeriodLabel" in tx);
});

test("14) grup anahtarı dönem içerir; soft≠kesin birleşmez", () => {
  const certain = buildCreditCardGroupKey({
    companyId: "c1",
    bankName: "VAKIF",
    lastFourDigits: "6725",
    statementPeriodKey: "2026-05",
    direction: "CIKIS",
    transactionType: "KREDI_KARTI_ODEMESI",
  });
  const soft = buildCreditCardGroupKey({
    companyId: "c1",
    bankName: "VAKIF",
    lastFourDigits: "6725",
    statementPeriodKey: "belirsiz",
    direction: "CIKIS",
    transactionType: "KREDI_KARTI_ODEMESI",
  });
  assert.notEqual(certain, soft);
  assert.equal(
    creditCardStatementPeriodKey({
      month: 5,
      year: 2026,
      source: "payment_previous_month_soft",
      confidence: "low",
    }),
    "belirsiz"
  );
  assert.equal(
    creditCardStatementPeriodKey({
      month: 5,
      year: 2026,
      source: "month_name",
      confidence: "high",
    }),
    "2026-05"
  );
});

test("extract last4", () => {
  assert.equal(extractCardLast4FromText("****6725 MAYIS"), "6725");
  assert.equal(extractCardLast4FromText("**4289 nolu"), "4289");
});

console.log("\nAll credit card engine tests passed.");
