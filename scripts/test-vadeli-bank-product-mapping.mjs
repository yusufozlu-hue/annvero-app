/**
 * PR #77: VakıfBank TL vadeli ortak 102 + Banka Parser clean-open.
 * Run: node --import ./scripts/_alias-loader.mjs --test ./scripts/test-vadeli-bank-product-mapping.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BANK_ACCOUNT_MAPPING_SCOPE,
  mergeBankProductCurrencyLearning,
  mergeExactVadeliAccountLearning,
  resolveStatementAccountMapping,
} from "@/src/utils/bankProductAccountMapping.js";
import { resolveStatementBankAccount } from "@/src/utils/vadeliMevduatLifecycle.js";
import {
  buildVadeliOnboardingGroups,
  mergeStatementVadeliBankLearning,
  VADELI_ONBOARDING_STEP,
} from "@/src/utils/vadeliResolutionOnboarding.js";
import { BANK_TRANSACTION_TYPE } from "@/src/utils/bankTransactionType.js";
import { MISSING_HESAP_CATEGORY } from "@/src/utils/previewExportValidation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const SHARED_102 = "102.10.V099";
const EXACT_102 = "102.10.V088";

const BASE_COMPANY = {
  id: "mare",
  companyName: "MARE",
  bankAccounts: [
    {
      bankName: "VAKIFBANK",
      accountType: "VADESIZ",
      lucaAccountCode: "102.10.V001",
      accountNumber: "00158018033970001",
      currency: "TL",
      isActive: true,
    },
  ],
  bankProductMappings: [],
};

const PLANS = [
  { code: "102.10.V001", name: "Vakıf Vadesiz" },
  { code: SHARED_102, name: "Vakıf Vadeli Ortak" },
  { code: EXACT_102, name: "Vakıf Vadeli Exact" },
  { code: "193.01.001", name: "Stopaj" },
];

test("iki farklı VakıfBank vadeli TL hesap → aynı ortak 102", () => {
  const learned = mergeBankProductCurrencyLearning(BASE_COMPANY, {
    bankName: "VAKIFBANK",
    accountType: "VADELI",
    currency: "TL",
    lucaAccountCode: SHARED_102,
    aliasAccountNumber: "00158018033973987",
  });
  assert.equal(learned.changed, true);

  const a = resolveStatementBankAccount({
    company: learned.company,
    accountNumber: "00158018033973987",
    bankName: "VAKIFBANK",
    currency: "TL",
    accountType: "VADELI",
  });
  const b = resolveStatementBankAccount({
    company: learned.company,
    accountNumber: "00158018033971234",
    bankName: "VAKIFBANK",
    currency: "TL",
    accountType: "VADELI",
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.code, SHARED_102);
  assert.equal(b.code, SHARED_102);
  assert.equal(a.mappingScope, BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY);
  assert.equal(b.mappingScope, BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY);
});

test("aynı hesap sonraki yüklemede STATEMENT_102 sormaz", () => {
  const learned = mergeStatementVadeliBankLearning(BASE_COMPANY, {
    bankName: "VAKIFBANK",
    accountNumber: "00158018033973987",
    lucaAccountCode: SHARED_102,
    currency: "TL",
  });
  const groups = buildVadeliOnboardingGroups(
    [
      {
        id: "bank-leg",
        transactionType: BANK_TRANSACTION_TYPE.VADELI_ACILIS,
        description: "Vadeli Hesap Acma",
        hesapKodu: "",
        accountCode: "",
        missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
        vadeliLifecycleRole: "VADELI_ACILIS",
        direction: "GIRIS",
        amount: 1000,
      },
    ],
    {
      selectedCompany: learned.company,
      companyPlans: PLANS,
      selectedBank: "VAKIFBANK",
      sourceFileName: "00158018033973987.pdf",
      currency: "TL",
    }
  );
  assert.ok(
    !groups.vadeliAccountGroups.some(
      (g) => g.vadeliOnboardingStep === VADELI_ONBOARDING_STEP.STATEMENT_102
    ),
    "ürün kuralı varken STATEMENT_102 kartı açılmamalı"
  );
});

test("VakıfBank USD/EUR TRY kuralını kullanmaz", () => {
  const learned = mergeBankProductCurrencyLearning(BASE_COMPANY, {
    bankName: "VAKIFBANK",
    accountType: "VADELI",
    currency: "TL",
    lucaAccountCode: SHARED_102,
    aliasAccountNumber: "00158018033973987",
  });
  for (const currency of ["USD", "EUR"]) {
    const r = resolveStatementAccountMapping({
      company: learned.company,
      accountNumber: "00158018033975555",
      bankName: "VAKIFBANK",
      currency,
      accountType: "VADELI",
    });
    assert.equal(r.ok, false, `${currency} TRY kuralını almamalı`);
  }
});

test("başka banka VakıfBank kuralını kullanmaz", () => {
  const learned = mergeBankProductCurrencyLearning(BASE_COMPANY, {
    bankName: "VAKIFBANK",
    accountType: "VADELI",
    currency: "TL",
    lucaAccountCode: SHARED_102,
  });
  const r = resolveStatementBankAccount({
    company: learned.company,
    accountNumber: "00158018033979999",
    bankName: "ZIRAAT",
    currency: "TL",
    accountType: "VADELI",
  });
  assert.equal(r.ok, false);
});

test("exact mapping grup kuralını geçersiz kılar", () => {
  let company = mergeBankProductCurrencyLearning(BASE_COMPANY, {
    bankName: "VAKIFBANK",
    accountType: "VADELI",
    currency: "TL",
    lucaAccountCode: SHARED_102,
    aliasAccountNumber: "00158018033973987",
  }).company;
  company = mergeExactVadeliAccountLearning(company, {
    bankName: "VAKIFBANK",
    accountNumber: "00158018033971234",
    lucaAccountCode: EXACT_102,
    currency: "TL",
  }).company;

  const groupHit = resolveStatementBankAccount({
    company,
    accountNumber: "00158018033973987",
    bankName: "VAKIFBANK",
    currency: "TL",
    accountType: "VADELI",
  });
  const exactHit = resolveStatementBankAccount({
    company,
    accountNumber: "00158018033971234",
    bankName: "VAKIFBANK",
    currency: "TL",
    accountType: "VADELI",
  });
  assert.equal(groupHit.code, SHARED_102);
  assert.equal(exactHit.code, EXACT_102);
  assert.equal(exactHit.mappingScope, BANK_ACCOUNT_MAPPING_SCOPE.EXACT_ACCOUNT);
});

test("Banka Parser clean-open: auto-hydrate kapalı + file input key", () => {
  const workbench = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(workbench, /her girişte temiz|auto-hydrate kapalı/);
  assert.doesNotMatch(workbench, /void hydrateCanonicalSnapshot\(\)/);
  assert.match(workbench, /fileInputKey/);
  assert.match(workbench, /key=\{fileInputKey\}/);
  assert.match(workbench, /setFileInputKey/);
  assert.match(workbench, /handlePickNewFile/);
  assert.match(workbench, /loadAuditHistoryOnly/);
});
