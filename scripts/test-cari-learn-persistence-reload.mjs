/**
 * Cari öğrenme kalıcılık — session A yaz → cache kapat → session B oku.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cari-learn-persistence-reload.mjs
 */
import assert from "node:assert/strict";
import { mapParsedRowToStandardMovement } from "@/src/utils/bankMovementMapper.js";
import {
  ACCOUNT_MEMORY_V2_STORAGE_KEY,
  buildAccountMemoryV2Index,
  buildCariMemoryCanonicalKey,
  fingerprintCariMemoryKey,
  loadAccountMemoryV2Records,
  resolveAccountMemoryV2Decision,
  saveAccountMemoryV2Decision,
} from "@/src/utils/accountMemoryV2.js";
import { normalizeBankAnalysisKey } from "@/src/utils/textNormalize.js";
import {
  canEnableCariAutoLearn,
  shouldDefaultCariAutoLearn,
} from "@/src/utils/cariMissingResolutionGroups.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function installMemoryStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        store.set(key, String(value));
      },
      removeItem: (key) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
  };
  return store;
}

function installFailingStorage() {
  globalThis.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
    },
  };
}

const COMPANY_ID = "co-persist-test";
const ACCOUNT = "120.10.B0001";
const LONG_DESC =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 1234567890";
const SHORT_PARTY = "TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK";
const SHORT_CODE = "BILETDUK";

test("checkbox güvenli öğrenme: yalnız yüksek güven leaf, varsayılan kapalı", () => {
  assert.equal(
    shouldDefaultCariAutoLearn({
      confidence: 95,
      accountCode: ACCOUNT,
      duplicateAccounts: false,
      partyName: SHORT_PARTY,
    }),
    false
  );
  assert.equal(
    canEnableCariAutoLearn({
      confidence: 95,
      accountCode: ACCOUNT,
      duplicateAccounts: false,
    }),
    true
  );
  assert.equal(
    canEnableCariAutoLearn({
      confidence: 70,
      accountCode: ACCOUNT,
      duplicateAccounts: false,
    }),
    false
  );
  assert.equal(
    canEnableCariAutoLearn({
      confidence: 95,
      accountCode: ACCOUNT,
      duplicateAccounts: true,
    }),
    false
  );
});

test("canonical key: uzun grup / kısa kod aynı fingerprint", () => {
  const longKey = buildCariMemoryCanonicalKey(LONG_DESC, "GIRIS");
  const partyKey = buildCariMemoryCanonicalKey(SHORT_PARTY, "GIRIS");
  const codeKey = buildCariMemoryCanonicalKey(SHORT_CODE, "GIRIS");
  assert.equal(longKey, "cm:BILETDUK|GIRIS");
  assert.equal(partyKey, longKey);
  assert.equal(codeKey, longKey);
  assert.equal(
    fingerprintCariMemoryKey(longKey),
    fingerprintCariMemoryKey(partyKey)
  );
  assert.notEqual(
    normalizeBankAnalysisKey(LONG_DESC, "GIRIS"),
    normalizeBankAnalysisKey(SHORT_PARTY, "GIRIS")
  );
});

test("session A learn → clear client → session B reload auto-match", () => {
  const store = installMemoryStorage();

  // --- Session A component-like state ---
  const sessionA = {
    selectedCompanyId: COMPANY_ID,
    learnNext: true,
    learnEnabled: canEnableCariAutoLearn({
      confidence: 95,
      accountCode: ACCOUNT,
      duplicateAccounts: false,
    }),
    selectedCode: ACCOUNT,
  };
  const shouldLearn = Boolean(sessionA.learnNext && sessionA.learnEnabled);
  assert.equal(shouldLearn, true);

  const writeAnalysisKey = normalizeBankAnalysisKey(LONG_DESC, "GIRIS");
  const writeCanonical = buildCariMemoryCanonicalKey(LONG_DESC, "GIRIS");
  const saved = saveAccountMemoryV2Decision(
    {
      analysisKey: writeAnalysisKey,
      canonicalAnalysisKey: writeCanonical,
      direction: "GIRIS",
      transactionType: "", // canlıda boş type yazılmış olabilir
      accountCode: ACCOUNT,
      hesapKodu: ACCOUNT,
      cariId: ACCOUNT,
      normalizedDescription: LONG_DESC,
      source: "cari-resolution-center",
    },
    { firmaId: COMPANY_ID, kaynakAdi: "VAKIFBANK" }
  );
  assert.ok(saved, "persistence write must succeed");
  assert.equal(saved.accountCode, ACCOUNT);
  assert.equal(saved.canonicalAnalysisKey, writeCanonical);
  assert.ok(store.get(ACCOUNT_MEMORY_V2_STORAGE_KEY));

  // --- Close all client state/cache ---
  const persistedRaw = store.get(ACCOUNT_MEMORY_V2_STORAGE_KEY);
  delete globalThis.window;
  assert.equal(globalThis.window, undefined);

  // --- Session B: fresh storage hydrate from persisted blob ---
  const storeB = installMemoryStorage();
  storeB.set(ACCOUNT_MEMORY_V2_STORAGE_KEY, persistedRaw);

  const reloaded = loadAccountMemoryV2Records();
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].accountCode, ACCOUNT);

  const readAnalysisKey = normalizeBankAnalysisKey(LONG_DESC, "GIRIS");
  const readCanonical = buildCariMemoryCanonicalKey(LONG_DESC, "GIRIS");
  assert.equal(
    fingerprintCariMemoryKey(writeCanonical),
    fingerprintCariMemoryKey(readCanonical)
  );

  const index = buildAccountMemoryV2Index(reloaded, COMPANY_ID);
  const decision = resolveAccountMemoryV2Decision(
    {
      companyId: COMPANY_ID,
      analysisKey: readAnalysisKey,
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      normalizedDescription: LONG_DESC,
    },
    index,
    { allowAuto: true }
  );
  assert.equal(decision.mode, "auto");
  assert.equal(decision.autoApply, true);
  assert.equal(decision.record?.accountCode, ACCOUNT);

  // Kısa parti adı ile yeniden işleme (grup başlığı senaryosu)
  const partyDecision = resolveAccountMemoryV2Decision(
    {
      companyId: COMPANY_ID,
      analysisKey: normalizeBankAnalysisKey(SHORT_PARTY, "GIRIS"),
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      normalizedDescription: SHORT_PARTY,
    },
    index,
    { allowAuto: true }
  );
  assert.equal(partyDecision.mode, "auto");
  assert.equal(partyDecision.record?.accountCode, ACCOUNT);

  // Mapper uçtan uca: iki hareket
  const plan = [
    { code: "120", name: "Alıcılar", isLeaf: false },
    { code: "120.10", name: "Yurt içi", isLeaf: false },
    { code: ACCOUNT, name: "BILET", isLeaf: true },
    { code: "102.01", name: "Vakıfbank", isLeaf: true },
  ];
  const company = {
    id: COMPANY_ID,
    bankAccounts: [{ bankName: "VAKIFBANK", lucaAccountCode: "102.01" }],
  };

  for (const amount of [1500, 2200]) {
    const movement = mapParsedRowToStandardMovement(
      {
        tarih: "2026-03-01",
        aciklama: LONG_DESC,
        tutar: amount,
        yon: "GIRIS",
        banka: "VAKIFBANK",
        sourceRowId: `biletduk-${amount}`,
      },
      {
        selectedCompany: company,
        selectedCompanyId: COMPANY_ID,
        selectedBank: "VAKIFBANK",
        companyPlans: plan,
        accountMemoryRecords: reloaded,
        accountMemoryV2Index: index,
        learningMemory: [],
        companyRules: {},
        accountingRules: [],
      }
    );
    assert.equal(
      movement.counterAccountCode,
      ACCOUNT,
      `matched movement amount=${amount}`
    );
    assert.ok(
      String(movement.warning || "").includes("Firma hafızası") ||
        movement.matchedRule?.source === "firmaHafizaV2" ||
        movement.cariMatchReason,
      "memory or cari memory should apply"
    );
  }
});

test("write failure: save returns null (UI uyarısı için)", () => {
  installFailingStorage();
  const saved = saveAccountMemoryV2Decision(
    {
      analysisKey: normalizeBankAnalysisKey(LONG_DESC, "GIRIS"),
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      accountCode: ACCOUNT,
      hesapKodu: ACCOUNT,
      cariId: ACCOUNT,
      normalizedDescription: LONG_DESC,
      source: "cari-resolution-center",
    },
    { firmaId: COMPANY_ID, kaynakAdi: "VAKIFBANK" }
  );
  assert.equal(saved, null);
});

console.log("\nAll cari learn persistence reload tests passed.");
