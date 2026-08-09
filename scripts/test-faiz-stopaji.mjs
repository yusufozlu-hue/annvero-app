/**
 * FAIZ_STOPAJI sınıflandırma + Vergi/SGK kapısı regresyon testleri
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFaizStopajiClassification,
  detectFaizStopajiType,
  hasFaizStopajiDescriptionSignal,
  matchesFaizStopajRate,
  matchesVadeliLifecycleAmounts,
} from "@/src/utils/faizStopajiClassify.js";
import {
  BANK_TRANSACTION_TYPE,
  resolveBankTransactionType,
  isVergiSgkType,
  isFinanceType,
} from "@/src/utils/bankTransactionType.js";
import { mapParsedRowsToStandardMovements } from "@/src/utils/bankMovementMapper.js";
import { isTaxObligationMissingRow } from "@/src/utils/cariMissingResolutionGroups.js";

test("text: faiz stopajı → FAIZ_STOPAJI, finans tipi", () => {
  assert.equal(hasFaizStopajiDescriptionSignal("MEVDUAT STOPAJ KESINTISI"), true);
  assert.equal(detectFaizStopajiType("FAIZ STOPAJ %15", "CIKIS"), "FAIZ_STOPAJI");
  const r = resolveBankTransactionType("Mevduat faiz stopajı", "CIKIS");
  assert.equal(r.transactionType, BANK_TRANSACTION_TYPE.FAIZ_STOPAJI);
  assert.equal(isFinanceType(r.transactionType), true);
  assert.equal(isVergiSgkType(r.transactionType), false);
});

test("oran: 5938 / 33931.4 ≈ %17.5", () => {
  const m = matchesFaizStopajRate(5938, 33931.4);
  assert.equal(m.ok, true);
  assert.equal(m.rate, 0.175);
});

test("yaşam döngüsü: principal + faiz − stopaj = kapanış", () => {
  const rows = [
    {
      description: "Vadeli Mevduat Hesap Açma",
      direction: "GIRIS",
      amount: 1018500,
    },
    {
      description: "Mevduat Faiz Tahakkuku",
      direction: "GIRIS",
      amount: 33931.4,
      transactionType: "FAIZ_GELIRI",
    },
    {
      description: "Vergi ödemesi",
      direction: "CIKIS",
      amount: 5938,
      transactionType: "VERGI",
    },
    {
      description: "Hesap Kapatma",
      direction: "CIKIS",
      amount: 1046493.4,
    },
  ];
  const life = matchesVadeliLifecycleAmounts(rows, rows[2], rows[1]);
  assert.equal(life.ok, true);
});

test("ilişki: Vergi ödemesi + faiz → FAIZ_STOPAJI; tahakkuk kapısı değil", () => {
  const mapped = [
    {
      id: "open",
      date: "2025-12-26",
      description: "Vadeli Mevduat Hesap Açma",
      amount: 1018500,
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
    },
    {
      id: "faiz",
      date: "2026-01-27",
      description: "Mevduat Faiz Tahakkuku",
      amount: 33931.4,
      direction: "GIRIS",
      transactionType: "FAIZ_GELIRI",
    },
    {
      id: "stopaj",
      date: "2026-01-27",
      description: "Vergi ödemesi",
      amount: 5938,
      direction: "CIKIS",
      transactionType: "VERGI",
      warning: "Vergi/SGK türü çözülemedi",
      missingHesapCategory: "Vergi/SGK türü çözülemedi",
    },
    {
      id: "close",
      date: "2026-01-27",
      description: "Hesap Kapatma",
      amount: 1046493.4,
      direction: "CIKIS",
      transactionType: "GIDEN_HAVALE",
    },
  ];
  const { movements, reclassified } = applyFaizStopajiClassification(mapped);
  assert.equal(reclassified.length, 1);
  const stopaj = movements.find((m) => m.id === "stopaj");
  assert.equal(stopaj.transactionType, BANK_TRANSACTION_TYPE.FAIZ_STOPAJI);
  assert.equal(isTaxObligationMissingRow(stopaj), false);
  assert.equal(isVergiSgkType(stopaj.transactionType), false);
});

test("regresyon: gerçek KDV ödemesi VERGI/SGK kapısında kalır", () => {
  const mapped = [
    {
      id: "kdv",
      date: "2026-01-27",
      description: "KDV 1 Ödemesi GIB",
      amount: 10000,
      direction: "CIKIS",
      transactionType: "KDV",
      warning: "Vergi/SGK türü çözülemedi",
    },
    {
      id: "faiz",
      date: "2026-01-27",
      description: "Mevduat Faiz Tahakkuku",
      amount: 33931.4,
      direction: "GIRIS",
      transactionType: "FAIZ_GELIRI",
    },
  ];
  const { reclassified } = applyFaizStopajiClassification(mapped);
  assert.equal(reclassified.length, 0);
  const kdv = resolveBankTransactionType("KDV ödeme GIB", "CIKIS");
  assert.equal(isVergiSgkType(kdv.transactionType), true);
  assert.equal(isTaxObligationMissingRow({ ...mapped[0], transactionType: kdv.transactionType }), true);
});

test("regresyon: yalnız Vergi ödemesi + faiz yok → VERGI kalır", () => {
  const mapped = [
    {
      id: "tax",
      date: "2026-01-27",
      description: "Vergi ödemesi",
      amount: 5000,
      direction: "CIKIS",
      transactionType: "VERGI",
    },
  ];
  const { movements, reclassified } = applyFaizStopajiClassification(mapped);
  assert.equal(reclassified.length, 0);
  assert.equal(movements[0].transactionType, "VERGI");
  assert.equal(isTaxObligationMissingRow(movements[0]), true);
});

test("PDF/Excel parity: mapper post-pass aynı tip", () => {
  const rows = [
    {
      sourceRowId: "f1",
      tarih: "2026-01-27",
      aciklama: "Mevduat Faiz Tahakkuku",
      tutar: 33931.4,
      yon: "GIRIS",
    },
    {
      sourceRowId: "s1",
      tarih: "2026-01-27",
      aciklama: "Vergi ödemesi",
      tutar: 5938,
      yon: "CIKIS",
    },
    {
      sourceRowId: "o1",
      tarih: "2025-12-26",
      aciklama: "Vadeli Mevduat Hesap Açma",
      tutar: 1018500,
      yon: "GIRIS",
    },
    {
      sourceRowId: "c1",
      tarih: "2026-01-27",
      aciklama: "Hesap Kapatma",
      tutar: 1046493.4,
      yon: "CIKIS",
    },
  ];
  const ctx = {
    selectedCompany: { id: "c1", bankAccounts: [] },
    companyPlans: [
      { accountCode: "642.01.001", accountName: "FAİZ GELİRLERİ", isActive: true },
      {
        accountCode: "193.01.001",
        accountName: "PEŞİN ÖDENEN VERGİ VE FONLAR",
        isActive: true,
      },
    ],
    selectedBank: "VAKIFBANK",
  };
  const pdf = mapParsedRowsToStandardMovements(rows, ctx);
  const excel = mapParsedRowsToStandardMovements(rows, ctx);
  const pdfStopaj = pdf.find((m) => m.sourceMovementId === "s1");
  const excelStopaj = excel.find((m) => m.sourceMovementId === "s1");
  assert.ok(pdfStopaj, "pdf stopaj row");
  assert.ok(excelStopaj, "excel stopaj row");
  assert.equal(pdfStopaj.transactionType, BANK_TRANSACTION_TYPE.FAIZ_STOPAJI);
  assert.equal(excelStopaj.transactionType, BANK_TRANSACTION_TYPE.FAIZ_STOPAJI);
  assert.equal(isTaxObligationMissingRow(pdfStopaj), false);
});
