/**
 * Merkezi Muhasebe Hafızası read resolver — Faz 1 regresyon.
 * Run: node --import ./scripts/_alias-loader.mjs --test ./scripts/test-central-accounting-memory-resolver.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

const {
  resolveAccountingDecision,
  ACCOUNTING_DECISION_SOURCE,
  mapCentralDecisionToStatementResolve,
} = await import("@/src/utils/centralAccountingDecisionResolver.js");

const { compareCentralVsLegacyStatementMapping } = await import(
  "@/src/utils/centralAccountingDecisionShadowCompare.js"
);

const { resolveStatementBankAccount } = await import(
  "@/src/utils/vadeliMevduatLifecycle.js"
);

const { mergeBankProductCurrencyLearning } = await import(
  "@/src/utils/bankProductAccountMapping.js"
);

const { BANK_STATEMENT_ACCOUNTING_DOC, buildAccountingMemorySignature, buildSafeDescriptionFingerprint } =
  await import("@/src/utils/accountingMemoryV1.js");

const SHARED_102 = "102.01.037";
const EXACT_102 = "102.10.V088";
const VADESIZ_102 = "102.10.V001";

const PLAN = [
  { code: VADESIZ_102 },
  { code: SHARED_102 },
  { code: EXACT_102 },
  { code: "642.01.001" },
  { code: "193.01.001" },
];

function baseCompany(overrides = {}) {
  return {
    id: "mare",
    companyName: "MARE RESORT",
    bankAccounts: [
      {
        bankName: "VAKIFBANK",
        accountType: "VADESIZ",
        lucaAccountCode: VADESIZ_102,
        accountNumber: "00158018033970001",
        currency: "TL",
        isActive: true,
      },
      {
        bankName: "VAKIFBANK",
        accountType: "VADELI",
        lucaAccountCode: EXACT_102,
        accountNumber: "00158018033973999",
        currency: "TL",
        isActive: true,
      },
    ],
    bankProductMappings: [],
    ...overrides,
  };
}

function withSharedVadeliRule(company = baseCompany()) {
  const { company: learned } = mergeBankProductCurrencyLearning(company, {
    bankName: "VAKIFBANK",
    accountType: "VADELI",
    currency: "TL",
    lucaAccountCode: SHARED_102,
  });
  return learned;
}

function makeLearningRow({
  companyId = "mare",
  accountCode = "320.01.TEST",
  bankId = "VAKIFBANK",
  direction = "GIRIS",
  transactionType = "FAIZ_GELIRI",
  currency = "TRY",
  description = "FAIZ GELIR ODEME",
  lucaLeg = "",
} = {}) {
  const fp = buildSafeDescriptionFingerprint(description);
  const leg =
    lucaLeg ||
    (/^102(\.|$)/.test(String(accountCode || "").trim())
      ? "statement"
      : "counter");
  const signature = buildAccountingMemorySignature({
    bankId,
    direction,
    transactionType,
    currency,
    descriptionFingerprint: fp,
    lucaLeg: leg,
  });
  return {
    id: `lm-${signature.slice(-8)}`,
    company_id: companyId,
    keyword: signature,
    account_code: accountCode,
    document_type: BANK_STATEMENT_ACCOUNTING_DOC,
    transaction_type: transactionType,
    bank_name: bankId,
    is_active: true,
    status: "active",
    user_correction: JSON.stringify({
      status: "active",
      confidence: 95,
      direction,
      currency,
      bankId,
      lucaLeg: leg,
      lucaLegConfidence: "explicit",
      canonicalAnalysisKey: signature,
    }),
  };
}

test("1. document-only yalnız kendi hareketinde kazanır", () => {
  const resolutions = [
    {
      source_movement_id: "m1",
      account_code: SHARED_102,
      status: "active",
      revision: 1,
      luca_leg: "bank",
    },
    {
      source_movement_id: "m2",
      account_code: EXACT_102,
      status: "active",
      revision: 1,
      luca_leg: "bank",
    },
  ];
  const hit = resolveAccountingDecision({
    company: withSharedVadeliRule(),
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973987",
    sourceMovementId: "m1",
    documentResolutions: resolutions,
  });
  assert.equal(hit.source, ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY);
  assert.equal(hit.accountCode, SHARED_102);
  assert.equal(hit.matched, true);

  const miss = resolveAccountingDecision({
    company: withSharedVadeliRule(),
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973987",
    sourceMovementId: "m-other",
    documentResolutions: resolutions,
  });
  assert.notEqual(miss.source, ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY);
  assert.equal(miss.accountCode, SHARED_102);
});

test("2. exact account product rule'u ezer", () => {
  const company = withSharedVadeliRule();
  const hit = resolveAccountingDecision({
    company,
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973999",
  });
  assert.equal(hit.source, ACCOUNTING_DECISION_SOURCE.EXACT_ACCOUNT);
  assert.equal(hit.accountCode, EXACT_102);
});

test("3. VakıfBank+VADELI+TRY ortak 102 eşleşir", () => {
  const company = withSharedVadeliRule();
  const hit = resolveAccountingDecision({
    company,
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973987",
  });
  assert.equal(hit.source, ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY);
  assert.equal(hit.accountCode, SHARED_102);
  assert.equal(hit.matched, true);
});

test("4. aynı kural USD'de eşleşmez", () => {
  const company = withSharedVadeliRule();
  const hit = resolveAccountingDecision({
    company,
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "USD",
    accountNumber: "00158018033973987",
  });
  assert.equal(hit.matched, false);
  assert.equal(hit.source, ACCOUNTING_DECISION_SOURCE.NONE);
});

test("5. aynı kural EUR'da eşleşmez", () => {
  const company = withSharedVadeliRule();
  const hit = resolveAccountingDecision({
    company,
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "EUR",
    accountNumber: "00158018033973987",
  });
  assert.equal(hit.matched, false);
});

test("6. başka bankada eşleşmez", () => {
  const company = withSharedVadeliRule();
  const hit = resolveAccountingDecision({
    company,
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "ZIRAAT",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973987",
  });
  assert.equal(hit.matched, false);
});

test("7. user learned sistem kuralını ezer", () => {
  const company = baseCompany();
  const learningMemory = [
    makeLearningRow({
      accountCode: "320.01.USER",
      description: "OZEL ODEME FAIZ",
      transactionType: "UNKNOWN",
    }),
  ];
  const hit = resolveAccountingDecision({
    company,
    companyId: "mare",
    accountPlan: [...PLAN, { code: "320.01.USER" }],
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "99999999999999",
    description: "OZEL ODEME FAIZ",
    direction: "GIRIS",
    transactionType: "UNKNOWN",
    learningMemory,
    systemCandidates: [
      { accountCode: "642.01.001", confidence: 50, scopeKey: "sys-faiz" },
    ],
    lucaLeg: "counter",
  });
  assert.equal(hit.source, ACCOUNTING_DECISION_SOURCE.USER_LEARNED);
  assert.equal(hit.accountCode, "320.01.USER");
});

test("8. aynı öncelikte çelişki review üretir", () => {
  const company = baseCompany({
    bankProductMappings: [
      {
        scope: "BANK_PRODUCT_CURRENCY",
        bankName: "VAKIFBANK",
        accountType: "VADELI",
        currency: "TL",
        lucaAccountCode: SHARED_102,
      },
      {
        scope: "BANK_PRODUCT_CURRENCY",
        bankName: "VAKIFBANK",
        accountType: "VADELI",
        currency: "TL",
        lucaAccountCode: EXACT_102,
      },
    ],
  });
  const hit = resolveAccountingDecision({
    company,
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973987",
  });
  assert.equal(hit.matched, false);
  assert.equal(hit.requiresReview, true);
  assert.equal(hit.source, ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY);
});

test("9. pasif/hesap planında olmayan kod uygulanmaz", () => {
  const company = withSharedVadeliRule();
  const hit = resolveAccountingDecision({
    company,
    companyId: "mare",
    accountPlan: [{ code: VADESIZ_102 }],
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973987",
  });
  assert.equal(hit.matched, false);
  assert.equal(hit.requiresReview, true);
  assert.match(hit.reason, /account_not_in_plan|hard_rule/);
});

test("10. firma A kuralı firma B'ye taşmaz", () => {
  const companyA = withSharedVadeliRule();
  const companyB = baseCompany({ id: "other", companyName: "OTHER" });
  const hit = resolveAccountingDecision({
    company: companyB,
    companyId: "other",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973987",
  });
  assert.equal(hit.matched, false);
  assert.notEqual(companyA.bankProductMappings.length, 0);
});

test("11. eşleşme yoksa NONE/review", () => {
  const hit = resolveAccountingDecision({
    company: baseCompany(),
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973987",
  });
  assert.equal(hit.matched, false);
  assert.equal(hit.source, ACCOUNTING_DECISION_SOURCE.NONE);
  assert.equal(hit.requiresReview, true);
});

test("12. evidence hassas IBAN/ham açıklama içermez", () => {
  const hit = resolveAccountingDecision({
    company: withSharedVadeliRule(),
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973987",
    iban: "TR33000670100000000158018033973987",
    description: "TR33000670100000000158018033973987 FAIZ 1500,00",
  });
  const blob = JSON.stringify(hit.evidence || {});
  assert.doesNotMatch(blob, /TR33/i);
  assert.doesNotMatch(blob, /00158018033973987/);
  assert.doesNotMatch(blob, /1500/);
  assert.ok(hit.accountCode);
});

test("shadow: merkezi vs legacy mapping MARE ortak 102 aynı", () => {
  const company = withSharedVadeliRule();
  const cmp = compareCentralVsLegacyStatementMapping({
    company,
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    productType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973987",
  });
  assert.equal(cmp.equal, true, cmp.diffReason || "mismatch");
  assert.equal(cmp.newAccount, SHARED_102);
});

test("pilot: resolveStatementBankAccount merkezi yol MARE ortak 102", () => {
  const company = withSharedVadeliRule();
  const stmt = resolveStatementBankAccount({
    company,
    companyId: "mare",
    accountPlan: PLAN,
    bankName: "VAKIFBANK",
    accountType: "VADELI",
    currency: "TL",
    accountNumber: "00158018033973987",
  });
  assert.equal(stmt.ok, true);
  assert.equal(stmt.code, SHARED_102);
  assert.ok(stmt.centralSource || stmt.mappingScope);
});

test("mapCentralDecisionToStatementResolve contract shape", () => {
  const mapped = mapCentralDecisionToStatementResolve({
    matched: true,
    accountCode: SHARED_102,
    source: ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY,
    confidence: 80,
    requiresReview: false,
    reason: "bank_product_currency",
    scopeKey: "product|VAKIFBANK|VADELI|TL",
    evidence: {},
  });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.code, SHARED_102);
});
