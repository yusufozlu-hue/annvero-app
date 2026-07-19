/**
 * Workbench lifecycle: memoryReady gate + BİLET reload apply.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cari-memory-lifecycle-ready.mjs
 */
import assert from "node:assert/strict";
import { mapParsedRowToStandardMovement } from "@/src/utils/bankMovementMapper.js";
import {
  ACCOUNT_MEMORY_V2_STORAGE_KEY,
  buildCariMemoryCanonicalKey,
  fingerprintCariMemoryKey,
  hydrateAccountMemoryForPipeline,
  saveAccountMemoryV2Decision,
  traceAccountMemoryLookup,
} from "@/src/utils/accountMemoryV2.js";
import { normalizeBankAnalysisKey } from "@/src/utils/textNormalize.js";
import { buildCariResolutionGroups } from "@/src/utils/cariMissingResolutionGroups.js";
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

/**
 * Workbench’in memoryReady / process gate davranışının sade modeli.
 * Gerçek component state alanlarını taklit eder (stale closure yok).
 */
function createWorkbenchMemoryLifecycle(companyId) {
  const state = {
    accountMemoryReady: false,
    selectedCompanyId: companyId,
    isLoadingCompanies: false,
    snap: null,
    lastToast: "",
  };

  const refresh = () => {
    const snap = hydrateAccountMemoryForPipeline(state.selectedCompanyId || "");
    state.snap = snap;
    state.accountMemoryReady = Boolean(snap.ready);
    return snap;
  };

  return {
    state,
    /** fresh mount: not-ready until hydrate effect */
    mountNotReady() {
      state.accountMemoryReady = false;
      state.snap = { ready: false, records: [], index: null };
    },
    /** useEffect hydrate */
    runHydrateEffect() {
      return refresh();
    },
    ensureReadyForProcess() {
      if (state.isLoadingCompanies) {
        state.lastToast = "Firma yükleniyor; hafıza hazır olana kadar bekleyin.";
        return null;
      }
      if (!state.selectedCompanyId) {
        state.lastToast = "Önce firma seçmelisin.";
        return null;
      }
      const snap = refresh();
      if (!snap?.ready) {
        state.lastToast = "Hesap hafızası henüz hazır değil; işlem başlatılmadı.";
        return null;
      }
      return snap;
    },
    buildPipelineOptions() {
      const snap = hydrateAccountMemoryForPipeline(state.selectedCompanyId || "");
      state.snap = snap;
      return {
        accountMemoryRecords: snap.records,
        accountMemoryV2Index: snap.index,
        selectedCompanyId: state.selectedCompanyId,
      };
    },
  };
}

const COMPANY = "co-lifecycle";
const ACCOUNT = "120.10.B0001";
const DESC_A =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 1111111111";
const DESC_B =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 2222222222";

test("lifecycle: mount not-ready → hydrate → ready; early process blocked", () => {
  installMemoryStorage();
  const wb = createWorkbenchMemoryLifecycle(COMPANY);
  wb.mountNotReady();
  assert.equal(wb.state.accountMemoryReady, false);

  // Kullanıcı hydrate bitmeden işlem dener — companies loading gate
  delete globalThis.window;
  wb.mountNotReady();
  installMemoryStorage();
  wb.mountNotReady();
  assert.equal(wb.state.accountMemoryReady, false);
  wb.state.isLoadingCompanies = true;
  assert.equal(wb.ensureReadyForProcess(), null);
  assert.match(wb.state.lastToast, /Firma yükleniyor/);
  wb.state.isLoadingCompanies = false;

  wb.runHydrateEffect();
  assert.equal(wb.state.accountMemoryReady, true);
  assert.ok(wb.ensureReadyForProcess());
});

test("lifecycle: session learn → remount hydrate → BİLET matched, not in Kalanlar", () => {
  const store = installMemoryStorage();
  const wbA = createWorkbenchMemoryLifecycle(COMPANY);
  wbA.mountNotReady();
  wbA.runHydrateEffect();
  assert.equal(wbA.state.accountMemoryReady, true);

  const writeKey = normalizeBankAnalysisKey(DESC_A, "GIRIS");
  const writeCanon = buildCariMemoryCanonicalKey(DESC_A, "GIRIS");
  const saved = saveAccountMemoryV2Decision(
    {
      analysisKey: writeKey,
      canonicalAnalysisKey: writeCanon,
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      accountCode: ACCOUNT,
      hesapKodu: ACCOUNT,
      cariId: ACCOUNT,
      normalizedDescription: DESC_A,
      source: "cari-resolution-center",
    },
    { firmaId: COMPANY, kaynakAdi: "VAKIFBANK" }
  );
  assert.ok(saved);

  const persisted = store.get(ACCOUNT_MEMORY_V2_STORAGE_KEY);
  delete globalThis.window;

  // Fresh session B
  installMemoryStorage(persisted);
  const wbB = createWorkbenchMemoryLifecycle(COMPANY);
  wbB.mountNotReady();
  assert.equal(wbB.state.accountMemoryReady, false);
  wbB.runHydrateEffect();
  assert.equal(wbB.state.accountMemoryReady, true);

  const snap = wbB.ensureReadyForProcess();
  assert.ok(snap);
  const opts = wbB.buildPipelineOptions();

  const plan = [
    { code: "120", name: "Alıcılar", isLeaf: false },
    { code: "120.10", name: "Yurt içi", isLeaf: false },
    { code: ACCOUNT, name: "BILET", isLeaf: true },
    { code: "102.01.001", name: "Vakıfbank", isLeaf: true },
  ];
  const company = {
    id: COMPANY,
    bankAccounts: [{ bankName: "VAKIFBANK", lucaAccountCode: "102.01.001" }],
  };

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
        accountMemoryRecords: opts.accountMemoryRecords,
        accountMemoryV2Index: opts.accountMemoryV2Index,
        learningMemory: [],
        companyRules: {},
        accountingRules: [],
      }
    )
  );

  assert.equal(movements[0].counterAccountCode, ACCOUNT);
  assert.equal(movements[1].counterAccountCode, ACCOUNT);
  assert.equal(
    movements.filter((m) => m.counterAccountCode === ACCOUNT).length,
    2,
    "matched +2"
  );

  const lucaRows = movements.flatMap((m, i) =>
    bankMovementToStandardLucaRows(m, `F${i}`, {
      firmaId: COMPANY,
      kaynakAdi: "VAKIFBANK",
      bankAccounts: company.bankAccounts,
    })
  );
  const missing = analyzeMissingHesapRows(lucaRows);
  const unresolvedForBilet = (lucaRows || []).filter((row) => {
    const text = `${row.detayAciklama || ""} ${row.fisAciklama || ""} ${row.analysisKey || ""}`;
    return /BILETDUK|BILET/i.test(text) && !String(row.hesapKodu || "").trim();
  });
  assert.equal(unresolvedForBilet.length, 0, "BİLET Kalanlar’da olmamalı");
  assert.ok(Number(missing.uniqueUnresolvedMovements || 0) === 0);

  const built = buildCariResolutionGroups(lucaRows, {
    selectedCompany: company,
    companyPlans: plan,
  });
  const groupList = Array.isArray(built) ? built : built.groups || [];
  const biletdukRemaining = groupList.filter((g) =>
    /BILET/i.test(String(g.partyName || g.analysisKey || ""))
  );
  assert.equal(biletdukRemaining.length, 0, "BİLET resolution group yok");

  const trace = traceAccountMemoryLookup(
    {
      companyId: COMPANY,
      analysisKey: normalizeBankAnalysisKey(DESC_B, "GIRIS"),
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      normalizedDescription: DESC_B,
    },
    opts.accountMemoryV2Index,
    { allowAuto: true }
  );
  assert.equal(trace.mode, "auto");
  assert.equal(trace.rejectReason, "");
  assert.equal(
    trace.queryCanonicalFp,
    fingerprintCariMemoryKey(buildCariMemoryCanonicalKey(DESC_B, "GIRIS"))
  );
  assert.equal(trace.storedCanonicalFp, fingerprintCariMemoryKey(writeCanon));
  console.log("trace", trace);
});

test("lifecycle: process blocked while companies loading (empty memory not used)", () => {
  installMemoryStorage();
  const wb = createWorkbenchMemoryLifecycle(COMPANY);
  wb.mountNotReady();
  wb.state.isLoadingCompanies = true;
  assert.equal(wb.ensureReadyForProcess(), null);
  assert.equal(wb.state.accountMemoryReady, false);
});

console.log("\nAll cari memory lifecycle ready tests passed.");
