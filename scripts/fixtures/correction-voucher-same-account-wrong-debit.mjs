/** SAME_ACCOUNT_WRONG_DEBIT kabul senaryosu — 00049 yalnız test verisi, motor hardcode değil. */

export function buildSameAccountWrongDebitFixture() {
  return {
    scenarioId: "SAME_ACCOUNT_WRONG_DEBIT_ACCEPTANCE",
    finding: {
      fisNo: "00049",
      tarih: "16.02.2026",
      hesapKodu: "320.10.Y0010",
      severity: "UYARI",
      code: "COUNTERPART_SAME_SIDE",
      message:
        "Aynı fişte yalnız aynı yönlü kayıtlar var; karşıt hesap bağlanamaz.",
    },
    ledgerRows: [
      {
        id: "r1",
        fisNo: "00049",
        tarih: "16.02.2026",
        belgeNo: "YEF2026000000003",
        hesapKodu: "191.01.020.108",
        hesapAdi: "KDV",
        borc: 27000,
        alacak: 0,
      },
      {
        id: "r2",
        fisNo: "00049",
        tarih: "16.02.2026",
        belgeNo: "YEF2026000000003",
        hesapKodu: "320.10.Y0010",
        hesapAdi: "YUNUS ÖZIŞIK",
        borc: 135000,
        alacak: 0,
      },
      {
        id: "r3",
        fisNo: "00049",
        tarih: "16.02.2026",
        belgeNo: "YEF2026000000003",
        hesapKodu: "320.10.Y0010",
        hesapAdi: "YUNUS ÖZIŞIK",
        borc: 0,
        alacak: 162000,
      },
    ],
    accountPlan: [
      { account_code: "191.01.020.108", account_name: "KDV" },
      { account_code: "320.10.Y0010", account_name: "YUNUS ÖZIŞIK" },
      {
        account_code: "740.30.038",
        account_name: "MALİ DANIŞMANLIK GİDERLERİ",
      },
    ],
    companyAccountingRules: {
      lastClosedEdefterPeriod: "2026/03",
    },
    userSelections: {
      correctDebitAccountCode: "740.30.038",
      correctDebitAccountName: "MALİ DANIŞMANLIK GİDERLERİ",
    },
  };
}

export const CORRECTION_VOUCHER_SAME_ACCOUNT_WRONG_DEBIT =
  buildSameAccountWrongDebitFixture();

/** @deprecated Yalnız geriye dönük test import'u — yeni kod fixture adını kullanmalı. */
export const CORRECTION_VOUCHER_00049 = CORRECTION_VOUCHER_SAME_ACCOUNT_WRONG_DEBIT;
