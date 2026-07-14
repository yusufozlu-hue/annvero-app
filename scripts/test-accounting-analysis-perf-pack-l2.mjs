/**
 * Perf pack L2: fallback skip, normalize memo, system-rule reuse, fuzzy narrow.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-accounting-analysis-perf-pack-l2.mjs
 */
import assert from "node:assert/strict";
import {
  buildMovementMappingContext,
  createAnalysisProfile,
  attachAnalysisProfile,
  runAccountingAnalysisOnMovementsAsync,
  ACCOUNTING_ANALYSIS_UNIQUE_CHUNK_SIZE,
} from "../src/utils/bankParserCore.js";
import { mapSingleParsedRowToMovement } from "../src/utils/bankMovementMapper.js";
import {
  buildAccountMemoryV2Index,
  resolveAccountMemoryV2Decision,
  MEMORY_MATCH_TIER,
} from "../src/utils/accountMemoryV2.js";
import {
  findPlanSubAccount,
} from "../src/utils/bankAccountingScenarioEngine.js";
import { buildAccountPlanIndex } from "../src/utils/accountPlanSuggestions.js";
import {
  matchSafeSystemBankRule,
} from "../src/utils/bankSmartSuggestions.js";
import {
  beginNormalizeMemo,
  endNormalizeMemo,
  normalizeParserText,
  getActiveNormalizeMemoSize,
} from "../src/utils/textNormalize.js";
import { resolveBankTransactionType } from "../src/utils/bankTransactionType.js";

function section(title) {
  console.log(`\n== ${title} ==`);
}

section("0) chunk size still 80");
assert.equal(ACCOUNTING_ANALYSIS_UNIQUE_CHUNK_SIZE, 80);
console.log("OK");

section("1) empty prefix bucket does NOT full-scan when planIndex present");
{
  const companyPlans = [
    { accountCode: "108.01.001", accountName: "POS Alt", isActive: true },
    { accountCode: "100.01", accountName: "Kasa", isActive: true },
    ...Array.from({ length: 200 }, (_, i) => ({
      accountCode: `120.01.${String(i + 1).padStart(3, "0")}`,
      accountName: `CARI ${i}`,
      isActive: true,
    })),
  ];
  const planIndex = buildAccountPlanIndex(companyPlans);
  assert.ok(planIndex.entriesByMainPrefix);
  assert.ok(planIndex.entriesByMainPrefix.get("108")?.length);

  const profile = createAnalysisProfile();
  attachAnalysisProfile(profile);

  const missing = findPlanSubAccount(
    companyPlans,
    [{ code: "770", nameKeywords: [] }],
    { requireSubAccount: true, planIndex }
  );
  assert.equal(missing, null);
  assert.equal(
    profile.findPlanSubAccountFallbackCount,
    0,
    "indexed empty prefix must not fallback"
  );

  // Without index, legacy still may scan — parity of RESULT still null
  const without = findPlanSubAccount(
    companyPlans,
    [{ code: "770", nameKeywords: [] }],
    { requireSubAccount: true, planIndex: null }
  );
  assert.equal(without, null);

  // Existing prefix still hits
  const hit = findPlanSubAccount(
    companyPlans,
    [{ code: "108", nameKeywords: ["POS"] }],
    { requireSubAccount: true, planIndex }
  );
  assert.equal(hit?.accountCode, "108.01.001");
  attachAnalysisProfile(null);
  console.log("OK — empty prefix skip + hit parity");
}

section("2) plan index caches normalized names");
{
  const planIndex = buildAccountPlanIndex([
    { accountCode: "360.01.001", accountName: "Ödenecek Vergi", isActive: true },
  ]);
  const entry = planIndex.entryByNormalizedCode.get("360.01.001");
  assert.ok(entry);
  assert.equal(entry.normalizedCode, "360.01.001");
  assert.match(entry.normalizedName, /ODENECEK/);
  assert.ok(entry.smartNormalizedName);
  assert.equal(entry.account.accountName, "Ödenecek Vergi");
  console.log("OK — cached names", entry.normalizedName);
}

section("3) normalizeParserText memo within begin/end");
{
  beginNormalizeMemo();
  const a = normalizeParserText("Merhaba Dünya");
  const b = normalizeParserText("Merhaba Dünya");
  assert.equal(a, b);
  assert.ok(getActiveNormalizeMemoSize() >= 1);
  endNormalizeMemo();
  assert.equal(getActiveNormalizeMemoSize(), 0);
  console.log("OK — memo scoped");
}

section("4) system rule resolved once — mapper does not re-call");
{
  const companyPlans = [
    { accountCode: "108.01.001", accountName: "POS HESABI", isActive: true },
  ];
  const planIndex = buildAccountPlanIndex(companyPlans);
  const profile = createAnalysisProfile();
  attachAnalysisProfile(profile);

  const sampleType = resolveBankTransactionType("POS BATCH TAHSILAT", "GIRIS", {
    companyPlans,
    planIndex,
  });
  assert.equal(sampleType.systemRuleResolved, true);
  attachAnalysisProfile(null);

  const profile2 = createAnalysisProfile();
  attachAnalysisProfile(profile2);

  const ctx = buildMovementMappingContext({
    selectedCompany: {
      id: "c1",
      bankAccounts: [{ bankName: "VAKIFBANK", accountCode: "102.01", isActive: true }],
    },
    companyPlans,
    planIndex,
    selectedBank: "VAKIFBANK",
    selectedCompanyId: "c1",
    accountMemoryRecords: [],
    learningMemory: [],
    accountingRules: [],
  });

  mapSingleParsedRowToMovement(
    {
      aciklama: "POS BATCH TAHSILAT isyeri 1",
      tutar: 100,
      yon: "GIRIS",
      tarih: "01.02.2026",
    },
    ctx,
    0
  );

  assert.equal(
    profile2.safeSystemRuleCallCount,
    1,
    "unique map must call matchSafeSystemBankRule at most once"
  );
  attachAnalysisProfile(null);
  console.log("OK — safeSystem calls per map", profile2.safeSystemRuleCallCount);
}

section("5) fuzzy candidates narrowed vs full scoped");
{
  const companyId = "c-fuzzy";
  const records = [];
  for (let i = 0; i < 400; i += 1) {
    records.push({
      id: `m${i}`,
      companyId,
      analysisKey: `KEY${i}|GIRIS`,
      direction: "GIRIS",
      transactionType: i % 2 === 0 ? "GELEN_HAVALE" : "POS_TAHSILAT",
      accountCode: "120.01.001",
      isActive: true,
      normalizedDescription:
        i === 50
          ? "OZEL MUSTERI ODEMESI ALPHA BETA"
          : `DIGER KAYIT ${i} XYZXYZ`,
      decisionType: "CARI",
      usageCount: 1,
      correctionCount: 0,
      confidence: 100,
    });
  }
  const index = buildAccountMemoryV2Index(records, companyId);
  assert.ok(index.byToken);
  assert.ok(index.byTransactionType);

  const profile = createAnalysisProfile();
  attachAnalysisProfile(profile);
  const decision = resolveAccountMemoryV2Decision(
    {
      companyId,
      analysisKey: "MISSING|GIRIS",
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      // normalize exact değil; token overlap ile daraltılmış fuzzy
      normalizedDescription: "OZEL MUSTERI ALPHA BETA ODEME DETAY",
      amount: 10,
    },
    index,
    { allowAuto: true }
  );
  assert.ok(
    profile.fuzzyScanCount >= 1 ||
      decision.tier === MEMORY_MATCH_TIER.TYPE_TOKEN ||
      decision.tier === MEMORY_MATCH_TIER.FUZZY,
    "expected fuzzy or type-token path"
  );
  if (profile.fuzzyScanCount >= 1) {
    assert.ok(
      profile.fuzzyCandidateCount > 0 && profile.fuzzyCandidateCount < 400,
      `expected narrowed candidates, got ${profile.fuzzyCandidateCount}`
    );
    assert.ok(profile.fuzzyScoreCallCount < 400);
  }
  attachAnalysisProfile(null);
  console.log("OK — fuzzy candidates", {
    fuzzyScans: profile.fuzzyScanCount,
    candidates: profile.fuzzyCandidateCount,
    scores: profile.fuzzyScoreCallCount,
    tier: decision.tier,
  });
}

section("6) matchSafeSystemBankRule still works with planIndex");
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
  console.log("OK");
}

section("7) analysis attaches normalize memo (no leak)");
await (async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    id: `m${i}`,
    description: `Test ${i}`,
    amount: 10,
    direction: "GIRIS",
    date: "01.02.2026",
    bankName: "VAKIFBANK",
    rawRow: {
      aciklama: `Test hareket ${i} aciklama`,
      tutar: 10,
      yon: "GIRIS",
      tarih: "01.02.2026",
    },
    _parserOnly: true,
  }));

  await runAccountingAnalysisOnMovementsAsync({
    movementRows: rows,
    selectedBank: "VAKIFBANK",
    selectedCompanyId: "c1",
    selectedCompany: {
      id: "c1",
      bankAccounts: [{ bankName: "VAKIFBANK", accountCode: "102.01", isActive: true }],
    },
    companyPlans: [
      { accountCode: "102.01", accountName: "Banka", isActive: true },
    ],
  });
  assert.equal(getActiveNormalizeMemoSize(), 0, "memo must clear after analysis");
  console.log("OK — memo cleared");
})();

console.log("\nALL L2 PERF PACK TESTS PASSED");
