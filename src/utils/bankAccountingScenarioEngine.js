/**
 * Muhasebe senaryo motoru — Firma Muhasebe Politikası → Senaryo → alt hesap.
 * Parser / analysisKey / Luca formatına dokunmaz; yalnızca karar üretir.
 */

import { normalizeParserText } from "@/src/utils/textNormalize";
import {
  BANK_TRANSACTION_TYPE,
  CARI_REQUIRED_TYPES,
  CEK_TYPES,
  FINANCE_TYPES,
  isCariRequiredForType,
  isCekType,
  isFinanceType,
  isKasaType,
  isPersonelRequiredForType,
  isPosType,
  isVergiSgkType,
  isVirmanType,
  KASA_TYPES,
  missingCategoryForTransactionType,
  PERSONEL_REQUIRED_TYPES,
  POS_TYPES,
  VERGI_SGK_TYPES,
  VIRMAN_TYPES,
} from "@/src/utils/bankTransactionType";
import { resolveMappedAccountFromCompany } from "@/src/utils/companyAccountAutoDetect";

export const ACCOUNTING_SCENARIO = {
  CEK_ODEMESI: "CEK_ODEMESI",
  CEK_TAHSILATI: "CEK_TAHSILATI",
  KASA_BANKAYA_YATAN: "KASA_BANKAYA_YATAN",
  BANKADAN_KASAYA_CEKILEN: "BANKADAN_KASAYA_CEKILEN",
  POS_TAHSILAT: "POS_TAHSILAT",
  POS_BATCH_TAHSILAT: "POS_BATCH_TAHSILAT",
  POS_KOMISYON: "POS_KOMISYON",
  POS_IADE: "POS_IADE",
  POS_BLOKE: "POS_BLOKE",
  POS_DIGER: "POS_DIGER",
  BANKA_ICI_VIRMAN: "BANKA_ICI_VIRMAN",
  BANKALAR_ARASI_VIRMAN: "BANKALAR_ARASI_VIRMAN",
  MUSTERI_TAHSILAT: "MUSTERI_TAHSILAT",
  TEDARIKCI_ODEME: "TEDARIKCI_ODEME",
  DIGER_CARI_HAREKET: "DIGER_CARI_HAREKET",
  GELEN_HAVALE: "GELEN_HAVALE",
  GIDEN_HAVALE: "GIDEN_HAVALE",
  PERSONEL: "PERSONEL",
  VERGI_SGK: "VERGI_SGK",
  FINANS: "FINANS",
  BANKA_MASRAFI: "BANKA_MASRAFI",
  KREDI_KARTI: "KREDI_KARTI",
  DOVIZ: "DOVIZ",
  BILINMEYEN: "BILINMEYEN",
};

export const DEFAULT_COMPANY_ACCOUNTING_POLICIES = {
  useGivenChecksAccount: true,
  useReceivedChecksAccount: true,
  usePos108Accounts: true,
  useCash100Account: true,
  useFxSeparate102Accounts: true,
};

const MONTH_KEYWORDS = [
  ["OCAK", "01", "JAN"],
  ["SUBAT", "ŞUBAT", "02", "FEB"],
  ["MART", "03", "MAR"],
  ["NISAN", "NİSAN", "04", "APR"],
  ["MAYIS", "05", "MAY"],
  ["HAZIRAN", "06", "JUN"],
  ["TEMMUZ", "07", "JUL"],
  ["AGUSTOS", "AĞUSTOS", "08", "AUG"],
  ["EYLUL", "EYLÜL", "09", "SEP"],
  ["EKIM", "EKİM", "10", "OCT"],
  ["KASIM", "11", "NOV"],
  ["ARALIK", "12", "DEC"],
];

function compactAccount(code = "") {
  return String(code || "")
    .trim()
    .replace(/\s+/g, "");
}

function getAccountCode(account) {
  return (
    account?.accountCode ||
    account?.hesapKodu ||
    account?.kod ||
    account?.code ||
    ""
  );
}

function getAccountName(account) {
  return (
    account?.accountName ||
    account?.hesapAdi ||
    account?.ad ||
    account?.name ||
    ""
  );
}

/**
 * Firma Muhasebe Politikası — accountingRules'tan normalize bayraklar.
 */
/** Test/perf: politika resolve sayısı (analiz başına 1 beklenir) */
let companyAccountingPolicyResolveCount = 0;

export function getCompanyAccountingPolicyResolveCount() {
  return companyAccountingPolicyResolveCount;
}

export function resetCompanyAccountingPolicyResolveCount() {
  companyAccountingPolicyResolveCount = 0;
}

export function resolveCompanyAccountingPolicies(companyOrRules = {}) {
  companyAccountingPolicyResolveCount += 1;
  const rules =
    companyOrRules?.accountingRules && typeof companyOrRules.accountingRules === "object"
      ? companyOrRules.accountingRules
      : companyOrRules || {};

  return {
    useGivenChecksAccount: rules.useGivenChecksAccount !== false,
    useReceivedChecksAccount: rules.useReceivedChecksAccount !== false,
    usePos108Accounts: rules.usePos108Accounts !== false,
    useCash100Account: rules.useCash100Account !== false,
    useFxSeparate102Accounts: rules.useFxSeparate102Accounts !== false,
    posAccountCode: String(rules.posAccountCode || "").trim(),
  };
}

function parseMovementMonth(dateValue = "") {
  const raw = String(dateValue || "").trim();
  if (!raw) return null;
  // DD.MM.YYYY or YYYY-MM-DD
  const m1 = raw.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m1) {
    const month = Number(m1[2]);
    if (month >= 1 && month <= 12) return month;
  }
  const m2 = raw.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (m2) {
    const month = Number(m2[2]);
    if (month >= 1 && month <= 12) return month;
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.getMonth() + 1;
  return null;
}

/**
 * Plan içinde prefix + opsiyonel isim anahtarları ile alt hesap bul.
 * requireSubAccount: ham ana hesap (103) kabul edilmez.
 * planIndex varsa byMainPrefix havuzundan tarar; yok/boşsa companyPlans fallback.
 */
export function findPlanSubAccount(
  companyPlans = [],
  candidates = [],
  { requireSubAccount = true, planIndex = null } = {}
) {
  const fallbackActive = () =>
    (companyPlans || []).filter((a) => a?.isActive !== false);

  const poolForWanted = (wanted) => {
    if (planIndex?.byMainPrefix) {
      const main =
        String(wanted || "")
          .split(".")[0]
          ?.slice(0, 3) || String(wanted || "").slice(0, 3);
      const pool = planIndex.byMainPrefix.get(main);
      if (pool?.length) return pool;
    }
    return fallbackActive();
  };

  for (const candidate of candidates) {
    const wanted = compactAccount(candidate.code);
    if (!wanted) continue;
    const nameKeywords = (candidate.nameKeywords || []).map((k) =>
      normalizeParserText(k)
    );
    const active = poolForWanted(wanted);

    const matches = (account, mode) => {
      const code = compactAccount(getAccountCode(account));
      const name = normalizeParserText(getAccountName(account));
      if (mode === "exact" && code !== wanted) return false;
      if (mode === "prefix" && !code.startsWith(wanted)) return false;
      if (requireSubAccount) {
        if (code === wanted || !code.includes(".")) return false;
      }
      if (!nameKeywords.length) return true;
      return nameKeywords.every((word) => name.includes(word));
    };

    const prefix = active.find((a) => matches(a, "prefix"));
    if (prefix) return prefix;

    if (!requireSubAccount) {
      const exact = active.find((a) => matches(a, "exact"));
      if (exact) return exact;
    }
  }

  return null;
}

/**
 * Aylık 103 verilen çekler — işlem ayına göre plan alt hesabı.
 */
export function resolveMonthlyGivenCheckAccount(
  companyPlans = [],
  date = "",
  planIndex = null
) {
  const month = parseMovementMonth(date);
  const monthKeys = month ? MONTH_KEYWORDS[month - 1] || [] : [];
  const opts = { planIndex };

  if (monthKeys.length) {
    const byMonth = findPlanSubAccount(
      companyPlans,
      [
        { code: "103", nameKeywords: [monthKeys[0]] },
        ...monthKeys.slice(1).map((k) => ({ code: "103", nameKeywords: [k] })),
        { code: "103", nameKeywords: ["VERILEN", "CEK"] },
      ],
      opts
    );
    if (byMonth) return byMonth;
  }

  return findPlanSubAccount(
    companyPlans,
    [
      { code: "103", nameKeywords: ["VERILEN", "CEK"] },
      { code: "103", nameKeywords: ["CEK"] },
      { code: "103", nameKeywords: [] },
    ],
    opts
  );
}

function mapTypeToScenarioId(transactionType = "") {
  const t = String(transactionType || "");

  if (t === BANK_TRANSACTION_TYPE.CEK_ODEMESI || t === BANK_TRANSACTION_TYPE.CEK) {
    return ACCOUNTING_SCENARIO.CEK_ODEMESI;
  }
  if (t === BANK_TRANSACTION_TYPE.CEK_TAHSILATI) {
    return ACCOUNTING_SCENARIO.CEK_TAHSILATI;
  }
  if (t === BANK_TRANSACTION_TYPE.KASA_BANKAYA_YATAN) {
    return ACCOUNTING_SCENARIO.KASA_BANKAYA_YATAN;
  }
  if (t === BANK_TRANSACTION_TYPE.BANKADAN_KASAYA_CEKILEN) {
    return ACCOUNTING_SCENARIO.BANKADAN_KASAYA_CEKILEN;
  }
  if (POS_TYPES.has(t)) {
    if (t === BANK_TRANSACTION_TYPE.POS_BATCH_TAHSILAT) {
      return ACCOUNTING_SCENARIO.POS_BATCH_TAHSILAT;
    }
    if (t === BANK_TRANSACTION_TYPE.POS_KOMISYON) {
      return ACCOUNTING_SCENARIO.POS_KOMISYON;
    }
    if (t === BANK_TRANSACTION_TYPE.POS_IADE) return ACCOUNTING_SCENARIO.POS_IADE;
    if (t === BANK_TRANSACTION_TYPE.POS_BLOKE) return ACCOUNTING_SCENARIO.POS_BLOKE;
    if (
      t === BANK_TRANSACTION_TYPE.POS_TAHSILAT ||
      t === BANK_TRANSACTION_TYPE.POS_SANAL ||
      t === BANK_TRANSACTION_TYPE.POS_ERTESI_GUN ||
      t === BANK_TRANSACTION_TYPE.POS_COZUM
    ) {
      return ACCOUNTING_SCENARIO.POS_TAHSILAT;
    }
    return ACCOUNTING_SCENARIO.POS_DIGER;
  }
  if (
    t === BANK_TRANSACTION_TYPE.BANKALAR_ARASI_VIRMAN
  ) {
    return ACCOUNTING_SCENARIO.BANKALAR_ARASI_VIRMAN;
  }
  if (VIRMAN_TYPES.has(t)) {
    return ACCOUNTING_SCENARIO.BANKA_ICI_VIRMAN;
  }
  if (
    t === BANK_TRANSACTION_TYPE.MUSTERI_TAHSILAT ||
    t === BANK_TRANSACTION_TYPE.CARI_TAHSILAT
  ) {
    return ACCOUNTING_SCENARIO.MUSTERI_TAHSILAT;
  }
  if (
    t === BANK_TRANSACTION_TYPE.TEDARIKCI_ODEME ||
    t === BANK_TRANSACTION_TYPE.CARI_ODEME
  ) {
    return ACCOUNTING_SCENARIO.TEDARIKCI_ODEME;
  }
  if (t === BANK_TRANSACTION_TYPE.GELEN_HAVALE) {
    return ACCOUNTING_SCENARIO.GELEN_HAVALE;
  }
  if (t === BANK_TRANSACTION_TYPE.GIDEN_HAVALE) {
    return ACCOUNTING_SCENARIO.GIDEN_HAVALE;
  }
  if (t === BANK_TRANSACTION_TYPE.DIGER_CARI_HAREKET) {
    return ACCOUNTING_SCENARIO.DIGER_CARI_HAREKET;
  }
  if (PERSONEL_REQUIRED_TYPES.has(t)) {
    return ACCOUNTING_SCENARIO.PERSONEL;
  }
  if (VERGI_SGK_TYPES.has(t)) {
    return ACCOUNTING_SCENARIO.VERGI_SGK;
  }
  if (
    t === BANK_TRANSACTION_TYPE.DOVIZ_ALIS ||
    t === BANK_TRANSACTION_TYPE.DOVIZ_SATIS ||
    t === BANK_TRANSACTION_TYPE.KUR_FARKI
  ) {
    return ACCOUNTING_SCENARIO.DOVIZ;
  }
  if (
    t === BANK_TRANSACTION_TYPE.BANKA_MASRAFI ||
    t === BANK_TRANSACTION_TYPE.BSMV
  ) {
    return ACCOUNTING_SCENARIO.BANKA_MASRAFI;
  }
  if (t === BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI) {
    return ACCOUNTING_SCENARIO.KREDI_KARTI;
  }
  if (FINANCE_TYPES.has(t)) {
    return ACCOUNTING_SCENARIO.FINANS;
  }
  if (CARI_REQUIRED_TYPES.has(t)) {
    return ACCOUNTING_SCENARIO.DIGER_CARI_HAREKET;
  }
  return ACCOUNTING_SCENARIO.BILINMEYEN;
}

function emptyDecision(partial = {}) {
  return {
    scenarioId: ACCOUNTING_SCENARIO.BILINMEYEN,
    transactionType: BANK_TRANSACTION_TYPE.BILINMEYEN,
    cariRequired: false,
    personelRequired: false,
    counterAccountCode: "",
    counterAccountHint: "",
    documentType: "DK",
    reviewReason: "",
    missingHesapCategory: "",
    policyBlocked: false,
    policies: DEFAULT_COMPANY_ACCOUNTING_POLICIES,
    legs: null,
    ...partial,
  };
}

/**
 * TransactionType + Firma Politikası → Muhasebe Senaryosu + hesap adayı.
 */
export function resolveAccountingScenario({
  transactionType = "",
  direction = "",
  description = "",
  companyPolicies = {},
  companyPlans = [],
  planIndex = null,
  /** true: companyPolicies zaten resolveCompanyAccountingPolicies çıktısı */
  policiesResolved = false,
  date = "",
  bankAccountCode = "",
  company = null,
  bankName = "",
} = {}) {
  const policies = policiesResolved
    ? { ...DEFAULT_COMPANY_ACCOUNTING_POLICIES, ...companyPolicies }
    : {
        ...DEFAULT_COMPANY_ACCOUNTING_POLICIES,
        ...resolveCompanyAccountingPolicies(companyPolicies),
      };
  const type = String(transactionType || BANK_TRANSACTION_TYPE.BILINMEYEN);
  const scenarioId = mapTypeToScenarioId(type);
  const cariRequired = isCariRequiredForType(type);
  const personelRequired = isPersonelRequiredForType(type);
  const dir = direction === "CIKIS" ? "CIKIS" : "GIRIS";
  const planOpts = { planIndex };

  const base = emptyDecision({
    scenarioId,
    transactionType: type,
    cariRequired,
    personelRequired,
    policies,
  });

  // Firma otomatik/onaylı hesap eşlemesi — plan taramasından önce
  if (company) {
    const mapped = resolveMappedAccountFromCompany(company, {
      scenarioType: scenarioId,
      description,
      bankName: bankName || company.bankAccounts?.[0]?.bankName || "",
      cardLast4: (description.match(/\*{2,}(\d{4})\b/) || [])[1] || "",
      taxSgkSubtype: description,
    });
    if (mapped.accountCode && mapped.confidence >= 70) {
      return {
        ...base,
        cariRequired: scenarioRequiresCari(scenarioId)
          ? base.cariRequired
          : false,
        counterAccountCode: mapped.accountCode,
        counterAccountHint: mapped.accountCode.slice(0, 3),
        reviewReason: "",
        missingHesapCategory: "",
        mappingSource: mapped.source,
        mappingConfidence: mapped.confidence,
        legs: null,
      };
    }
  }

  // ——— ÇEK ÖDEMESİ: 103 Borç / 102 Alacak ———
  if (scenarioId === ACCOUNTING_SCENARIO.CEK_ODEMESI) {
    if (!policies.useGivenChecksAccount) {
      return {
        ...base,
        cariRequired: false,
        policyBlocked: true,
        reviewReason: "Firma politikası: 103 Verilen Çekler kullanılmıyor",
        missingHesapCategory: "Çek hesabı 101/103 eksik",
        legs: { debit: "103", credit: bankAccountCode || "102" },
      };
    }
    const hit = resolveMonthlyGivenCheckAccount(companyPlans, date, planIndex);
    const code = hit ? compactAccount(getAccountCode(hit)) : "";
    return {
      ...base,
      cariRequired: false,
      counterAccountCode: code,
      counterAccountHint: "103",
      documentType: "DK",
      reviewReason: code ? "" : "Aylık 103 verilen çekler alt hesabı bulunamadı",
      missingHesapCategory: code ? "" : "Çek hesabı 101/103 eksik",
      legs: { debit: code || "103", credit: bankAccountCode || "102" },
    };
  }

  // ——— ÇEK TAHSİLATI: 102 Borç / 101 Alacak ———
  if (scenarioId === ACCOUNTING_SCENARIO.CEK_TAHSILATI) {
    if (!policies.useReceivedChecksAccount) {
      return {
        ...base,
        cariRequired: false,
        policyBlocked: true,
        reviewReason: "Firma politikası: 101 Alınan Çekler kullanılmıyor",
        missingHesapCategory: "Çek hesabı 101/103 eksik",
        legs: { debit: bankAccountCode || "102", credit: "101" },
      };
    }
    const hit = findPlanSubAccount(
      companyPlans,
      [
        { code: "101", nameKeywords: ["ALINAN", "CEK"] },
        { code: "101", nameKeywords: ["CEK"] },
        { code: "101", nameKeywords: [] },
      ],
      planOpts
    );
    const code = hit ? compactAccount(getAccountCode(hit)) : "";
    return {
      ...base,
      cariRequired: false,
      counterAccountCode: code,
      counterAccountHint: "101",
      reviewReason: code ? "" : "101 Alınan Çekler alt hesabı bulunamadı",
      missingHesapCategory: code ? "" : "Çek hesabı 101/103 eksik",
      legs: { debit: bankAccountCode || "102", credit: code || "101" },
    };
  }

  // ——— KASA → BANKA ———
  if (scenarioId === ACCOUNTING_SCENARIO.KASA_BANKAYA_YATAN) {
    if (!policies.useCash100Account) {
      return {
        ...base,
        cariRequired: false,
        policyBlocked: true,
        reviewReason: "Firma politikası: 100 Kasa kullanılmıyor",
        missingHesapCategory: "Kasa hesabı 100 eksik",
        legs: { debit: bankAccountCode || "102", credit: "100" },
      };
    }
    const hit = findPlanSubAccount(
      companyPlans,
      [
        { code: "100", nameKeywords: ["KASA"] },
        { code: "100", nameKeywords: [] },
      ],
      planOpts
    );
    const code = hit ? compactAccount(getAccountCode(hit)) : "";
    return {
      ...base,
      cariRequired: false,
      counterAccountCode: code,
      counterAccountHint: "100",
      reviewReason: code ? "" : "100 Kasa alt hesabı bulunamadı",
      missingHesapCategory: code ? "" : "Kasa hesabı 100 eksik",
      legs: { debit: bankAccountCode || "102", credit: code || "100" },
    };
  }

  // ——— BANKA → KASA ———
  if (scenarioId === ACCOUNTING_SCENARIO.BANKADAN_KASAYA_CEKILEN) {
    if (!policies.useCash100Account) {
      return {
        ...base,
        cariRequired: false,
        policyBlocked: true,
        reviewReason: "Firma politikası: 100 Kasa kullanılmıyor",
        missingHesapCategory: "Kasa hesabı 100 eksik",
        legs: { debit: "100", credit: bankAccountCode || "102" },
      };
    }
    const hit = findPlanSubAccount(
      companyPlans,
      [
        { code: "100", nameKeywords: ["KASA"] },
        { code: "100", nameKeywords: [] },
      ],
      planOpts
    );
    const code = hit ? compactAccount(getAccountCode(hit)) : "";
    return {
      ...base,
      cariRequired: false,
      counterAccountCode: code,
      counterAccountHint: "100",
      reviewReason: code ? "" : "100 Kasa alt hesabı bulunamadı",
      missingHesapCategory: code ? "" : "Kasa hesabı 100 eksik",
      legs: { debit: code || "100", credit: bankAccountCode || "102" },
    };
  }

  // ——— POS ———
  if (
    scenarioId === ACCOUNTING_SCENARIO.POS_TAHSILAT ||
    scenarioId === ACCOUNTING_SCENARIO.POS_BATCH_TAHSILAT ||
    scenarioId === ACCOUNTING_SCENARIO.POS_IADE ||
    scenarioId === ACCOUNTING_SCENARIO.POS_BLOKE ||
    scenarioId === ACCOUNTING_SCENARIO.POS_DIGER
  ) {
    if (!policies.usePos108Accounts) {
      return {
        ...base,
        cariRequired: false,
        policyBlocked: true,
        reviewReason: "Firma politikası: 108 POS hesapları kullanılmıyor",
        missingHesapCategory: "POS/komisyon ayrımı çözülemedi",
        legs: { debit: bankAccountCode || "102", credit: "108" },
      };
    }
    const preferred = compactAccount(policies.posAccountCode);
    let code = "";
    if (preferred) {
      const preferredHit = findPlanSubAccount(
        companyPlans,
        [{ code: preferred, nameKeywords: [] }],
        { requireSubAccount: preferred.includes("."), planIndex }
      );
      code = preferredHit ? compactAccount(getAccountCode(preferredHit)) : preferred;
    }
    if (!code) {
      const hit = findPlanSubAccount(
        companyPlans,
        [
          { code: "108", nameKeywords: ["POS"] },
          { code: "108", nameKeywords: ["KREDI", "KART"] },
          { code: "108", nameKeywords: [] },
        ],
        planOpts
      );
      code = hit ? compactAccount(getAccountCode(hit)) : "";
    }
    return {
      ...base,
      cariRequired: false,
      counterAccountCode: code,
      counterAccountHint: "108",
      reviewReason: code ? "" : "108 POS alt hesabı bulunamadı",
      missingHesapCategory: code ? "" : "POS/komisyon ayrımı çözülemedi",
      legs: { debit: bankAccountCode || "102", credit: code || "108" },
    };
  }

  if (scenarioId === ACCOUNTING_SCENARIO.POS_KOMISYON) {
    // Komisyon genelde gider hesabı — senaryo cari aramaz; plan/sistem kuralı doldurur
    return {
      ...base,
      cariRequired: false,
      counterAccountHint: "770/760",
      missingHesapCategory: "",
      legs: null,
    };
  }

  // ——— DÖVİZ ———
  if (scenarioId === ACCOUNTING_SCENARIO.DOVIZ) {
    if (policies.useFxSeparate102Accounts) {
      const text = normalizeParserText(description);
      const fxKeywords = [];
      if (text.includes("USD") || text.includes("DOLAR")) fxKeywords.push("USD", "DOLAR");
      if (text.includes("EUR") || text.includes("EURO")) fxKeywords.push("EUR", "EURO");
      if (text.includes("GBP") || text.includes("STERLIN")) fxKeywords.push("GBP", "STERLIN");
      const hit = findPlanSubAccount(
        companyPlans,
        fxKeywords.length
          ? fxKeywords.map((k) => ({ code: "102", nameKeywords: [k] }))
          : [
              { code: "102", nameKeywords: ["DOVIZ"] },
              { code: "102", nameKeywords: ["USD"] },
              { code: "102", nameKeywords: ["EUR"] },
            ],
        { requireSubAccount: true, planIndex }
      );
      const code = hit ? compactAccount(getAccountCode(hit)) : "";
      return {
        ...base,
        cariRequired: false,
        counterAccountCode: code,
        counterAccountHint: "102",
        reviewReason: code
          ? ""
          : "Döviz 102 alt hesabı bulunamadı (politika: ayrı FX hesapları)",
        missingHesapCategory: code ? "" : "Finans işlem türü çözülemedi",
        legs: null,
      };
    }
    return {
      ...base,
      cariRequired: false,
      counterAccountHint: "102",
      legs: null,
    };
  }

  // ——— VIRMAN ———
  if (
    scenarioId === ACCOUNTING_SCENARIO.BANKA_ICI_VIRMAN ||
    scenarioId === ACCOUNTING_SCENARIO.BANKALAR_ARASI_VIRMAN
  ) {
    return {
      ...base,
      cariRequired: false,
      counterAccountHint: "102",
      reviewReason: "",
      legs: null,
    };
  }

  // ——— CARİ / HAVALE ———
  if (
    scenarioId === ACCOUNTING_SCENARIO.MUSTERI_TAHSILAT ||
    scenarioId === ACCOUNTING_SCENARIO.GELEN_HAVALE
  ) {
    return {
      ...base,
      cariRequired: true,
      counterAccountHint: "120",
      documentType: "FT",
      legs: { debit: bankAccountCode || "102", credit: "120" },
    };
  }
  if (
    scenarioId === ACCOUNTING_SCENARIO.TEDARIKCI_ODEME ||
    scenarioId === ACCOUNTING_SCENARIO.GIDEN_HAVALE
  ) {
    return {
      ...base,
      cariRequired: true,
      counterAccountHint: "320",
      documentType: "FT",
      legs: { debit: "320", credit: bankAccountCode || "102" },
    };
  }
  if (scenarioId === ACCOUNTING_SCENARIO.DIGER_CARI_HAREKET) {
    return {
      ...base,
      cariRequired: true,
      counterAccountHint: dir === "GIRIS" ? "120" : "320",
      documentType: "FT",
      legs: null,
    };
  }

  // ——— PERSONEL / VERGİ / FINANS / MASRAF ———
  if (scenarioId === ACCOUNTING_SCENARIO.PERSONEL) {
    return {
      ...base,
      cariRequired: false,
      personelRequired: true,
      counterAccountHint: "335",
      legs: null,
    };
  }
  if (scenarioId === ACCOUNTING_SCENARIO.VERGI_SGK) {
    return {
      ...base,
      cariRequired: false,
      counterAccountHint: "360/361",
      legs: null,
    };
  }
  if (
    scenarioId === ACCOUNTING_SCENARIO.FINANS ||
    scenarioId === ACCOUNTING_SCENARIO.BANKA_MASRAFI ||
    scenarioId === ACCOUNTING_SCENARIO.KREDI_KARTI
  ) {
    return {
      ...base,
      cariRequired: false,
      legs: null,
    };
  }

  return {
    ...base,
    missingHesapCategory: missingCategoryForTransactionType(type),
  };
}

/**
 * Tek karar nesnesi — mapper / validation okur.
 */
export function buildAccountingDecision(context = {}) {
  const scenario = resolveAccountingScenario(context);
  return {
    ...scenario,
    source: "bankAccountingScenarioEngine",
    description: context.description || "",
    direction: context.direction || "",
    date: context.date || "",
  };
}

export function scenarioRequiresCari(scenarioId = "") {
  return (
    scenarioId === ACCOUNTING_SCENARIO.MUSTERI_TAHSILAT ||
    scenarioId === ACCOUNTING_SCENARIO.TEDARIKCI_ODEME ||
    scenarioId === ACCOUNTING_SCENARIO.DIGER_CARI_HAREKET ||
    scenarioId === ACCOUNTING_SCENARIO.GELEN_HAVALE ||
    scenarioId === ACCOUNTING_SCENARIO.GIDEN_HAVALE
  );
}

export function isDirectAccountScenario(scenarioId = "") {
  return (
    scenarioId === ACCOUNTING_SCENARIO.CEK_ODEMESI ||
    scenarioId === ACCOUNTING_SCENARIO.CEK_TAHSILATI ||
    scenarioId === ACCOUNTING_SCENARIO.KASA_BANKAYA_YATAN ||
    scenarioId === ACCOUNTING_SCENARIO.BANKADAN_KASAYA_CEKILEN ||
    scenarioId === ACCOUNTING_SCENARIO.POS_TAHSILAT ||
    scenarioId === ACCOUNTING_SCENARIO.POS_BATCH_TAHSILAT ||
    scenarioId === ACCOUNTING_SCENARIO.POS_BLOKE ||
    scenarioId === ACCOUNTING_SCENARIO.POS_IADE ||
    scenarioId === ACCOUNTING_SCENARIO.POS_DIGER ||
    scenarioId === ACCOUNTING_SCENARIO.BANKA_ICI_VIRMAN ||
    scenarioId === ACCOUNTING_SCENARIO.BANKALAR_ARASI_VIRMAN ||
    scenarioId === ACCOUNTING_SCENARIO.DOVIZ ||
    scenarioId === ACCOUNTING_SCENARIO.BANKA_MASRAFI ||
    scenarioId === ACCOUNTING_SCENARIO.FINANS ||
    scenarioId === ACCOUNTING_SCENARIO.VERGI_SGK ||
    scenarioId === ACCOUNTING_SCENARIO.KREDI_KARTI
  );
}

// Re-export type helpers for callers that only import the scenario engine
export {
  isCekType,
  isKasaType,
  isVirmanType,
  isPosType,
  isFinanceType,
  isVergiSgkType,
  CEK_TYPES,
  KASA_TYPES,
  VIRMAN_TYPES,
  POS_TYPES,
  FINANCE_TYPES,
  VERGI_SGK_TYPES,
};
