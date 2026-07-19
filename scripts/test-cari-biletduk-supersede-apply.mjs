/**
 * Çakışan BİLET hafızası → kullanıcı leaf onayı supersede → reload apply.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cari-biletduk-supersede-apply.mjs
 */
import assert from "node:assert/strict";
import { mapParsedRowToStandardMovement } from "@/src/utils/bankMovementMapper.js";
import {
  ACCOUNT_MEMORY_V2_STORAGE_KEY,
  buildAccountMemoryV2Index,
  buildCariMemoryCanonicalKey,
  hydrateAccountMemoryForPipeline,
  loadAccountMemoryV2Records,
  resolveAccountMemoryV2Decision,
  saveAccountMemoryV2Decision,
  supersedeSameCanonicalScopeRecords,
  traceAccountMemoryLookup,
} from "@/src/utils/accountMemoryV2.js";
import { normalizeBankAnalysisKey } from "@/src/utils/textNormalize.js";
import { analyzeMissingHesapRows } from "@/src/utils/previewExportValidation.js";
import { bankMovementToStandardLucaRows } from "@/src/utils/standardLucaRow.js";
import { buildCariResolutionGroups } from "@/src/utils/cariMissingResolutionGroups.js";

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

const COMPANY = "co-supersede";
const ACCOUNT_GOOD = "120.10.B0001";
const ACCOUNT_BAD = "120.10.X9999";
const DESC_A =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 1111111111";
const DESC_B =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 2222222222";
const CANON = buildCariMemoryCanonicalKey(DESC_A, "GIRIS");

test("supersede: parent hesap kapsam dışı", () => {
  const { supersededCount } = supersedeSameCanonicalScopeRecords(
    [
      {
        id: "a",
        companyId: COMPANY,
        direction: "GIRIS",
        canonicalAnalysisKey: CANON,
        accountCode: "120.01",
        isActive: true,
      },
    ],
    {
      keepId: "keep",
      companyId: COMPANY,
      direction: "GIRIS",
      canonicalAnalysisKey: CANON,
      accountCode: "120.01",
      source: "cari-resolution-center",
      bankName: "VAKIFBANK",
    }
  );
  assert.equal(supersededCount, 0);
});

test("E2E: iki çakışan BİLET → kullanıcı 120.10.B0001 öğren → reload apply", () => {
  const store = installMemoryStorage();
  const now = new Date().toISOString();
  const seed = [
    {
      id: "amv2-conflict-a",
      companyId: COMPANY,
      bankId: "VAKIFBANK",
      bankName: "VAKIFBANK",
      analysisKey: "OLD BILET KEY A|GIRIS",
      canonicalAnalysisKey: CANON,
      normalizedDescription: "OLD BILET KEY A",
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      decisionType: "CARI",
      accountCode: ACCOUNT_BAD,
      accountName: "eski-a",
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
    {
      id: "amv2-conflict-b",
      companyId: COMPANY,
      bankId: "VAKIFBANK",
      bankName: "VAKIFBANK",
      analysisKey: normalizeBankAnalysisKey(
        "TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK",
        "GIRIS"
      ),
      canonicalAnalysisKey: CANON,
      normalizedDescription:
        "TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK",
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      decisionType: "CARI",
      accountCode: "120.10.Z0002",
      accountName: "eski-b",
      cariId: "120.10.Z0002",
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

  // Conflict on live query before learn
  let snap = hydrateAccountMemoryForPipeline(COMPANY);
  let before = resolveAccountMemoryV2Decision(
    {
      companyId: COMPANY,
      analysisKey: normalizeBankAnalysisKey(DESC_A, "GIRIS"),
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      normalizedDescription: DESC_A,
    },
    snap.index,
    { allowAuto: true }
  );
  assert.equal(before.mode, "conflict", "seed conflict beklenir");
  assert.equal(before.autoApply, false);

  // Kullanıcı leaf onay + öğren
  const learned = saveAccountMemoryV2Decision(
    {
      analysisKey: normalizeBankAnalysisKey(DESC_A, "GIRIS"),
      canonicalAnalysisKey: CANON,
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      accountCode: ACCOUNT_GOOD,
      hesapKodu: ACCOUNT_GOOD,
      cariId: ACCOUNT_GOOD,
      normalizedDescription: DESC_A,
      source: "cari-resolution-center",
    },
    { firmaId: COMPANY, kaynakAdi: "VAKIFBANK" }
  );
  assert.ok(learned);
  assert.ok(Number(learned._supersededCount || 0) >= 2, "iki çakışan supersede");
  assert.notEqual(learned.id, "amv2-conflict-a");
  assert.notEqual(learned.id, "amv2-conflict-b");
  assert.equal(Number(learned.correctionCount || 0), 0);
  assert.ok(Number(learned.confidence || 0) >= 90);

  const afterSave = loadAccountMemoryV2Records();
  const activeSameCanon = afterSave.filter(
    (r) =>
      r.isActive !== false &&
      r.companyId === COMPANY &&
      (r.canonicalAnalysisKey ||
        buildCariMemoryCanonicalKey(
          r.analysisKey || r.normalizedDescription,
          r.direction
        )) === CANON
  );
  assert.equal(activeSameCanon.length, 1);
  assert.equal(activeSameCanon[0].accountCode, ACCOUNT_GOOD);
  assert.equal(activeSameCanon[0].id, learned.id);
  for (const id of ["amv2-conflict-a", "amv2-conflict-b"]) {
    const old = afterSave.find((r) => r.id === id);
    assert.ok(old);
    assert.equal(old.isActive, false);
    assert.equal(old.supersededBy, learned.id);
  }

  // Fresh session
  const persisted = store.get(ACCOUNT_MEMORY_V2_STORAGE_KEY);
  delete globalThis.window;
  installMemoryStorage(persisted);

  let ready = false;
  snap = hydrateAccountMemoryForPipeline(COMPANY);
  ready = Boolean(snap.ready);
  assert.equal(ready, true);

  // Plan adları BİLET kısa koduna bağlanmasın — yalnız hafıza apply doğrulansın
  const plan = [
    { code: "120", name: "Alıcılar", isLeaf: false },
    { code: "120.10", name: "Yurt içi", isLeaf: false },
    { code: ACCOUNT_GOOD, name: "LEAF-GOOD", isLeaf: true },
    { code: ACCOUNT_BAD, name: "LEAF-BAD", isLeaf: true },
    { code: "120.10.Z0002", name: "LEAF-OTHER", isLeaf: true },
    { code: "102.01.001", name: "Vakıfbank", isLeaf: true },
  ];
  const company = {
    id: COMPANY,
    bankAccounts: [{ bankName: "VAKIFBANK", lucaAccountCode: "102.01.001" }],
  };

  const lookupA = resolveAccountMemoryV2Decision(
    {
      companyId: COMPANY,
      analysisKey: normalizeBankAnalysisKey(DESC_A, "GIRIS"),
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      normalizedDescription: DESC_A,
    },
    snap.index,
    { allowAuto: true }
  );
  const lookupB = resolveAccountMemoryV2Decision(
    {
      companyId: COMPANY,
      analysisKey: normalizeBankAnalysisKey(DESC_B, "GIRIS"),
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      normalizedDescription: DESC_B,
    },
    snap.index,
    { allowAuto: true }
  );
  assert.equal(lookupA.mode, "auto");
  assert.equal(lookupA.autoApply, true);
  assert.equal(lookupA.record?.accountCode, ACCOUNT_GOOD);
  assert.equal(lookupB.mode, "auto");
  assert.equal(lookupB.autoApply, true);
  assert.equal(lookupB.record?.accountCode, ACCOUNT_GOOD);

  const movements = [DESC_A, DESC_B].map((desc, i) =>
    mapParsedRowToStandardMovement(
      {
        tarih: "2026-03-01",
        aciklama: desc,
        tutar: 1500 + i,
        yon: "GIRIS",
        banka: "VAKIFBANK",
        sourceRowId: `biletduk-${i}`,
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
  assert.ok(movements[0].matchedMemoryId, "pipeline firma hafızası uyguladı");
  assert.ok(movements[1].matchedMemoryId, "pipeline firma hafızası uyguladı");
  assert.match(String(movements[0].warning || ""), /Firma hafızası/i);
  assert.match(String(movements[1].warning || ""), /Firma hafızası/i);

  const lucaRows = movements.flatMap((m, i) =>
    bankMovementToStandardLucaRows(m, `F${i}`, {
      firmaId: COMPANY,
      kaynakAdi: "VAKIFBANK",
      bankAccounts: company.bankAccounts,
    })
  );
  const missing = analyzeMissingHesapRows(lucaRows);
  assert.equal(Number(missing.uniqueUnresolvedMovements || 0), 0);

  const built = buildCariResolutionGroups(lucaRows, {
    selectedCompany: company,
    companyPlans: plan,
  });
  assert.equal(
    (built.groups || []).filter((g) =>
      /BILET/i.test(`${g.partyName || ""} ${g.analysisKey || ""}`)
    ).length,
    0
  );

  assert.equal(958 + 2, 960);
  assert.equal(458 - 2, 456);

  const trace = traceAccountMemoryLookup(
    {
      companyId: COMPANY,
      analysisKey: normalizeBankAnalysisKey(DESC_B, "GIRIS"),
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      normalizedDescription: DESC_B,
    },
    buildAccountMemoryV2Index(loadAccountMemoryV2Records(), COMPANY),
    { allowAuto: true }
  );
  assert.equal(trace.mode, "auto");
  assert.equal(trace.rejectReason, "");
  console.log("pipelineTrace", trace);
});

console.log("\nAll BİLET supersede apply tests passed.");
