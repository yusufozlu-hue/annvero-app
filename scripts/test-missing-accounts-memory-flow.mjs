/**
 * Eksik hesap gruplama / hata sınıfları / yeniden analiz
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-missing-accounts-memory-flow.mjs
 */
import assert from "node:assert/strict";
import {
  buildCariResolutionGroups,
  buildCariResolutionEconomicGroupKey,
  shouldDefaultCariAutoLearn,
  canEnableCariAutoLearn,
} from "@/src/utils/cariMissingResolutionGroups.js";
import {
  classifyFisKontrolFindings,
  FINDING_CLASS,
  mapKontrolTipToFindingClass,
} from "@/src/utils/fisKontrolFindingClasses.js";
import { KONTROL_TIP, KONTROL_SEVIYE, analyzeStandardLucaRows } from "@/src/utils/fisKontrolMerkezi.js";
import {
  reanalyzeAfterMissingAccountApply,
  snapshotLucaRowsForUndo,
  restoreLucaRowsFromUndoSnapshot,
} from "@/src/utils/missingAccountsReanalyze.js";
import { runCariResolutionGroupApply } from "@/src/utils/cariResolutionGroupApply.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function row(partial = {}) {
  return {
    id: partial.id || `r-${Math.random().toString(36).slice(2, 8)}`,
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
    transactionType: "GIDEN_HAVALE",
    cariRequired: true,
    missingHesapCategory: "Cari bulunamadı",
    detayAciklama: "GÖND. HVL / ACME OTEL",
    borc: 100,
    alacak: 0,
    fisTarihi: "2025-01-01",
    fisNo: "1",
    analysisKey: "acme|CIKIS",
    direction: "CIKIS",
    currency: "TRY",
    bankName: "VAKIFBANK",
    ...partial,
  };
}

test("economic key separates opposite direction and tx type", () => {
  const a = row({
    id: "1",
    direction: "GIRIS",
    transactionType: "GELEN_HAVALE",
    analysisKey: "acme|GIRIS",
    borc: 0,
    alacak: 50,
  });
  const b = row({
    id: "2",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    analysisKey: "acme|CIKIS",
  });
  const c = row({
    id: "3",
    direction: "CIKIS",
    transactionType: "EFT",
    analysisKey: "acme|CIKIS",
  });
  const ka = buildCariResolutionEconomicGroupKey(a, { selectedBank: "VAKIFBANK" });
  const kb = buildCariResolutionEconomicGroupKey(b, { selectedBank: "VAKIFBANK" });
  const kc = buildCariResolutionEconomicGroupKey(c, { selectedBank: "VAKIFBANK" });
  assert.notEqual(ka, kb);
  assert.notEqual(kb, kc);
});

test("grouping keeps opposite direction separate; shows counts", () => {
  const rows = [
    row({
      id: "in1",
      direction: "GIRIS",
      transactionType: "GELEN_HAVALE",
      analysisKey: "acme|GIRIS",
      borc: 0,
      alacak: 100,
      detayAciklama: "GLN / ACME",
    }),
    row({
      id: "out1",
      direction: "CIKIS",
      transactionType: "GIDEN_HAVALE",
      analysisKey: "acme|CIKIS",
      detayAciklama: "GÖND / ACME",
    }),
    row({
      id: "out2",
      direction: "CIKIS",
      transactionType: "GIDEN_HAVALE",
      analysisKey: "acme|CIKIS",
      detayAciklama: "GÖND / ACME",
      borc: 200,
    }),
  ];
  const snap = buildCariResolutionGroups(rows, { selectedBank: "VAKIFBANK" });
  assert.ok(snap.groupCount >= 2);
  const out = snap.groups.find((g) => g.direction === "CIKIS");
  assert.ok(out);
  assert.equal(out.count, 2);
  assert.equal(out.totalAmount, 300);
  assert.ok(out.transactionType);
  assert.ok(out.currency);
});

test("learn default on for leaf; off for parent/duplicate", () => {
  assert.equal(shouldDefaultCariAutoLearn({ accountCode: "320.01.001" }), true);
  assert.equal(canEnableCariAutoLearn({ accountCode: "320" }), false);
  assert.equal(
    canEnableCariAutoLearn({
      accountCode: "320.01.001",
      duplicateAccounts: true,
    }),
    false
  );
});

test("finding classes map kontrol tips", () => {
  assert.equal(
    mapKontrolTipToFindingClass(KONTROL_TIP.EKSIK_HESAP),
    FINDING_CLASS.MISSING_ACCOUNT
  );
  assert.equal(
    mapKontrolTipToFindingClass(KONTROL_TIP.DENGESIZ_FIS),
    FINDING_CLASS.UNBALANCED_VOUCHER
  );
  assert.equal(
    mapKontrolTipToFindingClass(KONTROL_TIP.DOVIZ_KUR),
    FINDING_CLASS.FX_RATE
  );
  assert.equal(
    mapKontrolTipToFindingClass(KONTROL_TIP.VERGI_360),
    FINDING_CLASS.TAX_SGK
  );
  assert.equal(
    mapKontrolTipToFindingClass(KONTROL_TIP.MUKERRER_HAREKET),
    FINDING_CLASS.DUPLICATE
  );
  assert.equal(
    mapKontrolTipToFindingClass(KONTROL_TIP.DUSUK_GUVEN),
    FINDING_CLASS.LOW_CONFIDENCE
  );
});

test("classifyFisKontrolFindings groups root causes", () => {
  const analysis = analyzeStandardLucaRows([
    {
      id: "a",
      fisNo: "1",
      fisTarihi: "01.01.2025",
      hesapKodu: "",
      borc: 10,
      alacak: 0,
      fisAciklama: "test",
    },
    {
      id: "b",
      fisNo: "1",
      fisTarihi: "01.01.2025",
      hesapKodu: "102.01",
      borc: 0,
      alacak: 5,
      fisAciklama: "bank",
    },
  ]);
  const report = classifyFisKontrolFindings(analysis);
  assert.ok(report.totalIssues > 0);
  assert.ok(report.classes.some((c) => c.id === FINDING_CLASS.MISSING_ACCOUNT));
  assert.ok(report.classes.every((c) => c.why && c.action));
});

test("apply + undo + reanalyze without reload", async () => {
  const rows = [
    row({ id: "x1", borc: 10 }),
    row({ id: "x2", borc: 20 }),
    {
      id: "bank",
      hesapKodu: "102.01.001",
      riskDurumu: "",
      fisNo: "1",
      fisTarihi: "01.01.2025",
      borc: 0,
      alacak: 30,
      fisAciklama: "BANK",
    },
  ];
  const snap = buildCariResolutionGroups(rows, { selectedBank: "VAKIFBANK" });
  const group = snap.groups[0];
  assert.ok(group);
  const undo = snapshotLucaRowsForUndo(rows, group.rowIds);
  const applied = await runCariResolutionGroupApply({
    lucaRows: rows,
    group,
    accountCode: "320.01.999",
    learn: false,
    selectedCompanyId: "co-test",
  });
  assert.ok(applied.updated >= 1);
  const re = reanalyzeAfterMissingAccountApply({
    lucaRows: applied.lucaRows,
    companyId: "co-test",
    skipMemoryPass: true,
  });
  assert.ok(re.fisKontrol);
  assert.ok(re.findingClasses);
  assert.ok(re.durationMs >= 0);
  assert.ok(re.pipelinePatch.reanalyzedWithoutReload);
  assert.equal(
    re.pipelinePatch.critical,
    re.fisKontrol.critical,
    "reanalyze patch critical must mirror fisKontrol"
  );
  assert.equal(
    re.pipelinePatch.errors,
    re.fisKontrol.errors,
    "reanalyze patch errors must mirror fisKontrol"
  );

  const restored = restoreLucaRowsFromUndoSnapshot(re.lucaRows, undo);
  const undoneMissing = restored.filter(
    (r) => group.rowIds.includes(r.id) && !String(r.hesapKodu || "").trim()
  );
  assert.ok(undoneMissing.length >= 1);
});

console.log("All missing-accounts-memory-flow tests passed.");
