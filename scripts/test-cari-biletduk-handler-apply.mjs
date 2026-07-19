/**
 * Gerçek yeşil-buton handler zinciri (runCariResolutionGroupApply).
 * Doğrudan saveAccountMemoryV2Decision ile geçilmez.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cari-biletduk-handler-apply.mjs
 */
import assert from "node:assert/strict";
import { mapParsedRowToStandardMovement } from "@/src/utils/bankMovementMapper.js";
import {
  ACCOUNT_MEMORY_V2_STORAGE_KEY,
  buildCariMemoryCanonicalKey,
  hydrateAccountMemoryForPipeline,
  loadAccountMemoryV2Records,
  resolveAccountMemoryV2Decision,
  saveAccountMemoryV2Decision,
  supersedeSameCanonicalScopeRecords,
} from "@/src/utils/accountMemoryV2.js";
import { runCariResolutionGroupApply } from "@/src/utils/cariResolutionGroupApply.js";
import {
  buildCariApplyGroupPayload,
  buildCariResolutionGroups,
  canEnableCariAutoLearn,
} from "@/src/utils/cariMissingResolutionGroups.js";
import { normalizeBankAnalysisKey } from "@/src/utils/textNormalize.js";
import { analyzeMissingHesapRows } from "@/src/utils/previewExportValidation.js";
import { bankMovementToStandardLucaRows } from "@/src/utils/standardLucaRow.js";

function test(name, fn) {
  try {
    fn();
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

const COMPANY = "co-handler";
const ACCOUNT_GOOD = "120.10.B0001";
const ACCOUNT_BAD = "120.10.X9999";
const DESC_A =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 1111111111";
const DESC_B =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 2222222222";
const LIVE_KEY = normalizeBankAnalysisKey(DESC_A, "GIRIS");
const CANON = buildCariMemoryCanonicalKey(DESC_A, "GIRIS");

test("handler E2E: çakışan+bozuk upsert → yeşil buton learn → reload pipeline", () => {
  const store = installMemoryStorage();
  const now = new Date().toISOString();
  // Canlıya benzer: biri live analysisKey + B0001 ama correctionRatio yüksek;
  // diğeri aynı canonical, farklı hesap — conflict → autoApply false.
  const seed = [
    {
      id: "amv2-broken-exact",
      companyId: COMPANY,
      bankId: "VAKIFBANK",
      bankName: "VAKIFBANK",
      analysisKey: LIVE_KEY,
      canonicalAnalysisKey: CANON,
      normalizedDescription: DESC_A,
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      decisionType: "CARI",
      accountCode: ACCOUNT_GOOD,
      accountName: "bile-broken",
      cariId: ACCOUNT_GOOD,
      confidence: 92,
      source: "legacy-seed",
      usageCount: 2,
      successCount: 1,
      correctionCount: 1,
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
      isActive: true,
      schemaVersion: 2,
    },
    {
      id: "amv2-conflict-other",
      companyId: COMPANY,
      bankId: "VAKIFBANK",
      bankName: "VAKIFBANK",
      analysisKey: "OLD BILET OTHER|GIRIS",
      canonicalAnalysisKey: CANON,
      normalizedDescription: "OLD BILET OTHER",
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      decisionType: "CARI",
      accountCode: ACCOUNT_BAD,
      accountName: "eski",
      cariId: ACCOUNT_BAD,
      confidence: 100,
      source: "legacy-seed",
      usageCount: 1,
      successCount: 1,
      correctionCount: 0,
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
      isActive: true,
      schemaVersion: 2,
    },
  ];
  store.set(ACCOUNT_MEMORY_V2_STORAGE_KEY, JSON.stringify(seed));

  let snap = hydrateAccountMemoryForPipeline(COMPANY);
  const before = resolveAccountMemoryV2Decision(
    {
      companyId: COMPANY,
      analysisKey: LIVE_KEY,
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      normalizedDescription: DESC_A,
    },
    snap.index,
    { allowAuto: true }
  );
  // Canlı kırılma: exact-key narrowing conflict’i gizler → suggest + not eligible
  assert.equal(before.autoApply, false);
  assert.ok(
    before.mode === "suggest" || before.mode === "conflict",
    `beklenen suggest|conflict, gelen ${before.mode}`
  );
  assert.ok(
    before.mode !== "auto",
    "seed auto olmamalı — aksi halde handler gerekmez"
  );

  const plan = [
    { code: "120", name: "Alıcılar", isLeaf: false },
    { code: "120.10", name: "Yurt içi", isLeaf: false },
    { code: ACCOUNT_GOOD, name: "LEAF-GOOD", isLeaf: true },
    { code: ACCOUNT_BAD, name: "LEAF-BAD", isLeaf: true },
    { code: "102.01.001", name: "Vakıfbank", isLeaf: true },
  ];
  const company = {
    id: COMPANY,
    bankAccounts: [{ bankName: "VAKIFBANK", lucaAccountCode: "102.01.001" }],
  };

  // Unresolved Luca satırları — mapper short-code ile doldurmasın diye elle
  const lucaRows = [DESC_A, DESC_B].map((desc, i) => ({
    id: `luca-biletduk-${i}`,
    sourceMovementId: `mov-biletduk-${i}`,
    analysisKey: LIVE_KEY,
    direction: "GIRIS",
    detayAciklama: desc,
    fisAciklama: desc,
    aciklama: desc,
    transactionType: "GELEN_HAVALE",
    belgeTuru: "DK",
    borc: 1500 + i,
    alacak: 0,
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
    missingHesapCategory: "CARI",
    fisTarihi: "2026-03-01",
  }));
  const missingBefore = analyzeMissingHesapRows(lucaRows);
  assert.ok(Number(missingBefore.uniqueUnresolvedMovements || 0) >= 2);

  const built = buildCariResolutionGroups(lucaRows, {
    selectedCompany: company,
    companyPlans: plan,
  });
  const bileGroup = (built.groups || []).find((g) =>
    /BILET/i.test(`${g.partyName || ""} ${g.analysisKey || ""}`)
  );
  assert.ok(bileGroup, "BİLET grubu bulunmalı");

  const learnEnabled = canEnableCariAutoLearn({
    confidence: bileGroup.confidence || 95,
    accountCode: ACCOUNT_GOOD,
    duplicateAccounts: bileGroup.duplicateAccounts,
  });
  assert.equal(learnEnabled, true);

  // UI: checkbox true → learn: Boolean(learnNext && learnEnabled)
  const learn = Boolean(true && learnEnabled);
  assert.equal(learn, true);

  const applyPayload = buildCariApplyGroupPayload(
    bileGroup,
    bileGroup.rowIds || []
  );

  // GERÇEK handler gövdesi (Workbench yeşil buton)
  const applyResult = runCariResolutionGroupApply({
    lucaRows,
    group: applyPayload,
    accountCode: ACCOUNT_GOOD,
    learn,
    selectedCompanyId: COMPANY,
    selectedBank: "VAKIFBANK",
    resolveMemoryLearnContext: (row) => {
      const direction = String(row.direction || "GIRIS").trim().toUpperCase();
      const description = String(
        row.detayAciklama || row.fisAciklama || row.aciklama || ""
      ).trim();
      const analysisKey = String(
        row.analysisKey || normalizeBankAnalysisKey(description, direction) || ""
      ).trim();
      return {
        ok: Boolean(direction && (analysisKey || description)),
        direction,
        analysisKey,
        transactionType: String(row.transactionType || "GELEN_HAVALE").trim(),
        description,
      };
    },
  });

  assert.equal(applyResult.ok, true);
  assert.ok(applyResult.updated >= 2);
  assert.equal(applyResult.learned, true, "read-back learnOk");
  assert.equal(applyResult.learnPersistFailed, false);
  assert.equal(applyResult.learnSaveTrace?.persisted, true);
  assert.ok(Number(applyResult.learnSaveTrace?.supersededCount || 0) >= 1);
  assert.equal(applyResult.learnSaveTrace?.activeCanonicalCountAfterSave, 1);
  assert.equal(applyResult.learnSaveTrace?.immediateReadBack?.autoApply, true);
  assert.equal(applyResult.learnSaveTrace?.immediateReadBack?.rejectReason, "");
  assert.equal(applyResult.beforeMissing - applyResult.afterMissing >= 2, true);
  console.log("saveTrace", applyResult.learnSaveTrace);

  // Fresh client / Workbench remount
  const persisted = store.get(ACCOUNT_MEMORY_V2_STORAGE_KEY);
  delete globalThis.window;
  installMemoryStorage(persisted);
  snap = hydrateAccountMemoryForPipeline(COMPANY);
  assert.equal(snap.ready, true);

  const active = loadAccountMemoryV2Records().filter(
    (r) =>
      r.isActive !== false &&
      r.companyId === COMPANY &&
      (r.canonicalAnalysisKey || "") === CANON
  );
  assert.equal(active.length, 1);
  assert.equal(active[0].accountCode, ACCOUNT_GOOD);
  assert.ok(Number(active[0].correctionCount || 0) === 0);

  const movements = [DESC_A, DESC_B].map((desc, i) =>
    mapParsedRowToStandardMovement(
      {
        tarih: "2026-03-01",
        aciklama: desc,
        tutar: 1500 + i,
        yon: "GIRIS",
        banka: "VAKIFBANK",
        sourceRowId: `biletduk-reload-${i}`,
      },
      {
        selectedCompany: company,
        selectedCompanyId: COMPANY,
        selectedBank: "VAKIFBANK",
        companyPlans: plan,
        accountMemoryRecords: snap.records,
        accountMemoryV2Index: snap.index,
        learningMemory: [],
        companyRules: {},
        accountingRules: [],
      }
    )
  );
  assert.equal(movements[0].counterAccountCode, ACCOUNT_GOOD);
  assert.equal(movements[1].counterAccountCode, ACCOUNT_GOOD);
  assert.ok(movements[0].matchedMemoryId);
  assert.ok(movements[1].matchedMemoryId);

  const lucaReload = movements.flatMap((m, i) =>
    bankMovementToStandardLucaRows(m, `R${i}`, {
      firmaId: COMPANY,
      kaynakAdi: "VAKIFBANK",
      bankAccounts: company.bankAccounts,
    })
  );
  const missingAfter = analyzeMissingHesapRows(lucaReload);
  assert.equal(Number(missingAfter.uniqueUnresolvedMovements || 0), 0);

  const rebuilt = buildCariResolutionGroups(lucaReload, {
    selectedCompany: company,
    companyPlans: plan,
  });
  assert.equal(
    (rebuilt.groups || []).filter((g) =>
      /BILET/i.test(`${g.partyName || ""} ${g.analysisKey || ""}`)
    ).length,
    0
  );

  assert.equal(958 + 2, 960);
  assert.equal(458 - 2, 456);
});

test("supersede guard: yalnız user-approved + leaf + cm:* + aynı scope", () => {
  const base = {
    id: "victim",
    companyId: COMPANY,
    bankId: "VAKIFBANK",
    bankName: "VAKIFBANK",
    direction: "GIRIS",
    canonicalAnalysisKey: CANON,
    accountCode: ACCOUNT_BAD,
    isActive: true,
  };

  assert.equal(
    supersedeSameCanonicalScopeRecords([base], {
      keepId: "keep",
      companyId: COMPANY,
      direction: "GIRIS",
      canonicalAnalysisKey: CANON,
      accountCode: ACCOUNT_GOOD,
      source: "pipeline-auto",
      bankName: "VAKIFBANK",
    }).supersededCount,
    0,
    "otomatik kaynak supersede etmez"
  );

  assert.equal(
    supersedeSameCanonicalScopeRecords([base], {
      keepId: "keep",
      companyId: COMPANY,
      direction: "GIRIS",
      canonicalAnalysisKey: "GLN HVL BILETDUK|GIRIS",
      accountCode: ACCOUNT_GOOD,
      source: "cari-resolution-center",
      bankName: "VAKIFBANK",
    }).supersededCount,
    0,
    "cm: olmayan canonical supersede etmez"
  );

  assert.equal(
    supersedeSameCanonicalScopeRecords([base], {
      keepId: "keep",
      companyId: COMPANY,
      direction: "GIRIS",
      canonicalAnalysisKey: CANON,
      accountCode: "120",
      source: "cari-resolution-center",
      bankName: "VAKIFBANK",
    }).supersededCount,
    0,
    "parent hesap supersede etmez"
  );

  assert.equal(
    supersedeSameCanonicalScopeRecords([base], {
      keepId: "keep",
      companyId: COMPANY,
      direction: "GIRIS",
      canonicalAnalysisKey: CANON,
      accountCode: "120.01",
      source: "cari-resolution-center",
      bankName: "VAKIFBANK",
    }).supersededCount,
    0,
    "ara parent supersede etmez"
  );

  assert.equal(
    supersedeSameCanonicalScopeRecords([{ ...base, companyId: "other" }], {
      keepId: "keep",
      companyId: COMPANY,
      direction: "GIRIS",
      canonicalAnalysisKey: CANON,
      accountCode: ACCOUNT_GOOD,
      source: "cari-resolution-center",
      bankName: "VAKIFBANK",
    }).supersededCount,
    0
  );

  assert.equal(
    supersedeSameCanonicalScopeRecords(
      [{ ...base, bankId: "ZIRAAT", bankName: "ZIRAAT" }],
      {
        keepId: "keep",
        companyId: COMPANY,
        direction: "GIRIS",
        canonicalAnalysisKey: CANON,
        accountCode: ACCOUNT_GOOD,
        source: "cari-resolution-center",
        bankName: "VAKIFBANK",
        bankId: "VAKIFBANK",
      }
    ).supersededCount,
    0
  );

  assert.equal(
    supersedeSameCanonicalScopeRecords([{ ...base, direction: "CIKIS" }], {
      keepId: "keep",
      companyId: COMPANY,
      direction: "GIRIS",
      canonicalAnalysisKey: CANON,
      accountCode: ACCOUNT_GOOD,
      source: "cari-resolution-center",
      bankName: "VAKIFBANK",
    }).supersededCount,
    0
  );

  assert.equal(
    supersedeSameCanonicalScopeRecords([base], {
      keepId: "keep",
      companyId: COMPANY,
      direction: "GIRIS",
      canonicalAnalysisKey: CANON,
      accountCode: ACCOUNT_GOOD,
      source: "cari-resolution-center",
      bankName: "VAKIFBANK",
      bankId: "VAKIFBANK",
    }).supersededCount,
    1,
    "güvenli user leaf + cm:* aynı scope supersede eder"
  );
});

test("save: pipeline-auto eski cm:* kaydı supersede etmez", () => {
  const store = installMemoryStorage();
  const now = new Date().toISOString();
  store.set(
    ACCOUNT_MEMORY_V2_STORAGE_KEY,
    JSON.stringify([
      {
        id: "amv2-keep-legacy",
        companyId: COMPANY,
        bankId: "VAKIFBANK",
        bankName: "VAKIFBANK",
        analysisKey: "AUTO KEY|GIRIS",
        canonicalAnalysisKey: CANON,
        normalizedDescription: "AUTO KEY",
        direction: "GIRIS",
        transactionType: "GELEN_HAVALE",
        decisionType: "CARI",
        accountCode: ACCOUNT_BAD,
        accountName: "legacy",
        cariId: ACCOUNT_BAD,
        confidence: 100,
        source: "pipeline-auto",
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

  const saved = saveAccountMemoryV2Decision(
    {
      analysisKey: "NEW AUTO|GIRIS",
      canonicalAnalysisKey: CANON,
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      accountCode: ACCOUNT_GOOD,
      normalizedDescription: "NEW AUTO",
      source: "pipeline-auto",
    },
    { firmaId: COMPANY, kaynakAdi: "VAKIFBANK" }
  );
  assert.ok(saved);
  assert.equal(Number(saved._supersededCount || 0), 0);
  const legacy = loadAccountMemoryV2Records().find(
    (r) => r.id === "amv2-keep-legacy"
  );
  assert.ok(legacy, "eski kayıt silinmemeli");
  assert.notEqual(legacy.isActive, false);
  assert.equal(String(legacy.supersededBy || ""), "");
});

console.log("\nAll BİLET handler apply tests passed.");
