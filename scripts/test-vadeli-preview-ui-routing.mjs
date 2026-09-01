/**
 * Vadeli onboarding UX + routing regresyonu.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-vadeli-preview-ui-routing.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCariResolutionGroups,
  selectVisibleResolutionGroups,
  listResolvableResolutionGroups,
  formatCariApplyButtonLabel,
  CARI_RESOLUTION_FILTERS,
  PARTY_UNRESOLVED_LABEL,
  VADELI_ACCOUNT_MISSING_LABEL,
  FAIZ_STOPAJI_MISSING_LABEL,
  isCariMissingRow,
} from "@/src/utils/cariMissingResolutionGroups.js";
import {
  stripStandardLucaRow,
  bankMovementToStandardLucaRows,
} from "@/src/utils/standardLucaRow.js";
import { BANK_TRANSACTION_TYPE } from "@/src/utils/bankTransactionType.js";
import { MISSING_HESAP_CATEGORY } from "@/src/utils/previewExportValidation.js";
import { VADELI_LIFECYCLE_SCENARIO } from "@/src/utils/vadeliMevduatLifecycle.js";
import {
  buildVadeliOnboardingGroups,
  formatVadeliOnboardingApplyLabel,
  mergeStatementVadeliBankLearning,
  maskBankAccountNumber,
  VADELI_ONBOARDING_STEP,
  isBankSideLucaLine,
} from "@/src/utils/vadeliResolutionOnboarding.js";
import { shouldApplyVadeliOnboardingRow } from "@/src/utils/vadeliResolutionOnboarding.js";

const COMPANY = {
  id: "company-vadeli-ui",
  name: "TEST TURIZM A.S.",
  companyName: "TEST",
  bankAccounts: [
    {
      bankName: "VAKIFBANK",
      accountType: "VADESIZ",
      lucaAccountCode: "102.10.V001",
      accountNumber: "158007308428449",
      isActive: true,
    },
  ],
};

const PLANS = [
  { accountCode: "102.10.V001", accountName: "VAKIFBANK TL VADESIZ ONBURO", isActive: true },
  { accountCode: "102.10.V099", accountName: "VAKIFBANK TL VADELI MEVDUAT", isActive: true },
  { accountCode: "193.01.001", accountName: "PESIN VERGI", isActive: true },
  { accountCode: "193.01.002", accountName: "DIGER STOPAJ", isActive: true },
  { accountCode: "120.01.001", accountName: "MUSTERI X", isActive: true },
  { accountCode: "320.01.001", accountName: "TEDARIKCI Y", isActive: true },
];

function missingLegs({
  id,
  transactionType,
  description,
  amount = 1000,
  direction = "CIKIS",
  missingHesapCategory = "",
  accountingScenario = VADELI_LIFECYCLE_SCENARIO,
  vadeliLifecycleRole = "",
  accountCode = "",
  counterAccountCode = "",
}) {
  const movement = {
    id: `m-${id}`,
    amount,
    direction,
    description,
    lucaDescription: description,
    accountCode,
    counterAccountCode,
    transactionType,
    accountingScenario,
    cariRequired: false,
    missingHesapCategory,
    vadeliLifecycleRole,
    warning: missingHesapCategory || "Hesap eşleşmesi bulunamadı",
  };
  return bankMovementToStandardLucaRows(movement, `F-${id}`, {
    kaynakAdi: "VAKIFBANK",
    bankAccounts: COMPANY.bankAccounts,
  }).map(stripStandardLucaRow);
}

test("onboarding: unmatched statement → tek STATEMENT kartı, stopaj ayrı, vadesiz ertelenir", () => {
  const legs = [
    ...missingLegs({
      id: "acilis",
      transactionType: BANK_TRANSACTION_TYPE.VADELI_ACILIS,
      description: "Vadeli Hesap Acma",
      direction: "CIKIS",
      missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      vadeliLifecycleRole: "VADELI_ACILIS",
    }),
    ...missingLegs({
      id: "kapanis",
      transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
      description: "Hesap Kapatma",
      direction: "GIRIS",
      missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      vadeliLifecycleRole: "VADELI_KAPANIS",
    }),
    ...missingLegs({
      id: "stopaj1",
      transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
      description: "Mevduat Faiz Stopaj",
      missingHesapCategory: MISSING_HESAP_CATEGORY.FAIZ_STOPAJI_HESAP,
      vadeliLifecycleRole: "FAIZ_STOPAJI",
      amount: 50,
    }),
    ...missingLegs({
      id: "stopaj2",
      transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
      description: "Stopaj",
      missingHesapCategory: MISSING_HESAP_CATEGORY.FAIZ_STOPAJI_HESAP,
      vadeliLifecycleRole: "FAIZ_STOPAJI",
      amount: 51,
    }),
  ];

  const snapshot = buildCariResolutionGroups(legs, {
    selectedCompany: COMPANY,
    companyPlans: PLANS,
    selectedBank: "VAKIFBANK",
    sourceFileName: "00158018033973987.pdf",
  });

  assert.equal(snapshot.groupCount, 0);
  assert.equal(snapshot.cariMissingCount, 0);
  assert.equal(snapshot.virmanCandidateCount || 0, 0);
  assert.equal(snapshot.vadeliAccountGroupCount, 1, "tek statement kartı");
  assert.equal(snapshot.faizStopajiGroupCount, 1, "tek stopaj kartı");

  const statement = snapshot.vadeliAccountGroups[0];
  assert.equal(statement.vadeliOnboardingStep, VADELI_ONBOARDING_STEP.STATEMENT_102);
  assert.equal(statement.partyName, VADELI_ACCOUNT_MISSING_LABEL);
  assert.equal(statement.statementAccountMasked, "…3987");
  assert.match(statement.statementBankName || "", /Vakıf/i);
  assert.equal(
    statement.onboardingQuestion,
    "Bu vadeli mevduat hesabı hangi 102 alt hesabıdır?"
  );
  assert.ok(
    (statement.candidates || []).every((c) => String(c.code).startsWith("102."))
  );
  assert.ok(
    (statement.candidates || []).some((c) => c.code === "102.10.V099"),
    "vadeli 102 aday"
  );
  assert.ok(
    !(statement.candidates || []).some((c) => c.code === "102.10.V001"),
    "vadesiz aday statement listesinde olmamalı"
  );
  assert.equal(
    formatCariApplyButtonLabel(statement.count, statement),
    "Vadeli 102 hesabını eşleştir"
  );

  const stopaj = snapshot.faizStopajiGroups[0];
  assert.equal(stopaj.vadeliOnboardingStep, VADELI_ONBOARDING_STEP.FAIZ_STOPAJI_193);
  assert.equal(stopaj.partyName, FAIZ_STOPAJI_MISSING_LABEL);
  assert.equal(stopaj.count, 2);
  assert.match(
    formatVadeliOnboardingApplyLabel(stopaj, stopaj.count),
    /193 hesabını 2 işleme uygula/
  );
  assert.ok((stopaj.candidates || []).every((c) => String(c.code).startsWith("193.")));

  const union = listResolvableResolutionGroups(snapshot);
  assert.ok(!union.some((g) => g.partyName === PARTY_UNRESOLVED_LABEL));
  assert.ok(
    !union.some(
      (g) => g.vadeliOnboardingStep === VADELI_ONBOARDING_STEP.VADESIZ_COUNTER
    ),
    "statement açıkken vadesiz kartı yok"
  );
});

test("onboarding: statement dolu → açılış+kapanış tek VADESIZ kartı", () => {
  const companyLinked = {
    ...COMPANY,
    bankAccounts: [
      ...COMPANY.bankAccounts,
      {
        bankName: "VAKIFBANK",
        accountType: "VADELI",
        lucaAccountCode: "102.10.V099",
        accountNumber: "00158018033973987",
        isActive: true,
      },
    ],
  };
  const legs = [
    ...missingLegs({
      id: "acilis2",
      transactionType: BANK_TRANSACTION_TYPE.VADELI_ACILIS,
      description: "Vadeli Hesap Acma",
      direction: "CIKIS",
      accountCode: "102.10.V099",
      counterAccountCode: "",
      missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      vadeliLifecycleRole: "VADELI_ACILIS",
    }),
    ...missingLegs({
      id: "kapanis2",
      transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
      description: "Hesap Kapatma",
      direction: "GIRIS",
      accountCode: "102.10.V099",
      counterAccountCode: "",
      missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      vadeliLifecycleRole: "VADELI_KAPANIS",
    }),
  ];
  const counterOnly = legs.filter((r) => !String(r.hesapKodu || "").trim());
  assert.ok(counterOnly.every((r) => !isBankSideLucaLine(r)));

  const built = buildVadeliOnboardingGroups(counterOnly, {
    selectedCompany: companyLinked,
    companyPlans: PLANS,
    selectedBank: "VAKIFBANK",
    sourceFileName: "00158018033973987.pdf",
    allRows: legs,
  });
  assert.equal(built.vadeliAccountGroups.length, 1);
  const g = built.vadeliAccountGroups[0];
  assert.equal(g.vadeliOnboardingStep, VADELI_ONBOARDING_STEP.VADESIZ_COUNTER);
  assert.equal(g.count, 2, "açılış+kapanış birlikte");
  assert.match(g.onboardingQuestion || "", /vadesiz/i);
  assert.equal(g.learnAllowedDefault, false);
  assert.equal(g.suggestedAccount, "102.10.V001");
  assert.equal(
    formatVadeliOnboardingApplyLabel(g, 2),
    "Vadesiz karşı hesabı 2 işleme uygula"
  );
  assert.ok(
    (g.candidates || []).every((c) => c.code !== "102.10.V099"),
    "vadeli hesap vadesiz listesinde olmamalı"
  );
});

test("mergeStatementVadeliBankLearning kalıcı bağ yazar; kod uydurmaz", () => {
  const { company, changed } = mergeStatementVadeliBankLearning(COMPANY, {
    bankName: "VAKIFBANK",
    accountNumber: "00158018033973987",
    lucaAccountCode: "102.10.V099",
  });
  assert.equal(changed, true);
  const bank = (company.bankAccounts || []).find(
    (b) => String(b.lucaAccountCode) === "102.10.V099"
  );
  assert.ok(bank);
  assert.equal(String(bank.accountType).toUpperCase(), "VADELI");
  assert.equal(maskBankAccountNumber(bank.accountNumber), "…3987");

  const bad = mergeStatementVadeliBankLearning(COMPANY, {
    bankName: "VAKIFBANK",
    accountNumber: "00158018033973987",
    lucaAccountCode: "102",
  });
  assert.equal(bad.changed, false);
});

test("applyLeg: statement yalnız banka bacağına, stopaj yalnız karşıya", () => {
  const bankRow = {
    id: "b1",
    lineRole: "alacak",
    direction: "CIKIS",
    transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
  };
  const counterRow = {
    id: "c1",
    lineRole: "borc",
    direction: "CIKIS",
    transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
  };
  assert.equal(isBankSideLucaLine(bankRow), true);
  assert.equal(isBankSideLucaLine(counterRow), false);
  assert.equal(
    shouldApplyVadeliOnboardingRow(bankRow, { applyLeg: "bankLeg" }),
    true
  );
  assert.equal(
    shouldApplyVadeliOnboardingRow(counterRow, { applyLeg: "bankLeg" }),
    false
  );
  assert.equal(
    shouldApplyVadeliOnboardingRow(counterRow, { applyLeg: "counterLeg" }),
    true
  );
});

test("strip sonrası routing: CARI GRUP=0, Karşı taraf yok", () => {
  const legs = missingLegs({
    id: "bare",
    transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
    description: "Hesap Kapatma",
    missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
    vadeliLifecycleRole: "VADELI_KAPANIS",
  });
  for (const row of legs.filter((r) => !r.hesapKodu)) {
    assert.equal(isCariMissingRow(row, { selectedCompany: COMPANY }), false);
  }
  const snapshot = buildCariResolutionGroups(legs, {
    selectedCompany: COMPANY,
    companyPlans: PLANS,
    selectedBank: "VAKIFBANK",
    sourceFileName: "00158018033973987.pdf",
  });
  assert.equal(snapshot.groupCount, 0);
  assert.ok(snapshot.vadeliAccountGroupCount >= 1);
  const surface = selectVisibleResolutionGroups({
    filter: CARI_RESOLUTION_FILTERS.REMAINING,
    groups: snapshot.groups,
    vadeliAccountGroups: snapshot.vadeliAccountGroups,
    faizStopajiGroups: snapshot.faizStopajiGroups,
  });
  assert.ok(surface.some((g) => g.partyName === VADELI_ACCOUNT_MISSING_LABEL));
  assert.ok(!surface.some((g) => g.partyName === PARTY_UNRESOLVED_LABEL));
});

console.log("OK: test-vadeli-preview-ui-routing");
