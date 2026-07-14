/**
 * Perf pack: V2 index / policy / chunk invariants.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-accounting-analysis-perf-pack.mjs
 */

import assert from "node:assert/strict";
import {
  ACCOUNTING_ANALYSIS_UNIQUE_CHUNK_SIZE,
  buildMovementMappingContext,
  runAccountingAnalysisOnMovementsAsync,
} from "../src/utils/bankParserCore.js";
import { mapSingleParsedRowToMovement } from "../src/utils/bankMovementMapper.js";
import {
  getAccountMemoryV2IndexBuildCount,
  resetAccountMemoryV2IndexBuildCount,
  MEMORY_MATCH_TIER,
} from "../src/utils/accountMemoryV2.js";
import {
  getCompanyAccountingPolicyResolveCount,
  resetCompanyAccountingPolicyResolveCount,
  findPlanSubAccount,
} from "../src/utils/bankAccountingScenarioEngine.js";
import { buildAccountPlanIndex } from "../src/utils/accountPlanSuggestions.js";
import { matchSafeSystemBankRule } from "../src/utils/bankSmartSuggestions.js";

function section(title) {
  console.log(`\n== ${title} ==`);
}

section("1) Unique chunk size is 80");
assert.equal(ACCOUNTING_ANALYSIS_UNIQUE_CHUNK_SIZE, 80);
console.log("OK");

section("2) V2 index build once per mapping context + many resolves");
{
  resetAccountMemoryV2IndexBuildCount();
  resetCompanyAccountingPolicyResolveCount();

  const companyId = "c-perf-1";
  const records = [
    {
      id: "m1",
      companyId,
      analysisKey: "POS SATIS|GIRIS",
      direction: "GIRIS",
      transactionType: "POS_TAHSILAT",
      accountCode: "120.01.001",
      isActive: true,
      normalizedDescription: "POS SATIS",
      decisionType: "CARI",
      usageCount: 5,
      correctionCount: 0,
    },
  ];

  const companyPlans = [
    { accountCode: "102.01", accountName: "Vakifbank", isActive: true },
    { accountCode: "108.01.001", accountName: "POS Isyerı", isActive: true },
    { accountCode: "100.01", accountName: "Kasa TL", isActive: true },
    { accountCode: "103.01", accountName: "Verilen Cekler Ocak", isActive: true },
    { accountCode: "120.01.001", accountName: "Cari Musteri", isActive: true },
  ];

  const selectedCompany = {
    id: companyId,
    bankAccounts: [{ bankName: "VAKIFBANK", accountCode: "102.01", isActive: true }],
    accountingRules: {
      useGivenChecksAccount: true,
      useReceivedChecksAccount: true,
      usePos108Accounts: true,
      useCash100Account: true,
      useFxSeparate102Accounts: true,
    },
  };

  const buildsBefore = getAccountMemoryV2IndexBuildCount();
  const policiesBefore = getCompanyAccountingPolicyResolveCount();

  const ctx = buildMovementMappingContext({
    selectedCompany,
    companyPlans,
    selectedBank: "VAKIFBANK",
    selectedCompanyId: companyId,
    accountMemoryRecords: records,
    learningMemory: [],
    accountingRules: [],
  });

  assert.equal(
    getAccountMemoryV2IndexBuildCount(),
    buildsBefore + 1,
    "context should build V2 index exactly once"
  );
  assert.equal(
    getCompanyAccountingPolicyResolveCount(),
    policiesBefore + 1,
    "context should resolve policies exactly once"
  );
  assert.ok(ctx.accountMemoryV2Index?.byAnalysisKey);
  assert.ok(ctx.companyAccountingPolicies);

  const buildsAfterContext = getAccountMemoryV2IndexBuildCount();
  const policiesAfterContext = getCompanyAccountingPolicyResolveCount();

  for (let i = 0; i < 25; i += 1) {
    mapSingleParsedRowToMovement(
      {
        aciklama: `POS SATIS isyeri ${i} batch`,
        tutar: 100 + i,
        yon: "GIRIS",
        tarih: "01.02.2026",
        unvan: "",
      },
      ctx,
      i
    );
  }

  assert.equal(
    getAccountMemoryV2IndexBuildCount(),
    buildsAfterContext,
    "mapping many rows must NOT rebuild V2 index"
  );
  assert.equal(
    getCompanyAccountingPolicyResolveCount(),
    policiesAfterContext,
    "mapping many rows must NOT re-resolve company policies"
  );
  console.log("OK — indexBuild +1, policyResolve +1 across 25 maps");
}

section("3) planIndex findPlanSubAccount parity with full scan");
{
  const companyPlans = [
    { accountCode: "108", accountName: "POS Ana", isActive: true },
    { accountCode: "108.01.001", accountName: "POS Alt", isActive: true },
    { accountCode: "100.01", accountName: "Kasa TL", isActive: true },
    { accountCode: "999.01", accountName: "Pasif Dummy", isActive: false },
  ];
  const planIndex = buildAccountPlanIndex(companyPlans);
  const candidates = [
    { code: "108", nameKeywords: ["POS"] },
    { code: "108", nameKeywords: [] },
  ];
  const withIndex = findPlanSubAccount(companyPlans, candidates, {
    requireSubAccount: true,
    planIndex,
  });
  const withoutIndex = findPlanSubAccount(companyPlans, candidates, {
    requireSubAccount: true,
    planIndex: null,
  });
  assert.equal(
    withIndex?.accountCode,
    withoutIndex?.accountCode,
    "indexed plan hit must match fallback scan"
  );
  assert.equal(withIndex?.accountCode, "108.01.001");
  console.log("OK — planIndex parity", withIndex.accountCode);
}

section("4) matchSafeSystemBankRule accepts planIndex");
{
  const companyPlans = [
    { accountCode: "108.01.001", accountName: "POS HESABI", isActive: true },
  ];
  const planIndex = buildAccountPlanIndex(companyPlans);
  const a = matchSafeSystemBankRule("POS BATCH TAHSILAT", "GIRIS", {
    companyPlans,
    planIndex,
  });
  const b = matchSafeSystemBankRule("POS BATCH TAHSILAT", "GIRIS", {
    companyPlans,
  });
  assert.equal(a?.family, b?.family);
  assert.equal(a?.accountCode || "", b?.accountCode || "");
  console.log("OK — system rule planIndex", a?.family || "none");
}

section("5) Full analysis run keeps single index + policy build");
{
  resetAccountMemoryV2IndexBuildCount();
  resetCompanyAccountingPolicyResolveCount();

  const companyId = "c-perf-2";
  const movements = [];
  for (let i = 0; i < 120; i += 1) {
    const desc =
      i % 3 === 0
        ? `GELEN HAVALE REF ${1000 + (i % 10)}`
        : i % 3 === 1
          ? `POS BATCH TAHSILAT ${i}`
          : `MASRAF KOMISYON ${i}`;
    movements.push({
      id: `m-${i}`,
      description: desc,
      amount: 50 + i,
      direction: i % 2 === 0 ? "GIRIS" : "CIKIS",
      date: "01.03.2026",
      rawRow: {
        aciklama: desc,
        tutar: 50 + i,
        yon: i % 2 === 0 ? "GIRIS" : "CIKIS",
        tarih: "01.03.2026",
      },
      _parserOnly: true,
    });
  }

  const companyPlans = [
    { accountCode: "102.01", accountName: "Banka", isActive: true },
    { accountCode: "108.01.001", accountName: "POS", isActive: true },
    { accountCode: "770.01", accountName: "Banka Masraf", isActive: true },
  ];

  await runAccountingAnalysisOnMovementsAsync({
    movementRows: movements,
    selectedBank: "VAKIFBANK",
    selectedCompany: {
      id: companyId,
      bankAccounts: [{ bankName: "VAKIFBANK", accountCode: "102.01", isActive: true }],
      accountingRules: {},
    },
    companyPlans,
    companyRules: {},
    learningMemory: [],
    accountMemoryRecords: [],
    accountingRules: [],
    selectedCompanyId: companyId,
  });

  assert.equal(
    getAccountMemoryV2IndexBuildCount(),
    1,
    `expected 1 V2 index build, got ${getAccountMemoryV2IndexBuildCount()}`
  );
  assert.equal(
    getCompanyAccountingPolicyResolveCount(),
    1,
    `expected 1 policy resolve, got ${getCompanyAccountingPolicyResolveCount()}`
  );
  console.log("OK — analysis run index=1 policy=1", {
    MEMORY_MATCH_TIER_ANALYSIS: MEMORY_MATCH_TIER.ANALYSIS_KEY,
  });
}

section("6) Fingerprint stability sample");
{
  const companyId = "c-fp";
  const companyPlans = [
    { accountCode: "102.01", accountName: "Banka", isActive: true },
    { accountCode: "108.01.001", accountName: "POS ALT", isActive: true },
  ];
  const selectedCompany = {
    id: companyId,
    bankAccounts: [{ bankName: "VAKIFBANK", accountCode: "102.01", isActive: true }],
    accountingRules: {},
  };
  const ctx = buildMovementMappingContext({
    selectedCompany,
    companyPlans,
    selectedBank: "VAKIFBANK",
    selectedCompanyId: companyId,
    accountMemoryRecords: [],
    learningMemory: [],
  });
  const row = {
    aciklama: "POS BATCH GUN SONU",
    tutar: 1500,
    yon: "GIRIS",
    tarih: "05.02.2026",
  };
  const a = mapSingleParsedRowToMovement(row, ctx, 0);
  const b = mapSingleParsedRowToMovement(row, ctx, 1);
  assert.equal(a.counterAccountCode || "", b.counterAccountCode || "");
  assert.equal(a.transactionType, b.transactionType);
  console.log("OK — repeated map stable", {
    type: a.transactionType,
    counter: a.counterAccountCode || "",
  });
}

console.log("\nAll accounting analysis perf-pack tests passed.");
