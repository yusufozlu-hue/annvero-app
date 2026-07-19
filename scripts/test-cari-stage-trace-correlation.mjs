/**
 * Stage-trace korelasyon: unique-memo clone + finalize sonrası token korunur.
 * 1416 hareket → 2832 Luca ölçeğinde BİLET aşamaları dolu kalır.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cari-stage-trace-correlation.mjs
 */
import assert from "node:assert/strict";
import {
  ACCOUNT_MEMORY_V2_STORAGE_KEY,
  buildCariMemoryCanonicalKey,
  fingerprintCariMemoryKey,
  hydrateAccountMemoryForPipeline,
} from "@/src/utils/accountMemoryV2";
import { normalizeBankAnalysisKey } from "@/src/utils/textNormalize";
import {
  runAccountingAnalysisOnMovementsAsync,
  buildLucaRowsFromMovementsAsync,
} from "@/src/utils/bankParserCore";
import { buildParserOnlyMovement } from "@/src/utils/bankMovementMapper";
import { analyzeMissingHesapRows } from "@/src/utils/previewExportValidation";
import { standardLucaRowsToExcelRows } from "@/src/utils/standardLucaRow";
import {
  CARI_STAGE_TARGET_CANONICAL_FP,
  CARI_STAGE_TRACE_FP_KEY,
  getCariStageTraceSnapshot,
  recordCariStageFinalMissing,
  recordCariStageHydrate,
  resetCariStageTrace,
} from "@/src/utils/cariStageTrace";

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result
        .then(() => console.log(`PASS ${name}`))
        .catch((error) => {
          console.error(`FAIL ${name}`);
          throw error;
        });
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const COMPANY = "co-stage-corr";
const ACCOUNT = "120.10.B0001";
const BANK_102 = "102.01.001";
const DESC_A =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 1111111111";
const DESC_B =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 2222222222";

const FORBIDDEN = [
  DESC_A,
  DESC_B,
  "BILETDUK",
  "ZIRAAT",
  ACCOUNT,
  "120.10",
  COMPANY,
  "co-stage",
  "_cariStageTraceFp",
];

function installMemoryStorage(initial = null) {
  const store = new Map();
  if (initial) store.set(ACCOUNT_MEMORY_V2_STORAGE_KEY, initial);
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  };
  return store;
}

function assertStagesFilled(entry) {
  assert.ok(entry["movement@mapExit"], "mapExit missing");
  assert.ok(entry["luca@built"]?.length > 0, "luca@built empty");
  assert.ok(
    entry["luca@afterAccountMemoryApply"]?.length > 0,
    "afterAccountMemory empty"
  );
  assert.ok(entry["luca@afterPostSteps"]?.length > 0, "afterPostSteps empty");
  assert.ok(entry["final@missing"]?.length > 0, "final@missing empty");
  const fp = entry.srFp;
  assert.equal(entry["movement@mapExit"].srFp, fp);
  assert.equal(entry["movement@mapExit"].traceFp, fp);
  for (const leg of entry["luca@built"]) assert.equal(leg.srFp, fp);
  for (const leg of entry["luca@afterAccountMemoryApply"]) {
    assert.equal(leg.srFp, fp);
  }
  for (const leg of entry["luca@afterPostSteps"]) assert.equal(leg.srFp, fp);
  for (const leg of entry["final@missing"]) assert.equal(leg.srFp, fp);
}

await test("1416→2832: BİLET trace survives clone/finalize across all stages", async () => {
  const now = new Date().toISOString();
  const liveKey = normalizeBankAnalysisKey(DESC_A, "GIRIS");
  installMemoryStorage(
    JSON.stringify([
      {
        id: "amv2-corr",
        companyId: COMPANY,
        bankName: "VAKIFBANK",
        analysisKey: liveKey,
        canonicalAnalysisKey: buildCariMemoryCanonicalKey(DESC_A, "GIRIS"),
        normalizedDescription: DESC_A,
        direction: "GIRIS",
        transactionType: "GELEN_HAVALE",
        decisionType: "CARI",
        accountCode: ACCOUNT,
        confidence: 100,
        source: "cari-resolution-center",
        usageCount: 1,
        successCount: 1,
        correctionCount: 0,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        isActive: true,
        schemaVersion: 2,
      },
    ])
  );

  resetCariStageTrace();
  const snap = hydrateAccountMemoryForPipeline(COMPANY);
  recordCariStageHydrate({
    buildCommit: "testcorr",
    accountMemoryReady: true,
    activeCount: snap.activeCount,
    companyId: COMPANY,
    records: snap.records,
  });

  const plan = [
    { code: "120", name: "Alıcılar", isLeaf: false },
    { code: "120.10", name: "Yurt içi", isLeaf: false },
    { code: ACCOUNT, name: "BILET", isLeaf: true },
    { code: BANK_102, name: "Vakıfbank", isLeaf: true },
  ];
  const company = {
    id: COMPANY,
    bankAccounts: [{ bankName: "VAKIFBANK", lucaAccountCode: BANK_102 }],
  };

  const TOTAL = 1416;
  const normalizedRows = [];
  for (let i = 0; i < TOTAL; i += 1) {
    let aciklama;
    if (i === 100) aciklama = DESC_A;
    else if (i === 101) aciklama = DESC_B;
    else aciklama = `GLN.HVL. DIGER FIRMA ODEME REF ${1000000 + i}`;
    normalizedRows.push({
      tarih: "2026-03-01",
      aciklama,
      tutar: 100 + (i % 50),
      yon: "GIRIS",
      banka: "VAKIFBANK",
      sourceRowId: `row-${i}`,
    });
  }

  const parserMovements = normalizedRows.map((row, i) =>
    buildParserOnlyMovement(row, { selectedBank: "VAKIFBANK" }, i)
  );
  assert.equal(parserMovements.length, TOTAL);

  const analyzed = await runAccountingAnalysisOnMovementsAsync({
    movementRows: parserMovements,
    normalizedRows,
    selectedCompany: company,
    selectedCompanyId: COMPANY,
    selectedBank: "VAKIFBANK",
    companyPlans: plan,
    accountMemoryRecords: snap.records,
    accountMemoryV2Index: snap.index,
    learningMemory: [],
    companyRules: {},
    accountingRules: [],
  });

  assert.equal(analyzed.movementRows.length, TOTAL);
  const bilets = analyzed.movementRows.filter((m) =>
    /BILETDUK/i.test(m.description || "")
  );
  assert.equal(bilets.length, 2);
  for (const m of bilets) {
    assert.ok(
      String(m[CARI_STAGE_TRACE_FP_KEY] || "").startsWith("fp:"),
      "clone must carry _cariStageTraceFp"
    );
  }
  assert.equal(
    bilets[0][CARI_STAGE_TRACE_FP_KEY],
    bilets[1][CARI_STAGE_TRACE_FP_KEY],
    "unique-memo clones share the same diagnostic token"
  );

  const lucaResult = await buildLucaRowsFromMovementsAsync(
    analyzed.movementRows,
    {
      selectedCompanyId: COMPANY,
      selectedBank: "VAKIFBANK",
      selectedCompany: company,
      companyPlans: plan,
      accountMemoryRecords: snap.records,
      learningMemory: [],
      declarationAccrualRecords: [],
    }
  );
  assert.equal(lucaResult.standardLucaRows.length, TOTAL * 2);

  const lucaWithToken = lucaResult.standardLucaRows.filter((r) =>
    String(r[CARI_STAGE_TRACE_FP_KEY] || "").startsWith("fp:")
  );
  assert.ok(
    lucaWithToken.length >= 2,
    "finalize must preserve _cariStageTraceFp on Luca legs"
  );

  recordCariStageFinalMissing(lucaResult.standardLucaRows);
  const stage = getCariStageTraceSnapshot();
  assert.equal(stage.hydrate.canonicalRecordFound, true);
  assert.ok(stage.movements.length >= 1);
  assert.ok(stage.movements.length <= 2);

  for (const entry of stage.movements) {
    assertStagesFilled(entry);
  }

  const json = JSON.stringify(stage);
  for (const bad of FORBIDDEN) {
    assert.equal(json.includes(bad), false, `PII/leak in stage JSON: ${bad}`);
  }

  const excelRows = standardLucaRowsToExcelRows(lucaWithToken.slice(0, 4));
  const excelJson = JSON.stringify(excelRows);
  assert.equal(
    excelJson.includes(CARI_STAGE_TRACE_FP_KEY),
    false,
    "Excel export must not contain diagnostic token key"
  );
  assert.equal(excelJson.includes("fp:"), false, "Excel must not leak fp tokens");

  console.log(
    "stageSample",
    JSON.stringify(
      {
        tracked: stage.movements.length,
        srFp: stage.movements[0].srFp,
        mapExitCounter: stage.movements[0]["movement@mapExit"].counterAccountFp,
        lucaBuiltLegs: stage.movements[0]["luca@built"].length,
        finalLegs: stage.movements[0]["final@missing"].length,
        accountFp: fingerprintCariMemoryKey(ACCOUNT),
        targetCanon: CARI_STAGE_TARGET_CANONICAL_FP,
      },
      null,
      2
    )
  );

  const missing = analyzeMissingHesapRows(lucaResult.standardLucaRows);
  assert.equal(Number(missing.uniqueTotalMovements || 0), TOTAL);
});

console.log("\nAll cari stage trace correlation tests passed.");
