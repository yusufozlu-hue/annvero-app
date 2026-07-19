/**
 * PII-free cari stage trace — yapı + sızıntı kapısı.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cari-stage-trace.mjs
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
  CARI_STAGE_TARGET_CANONICAL_FP,
  CARI_STAGE_WINDOW_KEY,
  beginCariStageAccountMemoryApply,
  finishCariStageAccountMemoryApply,
  fingerprintSourceRowId,
  getCariStageTraceSnapshot,
  matchesCariStageTargetCanonical,
  recordCariStageAfterPostSteps,
  recordCariStageFinalMissing,
  recordCariStageHydrate,
  recordCariStageLucaBuilt,
  recordCariStageMovementMapExit,
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

const COMPANY = "co-stage-trace-test";
const ACCOUNT = "120.10.B0001";
const DESC_A =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 1111111111";
const DESC_B =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 2222222222";
const DESC_OTHER =
  "GLN.HVL. BASKA BIR FIRMA ODEME REF 9999999999";

const FORBIDDEN_SUBSTRINGS = [
  DESC_A,
  DESC_B,
  "BILETDUK",
  "ZIRAAT",
  "120.10.B0001",
  "120.10",
  COMPANY,
  "co-stage",
  "TR00",
  "unvan",
  "IBAN",
  "sourceRowId",
  "fresh-a",
  "fresh-b",
];

function installMemoryStorage(initial = null) {
  const store = new Map();
  if (initial) store.set(ACCOUNT_MEMORY_V2_STORAGE_KEY, initial);
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
    removeItem: () => {},
  };
  return store;
}

await test("target canonical fingerprint is fp:a1e58d49", () => {
  const cm = buildCariMemoryCanonicalKey(DESC_A, "GIRIS");
  assert.equal(fingerprintCariMemoryKey(cm), CARI_STAGE_TARGET_CANONICAL_FP);
  assert.equal(
    matchesCariStageTargetCanonical({
      description: DESC_A,
      direction: "GIRIS",
    }),
    true
  );
  assert.equal(
    matchesCariStageTargetCanonical({
      description: DESC_OTHER,
      direction: "GIRIS",
    }),
    false
  );
});

await test("stage pipeline records at most 2 BİLET movements without PII", () => {
  const now = new Date().toISOString();
  const liveKey = normalizeBankAnalysisKey(DESC_A, "GIRIS");
  installMemoryStorage(
    JSON.stringify([
      {
        id: "amv2-stage",
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
    buildCommit: "ab8719e",
    accountMemoryReady: snap.ready,
    activeCount: snap.activeCount,
    companyId: COMPANY,
    records: snap.records,
  });

  for (const [desc, sid] of [
    [DESC_A, "fresh-a"],
    [DESC_B, "fresh-b"],
    [DESC_OTHER, "fresh-other"],
  ]) {
    const ak = normalizeBankAnalysisKey(desc, "GIRIS");
    recordCariStageMovementMapExit({
      sourceRowId: sid,
      description: desc,
      analysisKey: ak,
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      firmDecision: {
        mode: "auto",
        autoApply: desc !== DESC_OTHER,
        rejectReason: "",
      },
      counterAccountCode: desc === DESC_OTHER ? "" : ACCOUNT,
      matchedMemoryId: desc === DESC_OTHER ? null : "amv2-stage",
    });
  }

  const lucaRows = [
    {
      sourceRowId: "fresh-a",
      direction: "GIRIS",
      analysisKey: liveKey,
      hesapKodu: "102.01.001",
      transactionType: "GELEN_HAVALE",
    },
    {
      sourceRowId: "fresh-a",
      direction: "GIRIS",
      analysisKey: liveKey,
      hesapKodu: "",
      transactionType: "GELEN_HAVALE",
      riskDurumu: "HESAP_EKSIK",
    },
    {
      sourceRowId: "fresh-b",
      direction: "GIRIS",
      analysisKey: liveKey,
      hesapKodu: "102.01.001",
      transactionType: "GELEN_HAVALE",
    },
    {
      sourceRowId: "fresh-b",
      direction: "GIRIS",
      analysisKey: liveKey,
      hesapKodu: "",
      transactionType: "GELEN_HAVALE",
      riskDurumu: "HESAP_EKSIK",
    },
  ];

  recordCariStageLucaBuilt(lucaRows);
  beginCariStageAccountMemoryApply(lucaRows);
  const afterApply = lucaRows.map((row) =>
    row.hesapKodu
      ? row
      : { ...row, hesapKodu: ACCOUNT, accountMemoryAutoFilled: true }
  );
  finishCariStageAccountMemoryApply(afterApply, {
    companyId: COMPANY,
    accountMemoryRecords: snap.records,
  });
  recordCariStageAfterPostSteps(afterApply);
  recordCariStageFinalMissing(afterApply);

  const out = getCariStageTraceSnapshot();
  assert.equal(out.targetCanonicalFp, CARI_STAGE_TARGET_CANONICAL_FP);
  assert.equal(out.hydrate.canonicalRecordFound, true);
  assert.equal(out.hydrate.buildCommit, "ab8719e");
  assert.equal(out.movements.length, 2);

  const srA = fingerprintSourceRowId("fresh-a");
  const srB = fingerprintSourceRowId("fresh-b");
  assert.ok(out.movements.some((m) => m.srFp === srA));
  assert.ok(out.movements.some((m) => m.srFp === srB));

  for (const m of out.movements) {
    assert.ok(m["movement@mapExit"]);
    assert.equal(m["luca@built"].length, 2);
    assert.equal(m["luca@afterAccountMemoryApply"].length, 2);
    assert.equal(m["luca@afterPostSteps"].length, 2);
    assert.equal(m["final@missing"].length, 2);
  }

  const json = JSON.stringify(out);
  for (const bad of FORBIDDEN_SUBSTRINGS) {
    assert.equal(
      json.includes(bad),
      false,
      `PII/leak substring present: ${bad}`
    );
  }
  assert.ok(globalThis.window[CARI_STAGE_WINDOW_KEY]);
  assert.equal(globalThis.window[CARI_STAGE_WINDOW_KEY].movements.length, 2);
});

await test("reset clears previous run", () => {
  resetCariStageTrace();
  const out = getCariStageTraceSnapshot();
  assert.equal(out.movements.length, 0);
  assert.equal(out.hydrate, null);
});

console.log("\nAll cari stage trace tests passed.");
