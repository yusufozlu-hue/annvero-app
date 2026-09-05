/**
 * Faz 5 — Tek geçişli muhasebe kararı sözleşmesi + shadow.
 * Run: node --import ./scripts/_alias-loader.mjs --test ./scripts/test-central-accounting-decision-single-pass.mjs
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

const {
  ACCOUNTING_DECISION_SOURCE,
  resolveAccountingDecision,
  beginAccountingResolveCallTracking,
  endAccountingResolveCallTracking,
  resetAccountingResolveCallCount,
  getAccountingResolveCallCount,
} = await import("@/src/utils/centralAccountingDecisionResolver.js");

const {
  applySinglePassAccountingDecision,
  applyPostMaterializeConsumersSinglePass,
  finalizeWithLegacyCompatFallback,
  legacyCascadeToSystemCandidate,
  mapLegacyMatchSourceToTier,
} = await import("@/src/utils/centralAccountingDecisionSinglePass.js");

const {
  compareLegacyVsCentralMovementShadow,
  summarizeMovementShadowComparisons,
  compareCentralVsLegacyStatementMapping,
} = await import("@/src/utils/centralAccountingDecisionShadowCompare.js");

const {
  stampBankMaterializedLucaRow,
  stampManualAccountingDecision,
  applyOutputAccountingDecisionOnce,
  applyOutputAccountingDecisionsToRows,
  shouldSkipOutputResolve,
} = await import("@/src/utils/outputAccountingDecisionFacade.js");

const {
  bankMovementsToStandardLucaRows,
} = await import("@/src/utils/standardLucaRow.js");

const {
  prepareElektrawebExportRows,
} = await import("@/src/utils/elektrawebOutputAdapter.js");

const { applySmartBankSuggestionsToRows } = await import(
  "@/src/utils/bankSmartSuggestions.js"
);

const {
  BANK_STATEMENT_ACCOUNTING_DOC,
  buildSafeDescriptionFingerprint,
  buildAccountingMemorySignature,
  mapServerAccountingRowToV2,
} = await import("@/src/utils/accountingMemoryV1.js");

const { mergeBankProductCurrencyLearning } = await import(
  "@/src/utils/bankProductAccountMapping.js"
);

const COMPANY_A = "mare";
const COMPANY_B = "other-co";
const SHARED_102 = "102.01.037";
const VADESIZ_102 = "102.10.V001";
const COUNTER_642 = "642.01.001";
const COUNTER_193 = "193.01.001";

const PLAN = [
  { code: SHARED_102 },
  { code: VADESIZ_102 },
  { code: COUNTER_642 },
  { code: COUNTER_193 },
  { code: "320.01.USER" },
  { code: "340.01.010" },
];

function baseCompany(overrides = {}) {
  return {
    id: COMPANY_A,
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
    ],
    bankProductMappings: [],
    ...overrides,
  };
}

function withSharedVadeli(company = baseCompany()) {
  const { company: learned } = mergeBankProductCurrencyLearning(company, {
    bankName: "VAKIFBANK",
    accountType: "VADELI",
    currency: "TL",
    lucaAccountCode: SHARED_102,
  });
  return learned;
}

function dualMovement(i, {
  accountCode = SHARED_102,
  counterAccountCode = COUNTER_642,
  matchedMemoryId = null,
  decisionSource = "safeSystemRule",
} = {}) {
  return {
    id: `m-${i}`,
    sourceMovementId: `m-${i}`,
    date: "2026-03-01",
    description: `HAREKET ${i}`,
    amount: 1000 + i,
    direction: i % 2 === 0 ? "GIRIS" : "CIKIS",
    accountCode,
    counterAccountCode,
    documentType: "DK",
    lucaDescription: `HAREKET ${i}`,
    matchedMemoryId,
    decisionSource,
    decisionScopeKey: matchedMemoryId ? `mem:${matchedMemoryId}` : `sys:${i}`,
    decisionRequiresReview: false,
    missingHesapCategory: "",
  };
}

function makeLearningRow({
  companyId = COMPANY_A,
  accountCode = "320.01.USER",
  description = "FAIZ GELIR ODEME",
  lucaLeg = "counter",
  status = "active",
  bankId = "VAKIFBANK",
  direction = "GIRIS",
  transactionType = "FAIZ_GELIRI",
  currency = "TRY",
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
    is_active: status === "active",
    status,
    user_correction: JSON.stringify({
      status,
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

beforeEach(() => {
  store.clear();
  resetAccountingResolveCallCount();
  endAccountingResolveCallTracking();
});

describe("Faz5 single-pass accounting decision", () => {
  it("1) zarfsız satırda resolver en fazla 1 kez", () => {
    beginAccountingResolveCallTracking();
    const row = {
      firmaId: COMPANY_A,
      hesapKodu: "",
      detayAciklama: "POS BATCH",
      direction: "GIRIS",
    };
    const r = applySinglePassAccountingDecision(row, {
      companyId: COMPANY_A,
      company: withSharedVadeli(),
      accountPlan: PLAN,
      bankName: "VAKIFBANK",
    });
    assert.ok(r.resolveCalls <= 1);
    assert.equal(getAccountingResolveCallCount(), r.resolveCalls);
    endAccountingResolveCallTracking();
  });

  it("2) güvenilir envelope → resolver = 0", () => {
    const stamped = stampBankMaterializedLucaRow(
      {
        firmaId: COMPANY_A,
        hesapKodu: SHARED_102,
        lineRole: "borc",
        creationSource: "bank_double_entry",
      },
      {
        bankAccountCode: SHARED_102,
        source: ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY,
        companyId: COMPANY_A,
      }
    );
    beginAccountingResolveCallTracking();
    const r = applySinglePassAccountingDecision(stamped, {
      companyId: COMPANY_A,
      company: withSharedVadeli(),
    });
    assert.equal(r.resolveCalls, 0);
    assert.equal(r.skipped, true);
    assert.equal(getAccountingResolveCallCount(), 0);
    endAccountingResolveCallTracking();
  });

  it("3) manuel düzeltme korunur", () => {
    const manual = stampManualAccountingDecision(
      {
        firmaId: COMPANY_A,
        hesapKodu: "340.01.010",
        manuallyEdited: true,
      },
      { companyId: COMPANY_A }
    );
    beginAccountingResolveCallTracking();
    const again = applyOutputAccountingDecisionOnce(manual, {
      companyId: COMPANY_A,
      company: withSharedVadeli(),
      learningMemory: [makeLearningRow({ accountCode: COUNTER_642 })],
    });
    assert.equal(again.hesapKodu, "340.01.010");
    assert.equal(again.manuallyEdited, true);
    assert.ok(shouldSkipOutputResolve(again, { companyId: COMPANY_A }));
    endAccountingResolveCallTracking();
  });

  it("4) DOCUMENT > EXACT > PRODUCT > USER_LEARNED > SYSTEM önceliği", () => {
    const company = withSharedVadeli();
    const doc = resolveAccountingDecision({
      company,
      companyId: COMPANY_A,
      accountPlan: PLAN,
      bankName: "VAKIFBANK",
      productType: "VADELI",
      currency: "TL",
      accountNumber: "00158018033973987",
      documentResolutions: new Map([
        [
          "mov-1",
          {
            accountCode: VADESIZ_102,
            decisionType: "BELGE",
            sourceMovementId: "mov-1",
          },
        ],
      ]),
      sourceMovementId: "mov-1",
      lucaLeg: "bank",
    });
    assert.equal(doc.source, ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY);
    assert.equal(doc.accountCode, VADESIZ_102);

    const product = resolveAccountingDecision({
      company,
      companyId: COMPANY_A,
      accountPlan: PLAN,
      bankName: "VAKIFBANK",
      productType: "VADELI",
      currency: "TL",
      accountNumber: "00158018033973987",
      lucaLeg: "bank",
    });
    assert.equal(
      product.source,
      ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY
    );
    assert.equal(product.accountCode, SHARED_102);
  });

  it("5) USER_LEARNED keyword çelişkisinde USER_LEARNED kazanır", () => {
    const company = baseCompany();
    const desc = "TEDARIKCI ODEME XYZ";
    const learned = makeLearningRow({
      accountCode: "320.01.USER",
      description: desc,
      lucaLeg: "counter",
      transactionType: "HAVALE",
    });
    const central = resolveAccountingDecision({
      company,
      companyId: COMPANY_A,
      accountPlan: PLAN,
      bankName: "VAKIFBANK",
      bankCode: "VAKIFBANK",
      description: desc,
      direction: "GIRIS",
      transactionType: "HAVALE",
      currency: "TRY",
      learningMemory: [learned],
      lucaLeg: "counter",
      systemCandidates: [
        {
          accountCode: COUNTER_642,
          scopeKey: "keyword:tedarikci",
          confidence: 90,
        },
      ],
    });
    assert.equal(central.source, ACCOUNTING_DECISION_SOURCE.USER_LEARNED);
    assert.equal(central.accountCode, "320.01.USER");
  });

  it("6) aynı tier conflict → review", () => {
    const company = baseCompany();
    const hit = resolveAccountingDecision({
      company,
      companyId: COMPANY_A,
      accountPlan: PLAN,
      lucaLeg: "counter",
      systemCandidates: [
        { accountCode: COUNTER_642, scopeKey: "a", confidence: 40 },
        { accountCode: COUNTER_193, scopeKey: "b", confidence: 40 },
      ],
    });
    assert.equal(hit.requiresReview, true);
    assert.equal(hit.source, ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE);
  });

  it("7) requiresReview → legacy fallback yok", () => {
    const central = {
      matched: false,
      accountCode: null,
      source: ACCOUNTING_DECISION_SOURCE.USER_LEARNED,
      requiresReview: true,
      reason: "user_memory_review",
    };
    const legacy = legacyCascadeToSystemCandidate({
      accountCode: COUNTER_642,
      matchedRule: { source: "safeSystemRule" },
    });
    const fin = finalizeWithLegacyCompatFallback(central, legacy);
    assert.equal(fin.usedLegacyFallback, false);
    assert.equal(fin.decision.requiresReview, true);
    assert.notEqual(fin.decision.accountCode, COUNTER_642);
  });

  it("8) statement/counter ayrımı", () => {
    const rows = bankMovementsToStandardLucaRows(
      [dualMovement(1, { counterAccountCode: COUNTER_193 })],
      { firmaId: COMPANY_A, kaynakAdi: "VAKIFBANK" }
    );
    assert.equal(rows.length, 2);
    const legs = rows.map((r) => r.accountingDecision?.lucaLeg).sort();
    assert.deepEqual(legs, ["counter", "statement"].sort());
    const codes = rows.map((r) => r.hesapKodu).sort();
    assert.deepEqual(codes, [SHARED_102, COUNTER_193].sort());
  });

  it("9) tenant izolasyonu", () => {
    const stamped = stampBankMaterializedLucaRow(
      { firmaId: COMPANY_A, hesapKodu: SHARED_102 },
      {
        bankAccountCode: SHARED_102,
        source: ACCOUNTING_DECISION_SOURCE.EXACT_ACCOUNT,
        companyId: COMPANY_A,
      }
    );
    assert.equal(
      shouldSkipOutputResolve(stamped, { companyId: COMPANY_B }),
      false
    );
    assert.equal(
      shouldSkipOutputResolve(stamped, { companyId: COMPANY_A }),
      true
    );
  });

  it("10) passive/superseded yok sayılır", () => {
    const passive = makeLearningRow({
      accountCode: "320.01.USER",
      description: "PASIF KAYIT",
      status: "passive",
    });
    const superseded = makeLearningRow({
      accountCode: "340.01.010",
      description: "PASIF KAYIT",
      status: "superseded",
    });
    // mapServerAccountingRowToV2 isActive false → index'e girmez
    const v2p = mapServerAccountingRowToV2(passive);
    const v2s = mapServerAccountingRowToV2(superseded);
    assert.ok(!v2p || v2p.isActive === false || v2p.status !== "active");
    assert.ok(!v2s || v2s.isActive === false || v2s.status !== "active");

    const hit = resolveAccountingDecision({
      company: baseCompany(),
      companyId: COMPANY_A,
      accountPlan: PLAN,
      description: "PASIF KAYIT",
      direction: "GIRIS",
      transactionType: "FAIZ_GELIRI",
      learningMemory: [passive, superseded],
      lucaLeg: "counter",
    });
    assert.notEqual(hit.accountCode, "320.01.USER");
    assert.notEqual(hit.accountCode, "340.01.010");
  });

  it("11) stale/tampered envelope yeniden doğrulanır", () => {
    const stamped = stampBankMaterializedLucaRow(
      { firmaId: COMPANY_A, hesapKodu: SHARED_102 },
      {
        bankAccountCode: SHARED_102,
        source: ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE,
        companyId: COMPANY_A,
      }
    );
    const tampered = {
      ...stamped,
      hesapKodu: "340.01.010",
    };
    assert.equal(
      shouldSkipOutputResolve(tampered, { companyId: COMPANY_A }),
      false
    );
  });

  it("12) Luca/Elektraweb paritesi", () => {
    const rows = bankMovementsToStandardLucaRows(
      [
        dualMovement(1, { counterAccountCode: COUNTER_642 }),
        dualMovement(2, { counterAccountCode: COUNTER_193 }),
      ],
      { firmaId: COMPANY_A, kaynakAdi: "VAKIFBANK" }
    );
    const luca = applyOutputAccountingDecisionsToRows(rows, {
      companyId: COMPANY_A,
      company: baseCompany(),
    });
    const elektra = prepareElektrawebExportRows(rows, {
      companyId: COMPANY_A,
      company: baseCompany(),
    });
    assert.equal(elektra.ok, true);
    assert.equal(luca.length, elektra.rows.length);
    for (let i = 0; i < luca.length; i += 1) {
      assert.equal(luca[i].hesapKodu, elektra.rows[i].hesapKodu);
      assert.equal(Number(luca[i].borc || 0), Number(elektra.rows[i].borc || 0));
      assert.equal(Number(luca[i].alacak || 0), Number(elektra.rows[i].alacak || 0));
    }
  });

  it("13) ikinci uygulama idempotent", () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(5)], {
      firmaId: COMPANY_A,
      kaynakAdi: "VAKIFBANK",
    });
    const once = applyOutputAccountingDecisionsToRows(rows, {
      companyId: COMPANY_A,
    });
    const twice = applyOutputAccountingDecisionsToRows(once, {
      companyId: COMPANY_A,
    });
    assert.deepEqual(
      once.map((r) => r.hesapKodu),
      twice.map((r) => r.hesapKodu)
    );
    assert.deepEqual(
      once.map((r) => r.accountingDecision?.signature),
      twice.map((r) => r.accountingDecision?.signature)
    );
  });

  it("14) fetch fail → stale memory yok (boş learning)", () => {
    const hit = resolveAccountingDecision({
      company: baseCompany(),
      companyId: COMPANY_A,
      accountPlan: PLAN,
      description: "BILINMEYEN",
      learningMemory: null,
      lucaLeg: "counter",
    });
    assert.equal(hit.source, ACCOUNTING_DECISION_SOURCE.NONE);
  });

  it("15) archive/duplicate/reanalysis ikinci karar üretmez", () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(9)], {
      firmaId: COMPANY_A,
      kaynakAdi: "VAKIFBANK",
    });
    beginAccountingResolveCallTracking();
    const a = applyOutputAccountingDecisionsToRows(rows, {
      companyId: COMPANY_A,
    });
    const afterFirst = getAccountingResolveCallCount();
    const b = applyOutputAccountingDecisionsToRows(a, {
      companyId: COMPANY_A,
    });
    assert.equal(getAccountingResolveCallCount(), afterFirst);
    assert.equal(b[0].hesapKodu, a[0].hesapKodu);
    endAccountingResolveCallTracking();
  });

  it("16) Shadow MARE eşitliği (statement product)", () => {
    const company = withSharedVadeli();
    const cmp = compareCentralVsLegacyStatementMapping({
      company,
      companyId: COMPANY_A,
      accountPlan: PLAN,
      bankName: "VAKIFBANK",
      productType: "VADELI",
      currency: "TL",
      accountNumber: "00158018033973987",
    });
    assert.equal(cmp.equal, true, cmp.diffReason);
    assert.equal(cmp.newAccount, SHARED_102);
  });

  it("17) Legacy kaldırıldıktan sonra MARE sonucu değişmez (24 satır / kodlar)", () => {
    const mare = Array.from({ length: 12 }, (_, i) => {
      const counters = [COUNTER_642, COUNTER_193, "320.01.USER", COUNTER_642];
      return dualMovement(i + 1, {
        accountCode: i % 3 === 0 ? SHARED_102 : VADESIZ_102,
        counterAccountCode: counters[i % counters.length],
        decisionSource: "safeSystemRule",
      });
    });
    // Force MARE account mix: first 4 use SHARED, rest mix
    mare.forEach((m, i) => {
      m.accountCode = SHARED_102;
      if (i === 0) m.counterAccountCode = COUNTER_642;
      if (i === 1) m.counterAccountCode = COUNTER_193;
      if (i === 2) m.counterAccountCode = COUNTER_642;
      if (i === 3) m.counterAccountCode = "320.01.USER";
    });

    const rows = bankMovementsToStandardLucaRows(mare, {
      firmaId: COMPANY_A,
      kaynakAdi: "VAKIFBANK",
    });
    assert.equal(rows.length, 24);

    const consumed = applyPostMaterializeConsumersSinglePass(rows, {
      learningMemory: [],
      accountMemoryRecords: [],
      selectedCompanyId: COMPANY_A,
      firmaId: COMPANY_A,
      selectedBank: "VAKIFBANK",
    });
    assert.equal(consumed.consumersSkipped, true);
    assert.equal(consumed.rows.length, 24);

    const codes = new Set(consumed.rows.map((r) => r.hesapKodu));
    assert.ok(codes.has(SHARED_102));
    assert.ok(codes.has(COUNTER_642));
    assert.ok(codes.has(COUNTER_193));

    const shadows = mare.map((mov) =>
      compareLegacyVsCentralMovementShadow({
        company: baseCompany(),
        companyId: COMPANY_A,
        accountPlan: PLAN,
        bankName: "VAKIFBANK",
        legacyMovement: mov,
        lucaLeg: "counter",
        learningMemory: null,
      })
    );
    const summary = summarizeMovementShadowComparisons(shadows);
    // Legacy compat fallback ile selected account hizalanır
    assert.equal(summary.unequal, 0, JSON.stringify(summary.byDiff));

    // smart suggest trusted satırı ezemez
    const poisoned = applySmartBankSuggestionsToRows(consumed.rows, {
      selectedCompanyId: COMPANY_A,
      companyPlans: PLAN,
      selectedBank: "VAKIFBANK",
    });
    assert.deepEqual(
      poisoned.map((r) => r.hesapKodu),
      consumed.rows.map((r) => r.hesapKodu)
    );
  });

  it("mapLegacyMatchSourceToTier + envelope provenance", () => {
    assert.equal(
      mapLegacyMatchSourceToTier({ source: "documentResolution" }),
      ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY
    );
    assert.equal(
      mapLegacyMatchSourceToTier({ source: "firmaHafizaV2" }),
      ACCOUNTING_DECISION_SOURCE.USER_LEARNED
    );
  });
});
