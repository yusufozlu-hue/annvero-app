/**
 * Fresh reload: storage’da başarılı BİLET kaydı → hydrate → accounting → luca.
 * Save helper çağırmaz. Luca alacak bacağı yön tuzağını da kapsar.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cari-biletduk-fresh-reload-pipeline.mjs
 */
import assert from "node:assert/strict";
import {
  ACCOUNT_MEMORY_V2_STORAGE_KEY,
  applyAccountMemoryV2RecordsToRows,
  buildCariMemoryCanonicalKey,
  fingerprintCariMemoryKey,
  hydrateAccountMemoryForPipeline,
  loadAccountMemoryV2Records,
  resolveAccountMemoryV2Decision,
  traceAccountMemoryLookup,
} from "@/src/utils/accountMemoryV2.js";
import { runAccountingAnalysisOnMovementsAsync } from "@/src/utils/bankParserCore.js";
import { buildParserOnlyMovement } from "@/src/utils/bankMovementMapper.js";
import { normalizeBankAnalysisKey } from "@/src/utils/textNormalize.js";
import { analyzeMissingHesapRows } from "@/src/utils/previewExportValidation.js";
import { bankMovementToStandardLucaRows } from "@/src/utils/standardLucaRow.js";
import { buildCariResolutionGroups } from "@/src/utils/cariMissingResolutionGroups.js";

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

function installMemoryStorage(initial = null) {
  const store = new Map();
  if (initial) store.set(ACCOUNT_MEMORY_V2_STORAGE_KEY, initial);
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
    },
  };
  return store;
}

const COMPANY = "co-fresh-reload";
const ACCOUNT = "120.10.B0001";
const DESC_A =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 1111111111";
const DESC_B =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 2222222222";
const CANON = buildCariMemoryCanonicalKey(DESC_A, "GIRIS");
const LIVE_KEY = normalizeBankAnalysisKey(DESC_A, "GIRIS");

const stageTrace = {
  storageAfterReload: null,
  hydratedMemory: null,
  actualRowQuery: [],
  lookupResult: [],
  afterMemoryApply: [],
  afterCariResolution: [],
  finalRow: [],
};

await test("fresh reload: storage → hydrate → accounting → luca BİLET apply", async () => {
  const now = new Date().toISOString();
  // Canlı saveTrace sonrası tek aktif leaf (save tarafına dokunulmaz)
  const stored = [
    {
      id: "amv2-live-saved",
      companyId: COMPANY,
      bankId: "VAKIFBANK",
      bankName: "VAKIFBANK",
      analysisKey: LIVE_KEY,
      canonicalAnalysisKey: CANON,
      normalizedDescription: DESC_A,
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      decisionType: "CARI",
      accountCode: ACCOUNT,
      accountName: "BILET",
      cariId: ACCOUNT,
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
      finalDescriptionTemplate: DESC_A,
    },
  ];
  installMemoryStorage(JSON.stringify(stored));

  const loaded = loadAccountMemoryV2Records().filter(
    (r) => r.isActive !== false && r.companyId === COMPANY
  );
  stageTrace.storageAfterReload = {
    activeCount: loaded.length,
    canonicalFp: fingerprintCariMemoryKey(loaded[0]?.canonicalAnalysisKey || ""),
    accountFp: fingerprintCariMemoryKey(loaded[0]?.accountCode || ""),
    companyFp: fingerprintCariMemoryKey(loaded[0]?.companyId || ""),
    direction: loaded[0]?.direction || "",
  };
  assert.equal(loaded.length, 1);
  assert.equal(stageTrace.storageAfterReload.canonicalFp, "fp:a1e58d49");
  assert.equal(stageTrace.storageAfterReload.accountFp, "fp:d19e5702");

  // Fresh Workbench mount / hydrate
  const snap = hydrateAccountMemoryForPipeline(COMPANY);
  stageTrace.hydratedMemory = {
    ready: snap.ready,
    activeCount: snap.activeCount,
    companyFp: fingerprintCariMemoryKey(snap.companyId || ""),
  };
  assert.equal(snap.ready, true);
  assert.equal(snap.activeCount, 1);

  const plan = [
    { code: "120", name: "Alıcılar", isLeaf: false },
    { code: "120.10", name: "Yurt içi", isLeaf: false },
    { code: ACCOUNT, name: "LEAF-GOOD", isLeaf: true },
    { code: "102.01.001", name: "Vakıfbank", isLeaf: true },
  ];
  const company = {
    id: COMPANY,
    bankAccounts: [{ bankName: "VAKIFBANK", lucaAccountCode: "102.01.001" }],
  };

  // Parser-only preview (fresh process Aşama 1)
  const parserMovements = [DESC_A, DESC_B].map((desc, i) =>
    buildParserOnlyMovement(
      {
        tarih: "2026-03-01",
        aciklama: desc,
        tutar: 1500 + i,
        yon: "GIRIS",
        banka: "VAKIFBANK",
        sourceRowId: `fresh-${i}`,
      },
      { selectedBank: "VAKIFBANK" },
      i
    )
  );
  assert.ok(parserMovements.every((m) => !m.counterAccountCode));

  for (const desc of [DESC_A, DESC_B]) {
    const ak = normalizeBankAnalysisKey(desc, "GIRIS");
    stageTrace.actualRowQuery.push({
      queryAnalysisFp: fingerprintCariMemoryKey(ak),
      queryCanonicalFp: fingerprintCariMemoryKey(
        buildCariMemoryCanonicalKey(desc, "GIRIS")
      ),
      direction: "GIRIS",
    });
    const lookup = traceAccountMemoryLookup(
      {
        companyId: COMPANY,
        analysisKey: ak,
        direction: "GIRIS",
        transactionType: "GELEN_HAVALE",
        normalizedDescription: desc,
      },
      snap.index,
      { allowAuto: true }
    );
    stageTrace.lookupResult.push(lookup);
    assert.equal(lookup.autoApply, true);
    assert.equal(lookup.rejectReason, "");
  }

  const analyzed = await runAccountingAnalysisOnMovementsAsync({
    movementRows: parserMovements,
    normalizedRows: [DESC_A, DESC_B].map((desc, i) => ({
      tarih: "2026-03-01",
      aciklama: desc,
      tutar: 1500 + i,
      yon: "GIRIS",
      banka: "VAKIFBANK",
      sourceRowId: `fresh-${i}`,
    })),
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

  stageTrace.afterMemoryApply = analyzed.movementRows.map((m) => ({
    counterAccountFp: fingerprintCariMemoryKey(m.counterAccountCode || ""),
    matchedMemoryId: Boolean(m.matchedMemoryId),
    autoApplied: Number(analyzed.callCounts?.firmMemoryAutoApplied || 0) > 0,
  }));
  assert.equal(analyzed.movementRows[0].counterAccountCode, ACCOUNT);
  assert.equal(analyzed.movementRows[1].counterAccountCode, ACCOUNT);
  assert.ok(analyzed.movementRows[0].matchedMemoryId);
  assert.ok(analyzed.movementRows[1].matchedMemoryId);

  const luca = analyzed.movementRows.flatMap((m, i) =>
    bankMovementToStandardLucaRows(m, `F${i}`, {
      firmaId: COMPANY,
      kaynakAdi: "VAKIFBANK",
      bankAccounts: company.bankAccounts,
    })
  );
  stageTrace.afterCariResolution = luca
    .filter((r) => String(r.hesapKodu || "").startsWith("120"))
    .map((r) => ({
      hesapFp: fingerprintCariMemoryKey(r.hesapKodu || ""),
      direction: r.direction || "",
      analysisFp: fingerprintCariMemoryKey(r.analysisKey || ""),
    }));

  const missing = analyzeMissingHesapRows(luca);
  assert.equal(Number(missing.uniqueUnresolvedMovements || 0), 0);
  assert.equal(Number(missing.uniqueMatchedMovements || 0), 2);

  const groups = buildCariResolutionGroups(luca, {
    selectedCompany: company,
    companyPlans: plan,
  });
  assert.equal(
    (groups.groups || []).filter((g) =>
      /BILET/i.test(`${g.partyName || ""} ${g.analysisKey || ""}`)
    ).length,
    0
  );

  stageTrace.finalRow = {
    unresolved: missing.uniqueUnresolvedMovements,
    matched: missing.uniqueMatchedMovements,
    counter958to960: 958 + 2,
    counter458to456: 458 - 2,
  };
  assert.equal(958 + 2, 960);
  assert.equal(458 - 2, 456);
  console.log("stageTrace", JSON.stringify(stageTrace, null, 2));
});

await test("luca alacak bacağı: borc/alacak yön tuzağı hafızayı kaçırmasın", () => {
  installMemoryStorage(
    JSON.stringify([
      {
        id: "amv2-dir-trap",
        companyId: COMPANY,
        bankName: "VAKIFBANK",
        analysisKey: LIVE_KEY,
        canonicalAnalysisKey: CANON,
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
        lastUsedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true,
        schemaVersion: 2,
      },
    ])
  );

  // Eski tuzak: direction yok, alacak > 0 → CIKIS sanılırdı
  const rows = [
    {
      id: "cari-leg",
      analysisKey: LIVE_KEY,
      detayAciklama: DESC_A,
      fisAciklama: DESC_A,
      transactionType: "GELEN_HAVALE",
      borc: 0,
      alacak: 1500,
      hesapKodu: "",
      direction: "GIRIS", // movement yönü (yeni luca satırları)
    },
  ];
  const applied = applyAccountMemoryV2RecordsToRows(
    rows,
    loadAccountMemoryV2Records(),
    { firmaId: COMPANY, kaynakAdi: "VAKIFBANK" }
  );
  assert.equal(applied[0].hesapKodu, ACCOUNT);

  // analysisKey direction fallback (direction alanı boş)
  const applied2 = applyAccountMemoryV2RecordsToRows(
    [{ ...rows[0], direction: "" }],
    loadAccountMemoryV2Records(),
    { firmaId: COMPANY, kaynakAdi: "VAKIFBANK" }
  );
  assert.equal(applied2[0].hesapKodu, ACCOUNT);

  // borc/alacak ile CIKIS çıkarımı artık yapılmamalı
  const before = resolveAccountMemoryV2Decision(
    {
      companyId: COMPANY,
      analysisKey: LIVE_KEY,
      direction: "CIKIS",
      transactionType: "GELEN_HAVALE",
      normalizedDescription: DESC_A,
    },
    hydrateAccountMemoryForPipeline(COMPANY).index,
    { allowAuto: true }
  );
  assert.equal(before.autoApply, false);
});

console.log("\nAll BİLET fresh reload pipeline tests passed.");
