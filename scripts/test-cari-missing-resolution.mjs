/**
 * Cari Missing Resolution Center — unit tests
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cari-missing-resolution.mjs
 */
import assert from "node:assert/strict";
import {
  buildCariResolutionGroups,
  filterCariResolutionGroups,
  isAccountAllowedForDirection,
  isExpenseAccountCode,
  isForeignVendorDescription,
  isCariMissingRow,
  preferredCariPrefixesForDirection,
  searchCariResolutionCandidates,
  scheduleAfterPaint,
  shouldIgnoreCariResolutionOpen,
  CARI_RESOLUTION_FILTERS,
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

test("gelen/giden prefixes", () => {
  assert.deepEqual(preferredCariPrefixesForDirection("GIRIS"), ["120"]);
  assert.deepEqual(preferredCariPrefixesForDirection("CIKIS"), ["320", "336"]);
});

test("direction account guard", () => {
  assert.equal(isAccountAllowedForDirection("120.01.001", "GIRIS"), true);
  assert.equal(isAccountAllowedForDirection("320.01.001", "GIRIS"), false);
  assert.equal(isAccountAllowedForDirection("320.01.001", "CIKIS"), true);
  assert.equal(isAccountAllowedForDirection("120.01.001", "CIKIS"), false);
});

test("foreign vendor detection and no expense suggest", () => {
  assert.equal(isForeignVendorDescription("google meta reklam"), true);
  assert.equal(isExpenseAccountCode("760.01.001"), true);
  const plan = [
    { accountCode: "320.99.001", accountName: "GOOGLE ADS", isActive: true },
    { accountCode: "760.01.010", accountName: "REKLAM GIDER", isActive: true },
    { accountCode: "120.01.001", accountName: "MUSTERI", isActive: true },
  ];
  const result = searchCariResolutionCandidates(plan, {
    direction: "CIKIS",
    description: "GÖND. HVL / google meta reklam",
    foreignVendor: true,
    limit: 10,
  });
  assert.ok(result.candidates.every((c) => !isExpenseAccountCode(c.code)));
  assert.ok(result.candidates.some((c) => c.code.startsWith("320")));
});

test("incoming/outgoing groups stay separate", () => {
  const rows = [
    {
      id: "1",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "GELEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: "GLN. HVL / ACME OTEL",
      borc: 0,
      alacak: 100,
      fisTarihi: "2025-01-01",
      analysisKey: "acme|GIRIS",
    },
    {
      id: "2",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "GIDEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: "GÖND. HVL / ACME OTEL",
      borc: 50,
      alacak: 0,
      fisTarihi: "2025-01-02",
      analysisKey: "acme|CIKIS",
    },
  ];
  const snap = buildCariResolutionGroups(rows, { companyPlans: [] });
  assert.equal(snap.groupCount, 2);
  assert.equal(snap.cariMissingCount, 2);
  const dirs = snap.groups.map((g) => g.direction).sort();
  assert.deepEqual(dirs, ["CIKIS", "GIRIS"]);
});

test("personel and vergi excluded from cari groups", () => {
  const rows = [
    {
      id: "p1",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "MAAS_AVANSI",
      missingHesapCategory: "Personel bulunamadı",
      detayAciklama: "Mart Ayı Avans Ödemesi",
      borc: 1000,
      alacak: 0,
    },
    {
      id: "v1",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "SGK",
      missingHesapCategory: "Vergi/SGK türü çözülemedi",
      detayAciklama: "SGK ÖDEMESİ",
      borc: 2000,
      alacak: 0,
    },
    {
      id: "c1",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "GIDEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: "GÖND. HVL / TEDARIKCI A",
      borc: 300,
      alacak: 0,
      analysisKey: "tedarikci|CIKIS",
    },
  ];
  assert.equal(isCariMissingRow(rows[0]), false);
  assert.equal(isCariMissingRow(rows[1]), false);
  assert.equal(isCariMissingRow(rows[2]), true);
  const snap = buildCariResolutionGroups(rows, {});
  assert.equal(snap.cariMissingCount, 1);
  assert.equal(snap.groupCount, 1);
});

test("bulk apply target isolation via rowIds", () => {
  const rows = [
    {
      id: "a1",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "GIDEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: "GÖND / ALPHA",
      borc: 10,
      alacak: 0,
      analysisKey: "alpha|CIKIS",
    },
    {
      id: "a2",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "GIDEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: "GÖND / ALPHA",
      borc: 20,
      alacak: 0,
      analysisKey: "alpha|CIKIS",
    },
    {
      id: "b1",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "GIDEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: "GÖND / BETA",
      borc: 30,
      alacak: 0,
      analysisKey: "beta|CIKIS",
    },
  ];
  const snap = buildCariResolutionGroups(rows, {});
  const alpha = snap.groups.find((g) => g.analysisKey.includes("alpha"));
  const beta = snap.groups.find((g) => g.analysisKey.includes("beta"));
  assert.equal(alpha.count, 2);
  assert.equal(beta.count, 1);
  assert.deepEqual(new Set(alpha.rowIds), new Set(["a1", "a2"]));
  assert.ok(!alpha.rowIds.includes("b1"));
});

test("filter remaining/foreign", () => {
  const groups = [
    { id: "1", foreignVendor: false, direction: "CIKIS", partyName: "A", samples: [], status: "remaining" },
    { id: "2", foreignVendor: true, direction: "CIKIS", partyName: "Google", samples: ["google ads"], status: "remaining" },
  ];
  const foreign = filterCariResolutionGroups(groups, {
    filter: CARI_RESOLUTION_FILTERS.FOREIGN,
  });
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0].id, "2");
  const remaining = filterCariResolutionGroups(groups, {
    filter: CARI_RESOLUTION_FILTERS.REMAINING,
    resolvedIds: new Set(["1"]),
  });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, "2");
});

test("double-click / already-open ignored", () => {
  assert.equal(shouldIgnoreCariResolutionOpen({ isOpen: false, isLoading: false }), false);
  assert.equal(shouldIgnoreCariResolutionOpen({ isOpen: true, isLoading: false }), true);
  assert.equal(shouldIgnoreCariResolutionOpen({ isOpen: false, isLoading: true }), true);
  assert.equal(shouldIgnoreCariResolutionOpen({ isOpen: true, isLoading: true }), true);
});

test("scheduleAfterPaint runs asynchronously (modal-first yield)", async () => {
  let order = [];
  order.push("sync-before");
  await new Promise((resolve) => {
    scheduleAfterPaint(() => {
      order.push("async-work");
      resolve();
    });
    order.push("sync-after-schedule");
  });
  assert.deepEqual(order, ["sync-before", "sync-after-schedule", "async-work"]);
});

test("scheduleAfterPaint cancel prevents work", async () => {
  let ran = false;
  const cancel = scheduleAfterPaint(() => {
    ran = true;
  });
  cancel();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ran, false);
});

console.log("\nAll cari missing resolution tests passed.");
