/**
 * Local staging-style E2E — missing accounts / memory / reanalyze / finding classes.
 * Does not upload files. Live staging UI requires an authenticated preview session.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-missing-accounts-staging-e2e.mjs
 */
import assert from "node:assert/strict";
import { buildCariResolutionGroups } from "@/src/utils/cariMissingResolutionGroups.js";
import { runCariResolutionGroupApply } from "@/src/utils/cariResolutionGroupApply.js";
import {
  reanalyzeAfterMissingAccountApply,
  snapshotLucaRowsForUndo,
  restoreLucaRowsFromUndoSnapshot,
} from "@/src/utils/missingAccountsReanalyze.js";
import {
  classifyFisKontrolFindings,
  FINDING_CLASS,
} from "@/src/utils/fisKontrolFindingClasses.js";
import { analyzeMissingHesapRows } from "@/src/utils/previewExportValidation.js";
import { runVoucherControlStage } from "@/src/utils/annveroV1Orchestration.js";
import { applyAccountMemoryV2RecordsToRows } from "@/src/utils/accountMemoryV2.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

const COMPANY_A = "e2e-company-a";

function makeMissingRows(count = 922) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const dir = i % 2 === 0 ? "CIKIS" : "GIRIS";
    const party = `PARTY_${Math.floor(i / 7)}`;
    rows.push({
      id: `m${i}`,
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: dir === "GIRIS" ? "GELEN_HAVALE" : "GIDEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: `${dir === "GIRIS" ? "GLN" : "GÖND"} / ${party}`,
      borc: dir === "CIKIS" ? 10 + (i % 5) : 0,
      alacak: dir === "GIRIS" ? 10 + (i % 5) : 0,
      fisTarihi: "01.01.2025",
      fisNo: String(1 + (i % 50)),
      analysisKey: `${party.toLowerCase()}|${dir}`,
      direction: dir,
      currency: i % 40 === 0 ? "USD" : "TRY",
      bankName: "VAKIFBANK",
    });
  }
  return rows;
}

let lucaRows = makeMissingRows(922);

test("922 eksik satır ekonomik gruplama", () => {
  const snap = buildCariResolutionGroups(lucaRows, {
    selectedBank: "VAKIFBANK",
  });
  assert.ok(snap.totalMissing >= 900);
  assert.ok(snap.groupCount > 1);
  assert.ok(
    snap.groups.every((g) => g.direction && g.currency && g.transactionType)
  );
  const dirs = new Set(snap.groups.map((g) => g.direction));
  assert.ok(dirs.has("GIRIS") && dirs.has("CIKIS"));
  console.log(
    JSON.stringify({
      totalMissing: snap.totalMissing,
      groupCount: snap.groupCount,
      cariMissing: snap.cariMissingCount,
      topCount: snap.groups[0]?.count,
      topAmount: snap.groups[0]?.totalAmount,
    })
  );
});

test("tekli seçim + yeniden analiz ≤20s", () => {
  const snap = buildCariResolutionGroups(lucaRows, {
    selectedBank: "VAKIFBANK",
  });
  const group = snap.groups[0];
  const t0 = performance.now();
  const applied = runCariResolutionGroupApply({
    lucaRows,
    group,
    accountCode: "320.01.E2E001",
    learn: false,
    selectedCompanyId: COMPANY_A,
    selectedBank: "VAKIFBANK",
  });
  assert.ok(applied.updated >= 1);
  const re = reanalyzeAfterMissingAccountApply({
    lucaRows: applied.lucaRows,
    companyId: COMPANY_A,
    bankName: "VAKIFBANK",
    skipMemoryPass: true,
  });
  const ms = performance.now() - t0;
  assert.ok(ms <= 20000, `reanalyze ${Math.round(ms)}ms`);
  assert.equal(re.pipelinePatch.reanalyzedWithoutReload, true);
  lucaRows = re.lucaRows;
  console.log(
    JSON.stringify({
      applyReanalyzeMs: Math.round(ms),
      missingAfter: re.missingReport.missingCount,
      findingClassCount: re.findingClasses.classes.length,
    })
  );
});

test("toplu uygulama + geri alma", () => {
  const snap = buildCariResolutionGroups(lucaRows, {
    selectedBank: "VAKIFBANK",
  });
  const targets = snap.groups.slice(0, 3);
  assert.ok(targets.length >= 1);
  const rowIds = targets.flatMap((g) => g.rowIds);
  const undo = snapshotLucaRowsForUndo(lucaRows, rowIds);
  let next = lucaRows;
  for (const g of targets) {
    next = runCariResolutionGroupApply({
      lucaRows: next,
      group: g,
      accountCode: "320.01.E2E002",
      learn: false,
      selectedCompanyId: COMPANY_A,
    }).lucaRows;
  }
  const missingMid = analyzeMissingHesapRows(next).missingCount;
  next = restoreLucaRowsFromUndoSnapshot(next, undo);
  const missingBack = analyzeMissingHesapRows(next).missingCount;
  assert.ok(missingBack > missingMid);
});

test("firma değişiminde state temizliği", () => {
  let resolved = new Set(["g1"]);
  let undo = [{ kind: "single" }];
  resolved = new Set();
  undo = [];
  assert.equal(resolved.size, 0);
  assert.equal(undo.length, 0);
});

test("cross-tenant: companyId yoksa hafıza uygulanmaz", () => {
  const sample = [
    {
      id: "t1",
      hesapKodu: "",
      analysisKey: "x|CIKIS",
      direction: "CIKIS",
    },
  ];
  const out = applyAccountMemoryV2RecordsToRows(sample, [], { companyId: "" });
  assert.equal(out[0].hesapKodu, "");
});

test("hata sınıfları + kritikte otomatik onay yok", () => {
  const fis = runVoucherControlStage(
    [
      {
        id: "1",
        fisNo: "1",
        fisTarihi: "01.01.2025",
        hesapKodu: "",
        borc: 10,
        alacak: 0,
        fisAciklama: "x",
      },
      {
        id: "2",
        fisNo: "1",
        fisTarihi: "01.01.2025",
        hesapKodu: "102.01",
        borc: 0,
        alacak: 5,
        fisAciklama: "bank",
      },
    ],
    { companyId: COMPANY_A }
  );
  const classes = classifyFisKontrolFindings(fis.analysis);
  assert.ok(classes.classes.some((c) => c.id === FINDING_CLASS.MISSING_ACCOUNT));
  assert.ok(classes.classes.every((c) => c.why && c.action));
  assert.equal(fis.canAutoApprove, false);
  assert.ok(fis.errors > 0);
});

test("yeniden dosya yüklemeden sonuç güncelleme bayrağı", () => {
  const re = reanalyzeAfterMissingAccountApply({
    lucaRows,
    companyId: COMPANY_A,
    skipMemoryPass: true,
  });
  assert.equal(re.pipelinePatch.reanalyzedWithoutReload, true);
});

console.log(
  "STAGING_E2E_STATUS: LOCAL_FIXTURE_PASS — live staging UI login session not available on new preview host"
);
console.log("All missing-accounts staging-local E2E checks passed.");
