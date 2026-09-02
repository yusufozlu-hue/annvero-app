/**
 * Vadeli mevduat / faiz stopajı Eksik Hesap Çözüm Merkezi onboarding.
 * Statement→102, vadesiz karşı bacak, 193 stopaj adımlarını ayırır.
 */

import { BANK_TRANSACTION_TYPE } from "@/src/utils/bankTransactionType";
import { MISSING_HESAP_CATEGORY } from "@/src/utils/previewExportValidation";
import {
  bankNamesCompatible,
  listCompanyBankAccounts,
  resolve102RoleFromAccountPlan,
} from "@/src/utils/vadeliMevduatLifecycle";
import {
  BANK_ACCOUNT_MAPPING_SCOPE,
  mergeBankProductCurrencyLearning,
  mergeExactVadeliAccountLearning,
  resolveStatementAccountMapping,
} from "@/src/utils/bankProductAccountMapping";
import { normalizeParserText } from "@/src/utils/textNormalize";
import { inferStatementAccountHint } from "@/src/utils/bankParserCore";

export const VADELI_ONBOARDING_STEP = Object.freeze({
  STATEMENT_102: "STATEMENT_102",
  VADESIZ_COUNTER: "VADESIZ_COUNTER",
  FAIZ_STOPAJI_193: "FAIZ_STOPAJI_193",
});

export const VADELI_APPLY_LEG = Object.freeze({
  BANK: "bankLeg",
  COUNTER: "counterLeg",
});

const VADELI_TYPES = new Set([
  BANK_TRANSACTION_TYPE.VADELI_ACILIS,
  BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
  BANK_TRANSACTION_TYPE.VADELI_VADE_DONUSU,
  BANK_TRANSACTION_TYPE.VADELI_ANAPARA_YENILEME,
  BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
  BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
]);

function digitsOnly(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function compactCode(value = "") {
  return String(value || "").trim().replace(/\s+/g, "");
}

function isLeaf102(code = "") {
  const c = compactCode(code);
  return /^102\./.test(c) && c !== "102";
}

function isLeaf193(code = "") {
  const c = compactCode(code);
  return /^193\./.test(c) && c !== "193";
}

function planName(plan = {}) {
  return normalizeParserText(
    plan.accountName || plan.name || plan.hesapAdi || ""
  );
}

function planCode(plan = {}) {
  return compactCode(plan.accountCode || plan.code || plan.hesapKodu || "");
}

function isVadeliPlanName(name = "") {
  return /\bVADEL[Iİ]\b|TERM\s*DEPOSIT/.test(name) && !/\bVADESIZ\b/.test(name);
}

function isVadesizPlanName(name = "") {
  if (/\bVADEL[Iİ]\b|TERM\s*DEPOSIT/.test(name)) return false;
  return /\bVADESIZ\b|\bDEMAND\b|\bCHECKING\b|\bONBURO\b|\bON\s*BURO\b/.test(
    name
  );
}

export function maskBankAccountNumber(value = "") {
  const dig = digitsOnly(value);
  if (!dig) return "—";
  if (dig.length <= 4) return `…${dig}`;
  return `…${dig.slice(-4)}`;
}

export function displayBankLabel(bankName = "") {
  const raw = String(bankName || "").trim();
  if (!raw) return "Banka";
  const n = normalizeParserText(raw);
  if (/VAKIF/.test(n)) return "VakıfBank";
  if (/ZIRAAT/.test(n)) return "Ziraat Bankası";
  if (/IS\s*BANK|TURKIYE\s*IS/.test(n)) return "İş Bankası";
  if (/GARANTI/.test(n)) return "Garanti BBVA";
  if (/YAPI\s*KREDI|YAPIKREDI/.test(n)) return "Yapı Kredi";
  if (/AKBANK/.test(n)) return "Akbank";
  if (/HALK/.test(n)) return "Halkbank";
  return raw;
}

/**
 * Luca banka bacağı mı? GIRIS→borc, CIKIS→alacak.
 */
export function isBankSideLucaLine(row = {}) {
  const role = String(row.lineRole || "").toLowerCase();
  const dir = String(row.direction || "").toUpperCase();
  if (role !== "borc" && role !== "alacak") return false;
  if (dir === "GIRIS" || dir === "GELEN" || dir === "ALACAK") {
    return role === "borc";
  }
  if (dir === "CIKIS" || dir === "GIDEN" || dir === "BORC") {
    return role === "alacak";
  }
  return false;
}

export function isVadeliLifecycleTx(row = {}) {
  const type = String(row.transactionType || "");
  if (VADELI_TYPES.has(type)) return true;
  if (String(row.accountingScenario || "") === "VADELI_LIFECYCLE") return true;
  if (String(row.vadeliLifecycleRole || "").startsWith("VADELI_")) return true;
  if (String(row.vadeliLifecycleRole || "") === "FAIZ_STOPAJI") return true;
  if (String(row.vadeliLifecycleRole || "") === "FAIZ_GELIRI") return true;
  const cat = String(row.missingHesapCategory || "");
  if (
    cat === MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI ||
    cat === MISSING_HESAP_CATEGORY.FAIZ_STOPAJI_HESAP
  ) {
    return true;
  }
  return false;
}

export function resolveStatementDigitsFromContext(context = {}, rows = []) {
  const fromCtx = inferStatementAccountHint({
    statementAccountHint: context.statementAccountHint,
    accountNumber: context.accountNumber || context.hesapNo,
    sourceFileName: context.sourceFileName || context.fileName,
  });
  if (fromCtx) return fromCtx;

  for (const row of rows || []) {
    const dig = digitsOnly(
      row.statementAccountNumber ||
        row.accountNumber ||
        row.hesapNo ||
        row.rawHesapNo ||
        ""
    );
    if (dig.length >= 8) return dig;
  }
  return "";
}

function candidateFromPlan(plan) {
  return {
    code: planCode(plan),
    name: String(plan.accountName || plan.name || plan.hesapAdi || "").slice(
      0,
      120
    ),
    confidence: 0,
  };
}

export function listVadeli102Candidates({
  companyPlans = [],
  company = null,
  bankName = "",
} = {}) {
  const out = [];
  const seen = new Set();
  for (const bank of listCompanyBankAccounts(company)) {
    const type = String(bank.accountType || "").toUpperCase();
    const code = compactCode(bank.lucaAccountCode || bank.accountCode || "");
    if (type !== "VADELI" || !isLeaf102(code) || seen.has(code)) continue;
    if (
      bankName &&
      !bankNamesCompatible(bank.bankName || bank.accountName || "", bankName)
    ) {
      continue;
    }
    seen.add(code);
    out.push({
      code,
      name: String(bank.accountName || bank.bankName || "Vadeli hesap").slice(
        0,
        120
      ),
      confidence: 10,
      source: "company_bank",
    });
  }
  for (const plan of companyPlans || []) {
    if (plan?.isActive === false) continue;
    const code = planCode(plan);
    if (!isLeaf102(code) || seen.has(code)) continue;
    const name = planName(plan);
    if (!isVadeliPlanName(name)) continue;
    if (bankName && !bankNamesCompatible(name, bankName) && !/VAKIF|VADEL/.test(name)) {
      // Banka adı plan adında yoksa yine vadeli etiketi varsa göster
    }
    seen.add(code);
    out.push({ ...candidateFromPlan(plan), source: "plan" });
  }
  return out.slice(0, 40);
}

export function listVadesiz102Candidates({
  companyPlans = [],
  company = null,
  bankName = "",
  excludeCodes = [],
} = {}) {
  const exclude = new Set((excludeCodes || []).map(compactCode).filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const bank of listCompanyBankAccounts(company)) {
    const type = String(bank.accountType || "VADESIZ").toUpperCase();
    const code = compactCode(bank.lucaAccountCode || bank.accountCode || "");
    if (type === "VADELI" || !isLeaf102(code) || seen.has(code) || exclude.has(code)) {
      continue;
    }
    if (
      bankName &&
      !bankNamesCompatible(bank.bankName || bank.accountName || "", bankName)
    ) {
      continue;
    }
    seen.add(code);
    out.push({
      code,
      name: String(bank.accountName || bank.bankName || "Vadesiz hesap").slice(
        0,
        120
      ),
      confidence: 20,
      source: "company_bank",
    });
  }

  const fromPlan = resolve102RoleFromAccountPlan({
    companyPlans,
    bankName,
    currency: "TL",
    accountType: "VADESIZ",
    excludeCodes: [...exclude],
  });
  // Unique suggestion only — still list multiple from plan by filter
  for (const plan of companyPlans || []) {
    if (plan?.isActive === false) continue;
    const code = planCode(plan);
    if (!isLeaf102(code) || seen.has(code) || exclude.has(code)) continue;
    const name = planName(plan);
    if (!isVadesizPlanName(name) && !fromPlan.ok) {
      // allowImplicit: same bank leaf 102 not vadeli
      if (
        !bankName ||
        !bankNamesCompatible(name, bankName) ||
        isVadeliPlanName(name)
      ) {
        continue;
      }
    } else if (!isVadesizPlanName(name) && isVadeliPlanName(name)) {
      continue;
    } else if (!isVadesizPlanName(name)) {
      if (!bankName || !bankNamesCompatible(name, bankName)) continue;
      if (isVadeliPlanName(name)) continue;
    }
    seen.add(code);
    out.push({ ...candidateFromPlan(plan), source: "plan" });
  }
  return out.slice(0, 40);
}

export function list193Candidates({ companyPlans = [] } = {}) {
  return (companyPlans || [])
    .filter((p) => p?.isActive !== false)
    .map((p) => candidateFromPlan(p))
    .filter((c) => isLeaf193(c.code))
    .slice(0, 40);
}

function rowAmount(row = {}) {
  return Math.abs(Number(row.borc || 0) || Number(row.alacak || 0) || 0);
}

function rowDesc(row = {}) {
  return String(row.detayAciklama || row.fisAciklama || row.description || "");
}

function movementKey(row = {}) {
  return String(
    row.sourceMovementId || row.sourceRowId || row._movementId || row.id || ""
  ).trim();
}

/**
 * Eksik vadeli/stopaj Luca satırlarından onboarding grupları üretir.
 * Firma kartında VADELI statement bağı yoksa önce STATEMENT_102;
 * vadesiz kartı statement çözülene kadar ertelenir.
 */
export function buildVadeliOnboardingGroups(missingRows = [], context = {}) {
  const company = context.selectedCompany || context.company || null;
  const bankName = String(context.selectedBank || context.bankName || "").trim();
  const companyPlans = context.companyPlans || [];
  const allRows = context.allRows || missingRows || [];
  const statementDigits = resolveStatementDigitsFromContext(
    context,
    missingRows
  );
  const statementMasked = maskBankAccountNumber(statementDigits);
  const bankLabel = displayBankLabel(bankName);

  const statementProbe = resolveStatementAccountMapping({
    company,
    accountNumber: statementDigits,
    bankName,
    currency: context.currency || "TL",
    accountType: "VADELI",
  });
  const statementLinked = Boolean(statementProbe.ok && statementProbe.code);

  const vadeliMissing = (missingRows || []).filter(isVadeliLifecycleTx);
  const bankLegs = [];
  const vadesizCounterLegs = [];
  const stopajCounterLegs = [];

  for (const row of vadeliMissing) {
    const type = String(row.transactionType || "");
    const bankSide = isBankSideLucaLine(row);
    if (bankSide) {
      bankLegs.push(row);
      continue;
    }

    if (type === BANK_TRANSACTION_TYPE.FAIZ_STOPAJI) {
      stopajCounterLegs.push(row);
      continue;
    }

    if (
      type === BANK_TRANSACTION_TYPE.VADELI_ACILIS ||
      type === BANK_TRANSACTION_TYPE.VADELI_KAPANIS ||
      type === BANK_TRANSACTION_TYPE.VADELI_VADE_DONUSU ||
      type === BANK_TRANSACTION_TYPE.VADELI_ANAPARA_YENILEME
    ) {
      vadesizCounterLegs.push(row);
    }
  }

  const groups = [];
  const needsStatement =
    Boolean(statementDigits) && !statementLinked && vadeliMissing.length > 0;

  if (needsStatement) {
    const movIds = new Set(
      vadeliMissing
        .map((r) =>
          String(r.sourceMovementId || r._movementId || r.sourceRowId || "").trim()
        )
        .filter(Boolean)
    );
    let statementRows = (allRows || []).filter((r) => {
      if (!isVadeliLifecycleTx(r) || !isBankSideLucaLine(r)) return false;
      const mid = String(
        r.sourceMovementId || r._movementId || r.sourceRowId || ""
      ).trim();
      return movIds.has(mid);
    });
    if (!statementRows.length) statementRows = bankLegs.slice();
    if (!statementRows.length) {
      statementRows = vadeliMissing.filter((r) => isBankSideLucaLine(r));
    }

    const candidates = listVadeli102Candidates({
      companyPlans,
      company,
      bankName,
    });
    const rowIds = statementRows.map((r) => r.id).filter(Boolean);
    groups.push({
      id: `vadeli-statement:${statementDigits || "unknown"}`,
      partyName: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      partyUnresolved: false,
      samples: statementRows.slice(0, 5).map((r) => rowDesc(r).slice(0, 160)),
      rowIds,
      rows: statementRows,
      seedRow: statementRows[0] || vadeliMissing[0],
      transactions: statementRows.map((r) => ({
        id: r.id,
        learnSeed: r,
        description: rowDesc(r),
        amount: rowAmount(r),
        transactionType: r.transactionType || "",
      })),
      count: Math.max(rowIds.length, 1),
      totalAmount: statementRows.reduce((s, r) => s + rowAmount(r), 0),
      direction: "",
      transactionType: "VADELI_STATEMENT",
      status: "remaining",
      vadeliAccountGroup: true,
      vadeliOnboardingStep: VADELI_ONBOARDING_STEP.STATEMENT_102,
      applyLeg: VADELI_APPLY_LEG.BANK,
      allowOverwriteFilled: true,
      hideCariSearch: true,
      learnAllowedDefault: true,
      preferredPrefixes: ["102"],
      candidates,
      suggestedAccount: "",
      suggestedName: "",
      confidence: 0,
      confidenceLabel: "Vadeli 102 seçilmeli",
      matchReason: "",
      candidatesReady: true,
      foreignVendor: false,
      statementBankName: bankLabel,
      statementAccountMasked: statementMasked,
      statementAccountDigits: statementDigits,
      statementCurrency: context.currency || "TL",
      mappingScopeDefault: BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY,
      onboardingQuestion: `${bankLabel} TL vadeli mevduat işlemleri hangi 102 hesabında izleniyor?`,
      selectionHint:
        "Muhasebe bacağı: ortak vadeli 102 (banka/ürün/PB). Bankadaki hesap numarası alias olarak saklanır; planda yeni alt hesap açılmaz.",
      applyButtonTemplate: "vadeli_statement",
      vendorMessage: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      createAccountHref: "/muhasebe/firma-yonetimi?tab=banks",
      createAccountLabel:
        "Uygun hesap yok — firma kartında vadeli 102 tanımla",
      learnLabel: `Bu firmanın tüm ${bankLabel} TL vadeli hesaplarında kullan`,
    });
  }

  // Vadesiz yalnız statement bağlıysa
  if (!needsStatement && vadesizCounterLegs.length > 0) {
    const candidates = listVadesiz102Candidates({
      companyPlans,
      company,
      bankName,
      excludeCodes: statementProbe.code ? [statementProbe.code] : [],
    });
    const unique =
      candidates.length === 1
        ? candidates[0]
        : null;
    const rowIds = vadesizCounterLegs.map((r) => r.id).filter(Boolean);
    groups.push({
      id: `vadeli-vadesiz:${statementDigits || movementKey(vadesizCounterLegs[0]) || "pair"}`,
      partyName: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      partyUnresolved: false,
      samples: vadesizCounterLegs
        .slice(0, 5)
        .map((r) => rowDesc(r).slice(0, 160)),
      rowIds,
      rows: vadesizCounterLegs,
      seedRow: vadesizCounterLegs[0],
      transactions: vadesizCounterLegs.map((r) => ({
        id: r.id,
        learnSeed: r,
        description: rowDesc(r),
        amount: rowAmount(r),
        transactionType: r.transactionType || "",
      })),
      count: rowIds.length,
      totalAmount: vadesizCounterLegs.reduce((s, r) => s + rowAmount(r), 0),
      direction: "",
      transactionType: "VADELI_VADESIZ_COUNTER",
      status: "remaining",
      vadeliAccountGroup: true,
      vadeliOnboardingStep: VADELI_ONBOARDING_STEP.VADESIZ_COUNTER,
      applyLeg: VADELI_APPLY_LEG.COUNTER,
      hideCariSearch: true,
      learnAllowedDefault: false,
      preferredPrefixes: ["102"],
      candidates,
      suggestedAccount: unique?.code || "",
      suggestedName: unique?.name || "",
      confidence: unique ? 80 : 0,
      confidenceLabel: unique
        ? "Tek kesin vadesiz aday — onayınız gerekir"
        : "Vadesiz 102 seçilmeli",
      matchReason: unique ? "unique_vadesiz" : "",
      candidatesReady: true,
      foreignVendor: false,
      statementBankName: bankLabel,
      statementAccountMasked: statementMasked,
      statementAccountDigits: statementDigits,
      onboardingQuestion: `Kaynak/hedef vadesiz ${bankLabel || "banka"} hesabını seçin`,
      selectionHint:
        "Muhasebe bacağı: açılış/kapanış karşı hesabı — yalnız vadesiz 102",
      applyButtonTemplate: "vadeli_vadesiz",
      vendorMessage: "Kaynak/hedef vadesiz banka hesabı seçilmeli",
      createAccountHref: "/muhasebe/firma-yonetimi?tab=banks",
      createAccountLabel:
        "Uygun vadesiz hesap yok — firma kartında 102 tanımla",
      learnLabel: "Bu firma için öğren (onaysız kaydedilmez)",
    });
  }

  if (stopajCounterLegs.length > 0) {
    const candidates = list193Candidates({ companyPlans });
    const unique = candidates.length === 1 ? candidates[0] : null;
    const rowIds = stopajCounterLegs.map((r) => r.id).filter(Boolean);
    const n = rowIds.length;
    groups.push({
      id: `faiz-stopaj:${statementDigits || "all"}`,
      partyName: MISSING_HESAP_CATEGORY.FAIZ_STOPAJI_HESAP,
      partyUnresolved: false,
      samples: stopajCounterLegs
        .slice(0, 5)
        .map((r) => rowDesc(r).slice(0, 160)),
      rowIds,
      rows: stopajCounterLegs,
      seedRow: stopajCounterLegs[0],
      transactions: stopajCounterLegs.map((r) => ({
        id: r.id,
        learnSeed: r,
        description: rowDesc(r),
        amount: rowAmount(r),
        transactionType: r.transactionType || "",
      })),
      count: n,
      totalAmount: stopajCounterLegs.reduce((s, r) => s + rowAmount(r), 0),
      direction: "CIKIS",
      transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
      status: "remaining",
      faizStopajiGroup: true,
      vadeliOnboardingStep: VADELI_ONBOARDING_STEP.FAIZ_STOPAJI_193,
      applyLeg: VADELI_APPLY_LEG.COUNTER,
      hideCariSearch: true,
      learnAllowedDefault: true,
      preferredPrefixes: ["193"],
      candidates,
      suggestedAccount: unique?.code || "",
      suggestedName: unique?.name || "",
      confidence: unique ? 80 : 0,
      confidenceLabel: unique
        ? "Tek 193 aday — onaylayıp uygulayın"
        : "193 hesabı seçilmeli",
      matchReason: unique ? "unique_193" : "",
      candidatesReady: true,
      foreignVendor: false,
      statementBankName: bankLabel,
      statementAccountMasked: statementMasked,
      onboardingQuestion: "Faiz stopajı hesabını seçin",
      selectionHint: `Muhasebe bacağı: faiz stopajı karşı hesabı — 193 (${n} hareket)`,
      applyButtonTemplate: "faiz_stopaj",
      vendorMessage: MISSING_HESAP_CATEGORY.FAIZ_STOPAJI_HESAP,
      learnLabel: "Bu firma için öğren",
    });
  }

  return {
    vadeliAccountGroups: groups.filter((g) => g.vadeliAccountGroup),
    faizStopajiGroups: groups.filter((g) => g.faizStopajiGroup),
    vadeliAccountRows: needsStatement
      ? groups.find(
          (g) => g.vadeliOnboardingStep === VADELI_ONBOARDING_STEP.STATEMENT_102
        )?.rows || bankLegs
      : [...bankLegs, ...vadesizCounterLegs],
    faizStopajiRows: stopajCounterLegs,
    statementAccountDigits: statementDigits,
    statementAccountMasked: statementMasked,
    statementLinked,
  };
}

export function formatVadeliOnboardingApplyLabel(group = {}, selectedCount = 0) {
  const n = Number(selectedCount) || Number(group.count) || 0;
  const step = group.vadeliOnboardingStep || "";
  if (step === VADELI_ONBOARDING_STEP.STATEMENT_102) {
    return "Vadeli 102 hesabını eşleştir";
  }
  if (step === VADELI_ONBOARDING_STEP.VADESIZ_COUNTER) {
    return n > 1
      ? `Vadesiz karşı hesabı ${n} işleme uygula`
      : "Vadesiz karşı hesabı uygula";
  }
  if (step === VADELI_ONBOARDING_STEP.FAIZ_STOPAJI_193) {
    return n > 0
      ? `193 hesabını ${n} işleme uygula`
      : "193 hesabını uygula";
  }
  return n > 0
    ? `Seçilen Hesabı ${n} İşleme Uygula`
    : "Seçilen Hesabı İşleme Uygula";
}

/**
 * Firma bankProductMappings / exact bankAccounts kaydı.
 * Varsayılan: BANK_PRODUCT_CURRENCY (tüm VakıfBank TL vadeli → ortak 102).
 * Exact istisna için scope=EXACT_ACCOUNT verin.
 * Otomatik kod uydurmaz — yalnız kullanıcı seçimini kaydeder.
 */
export function mergeStatementVadeliBankLearning(
  company = null,
  {
    bankName = "",
    accountNumber = "",
    lucaAccountCode = "",
    currency = "TL",
    scope = BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY,
  } = {}
) {
  if (scope === BANK_ACCOUNT_MAPPING_SCOPE.EXACT_ACCOUNT) {
    return mergeExactVadeliAccountLearning(company, {
      bankName,
      accountNumber,
      lucaAccountCode,
      currency,
    });
  }
  return mergeBankProductCurrencyLearning(company, {
    bankName,
    accountType: "VADELI",
    currency,
    lucaAccountCode,
    aliasAccountNumber: accountNumber,
  });
}

/**
 * applyLeg'e göre satırın güncellenip güncellenmeyeceği.
 */
export function shouldApplyVadeliOnboardingRow(row = {}, group = {}) {
  const leg = group.applyLeg || "";
  if (!leg) return true;
  const bankSide = isBankSideLucaLine(row);
  if (leg === VADELI_APPLY_LEG.BANK) return bankSide;
  if (leg === VADELI_APPLY_LEG.COUNTER) return !bankSide;
  return true;
}
