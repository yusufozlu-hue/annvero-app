/**
 * Cari Missing Resolution Center — unit tests
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cari-missing-resolution.mjs
 */
import assert from "node:assert/strict";
import {
  buildCariResolutionGroups,
  createCariResolutionPlanCache,
  createOwnAccountVirmanContext,
  evaluateOwnAccountVirmanTransfer,
  filterCariResolutionGroups,
  hydrateCariResolutionGroupCandidates,
  isAccountAllowedForDirection,
  isExpenseAccountCode,
  isForeignVendorDescription,
  isCariMissingRow,
  isOwnAccountVirmanTransfer,
  preferredCariPrefixesForDirection,
  searchCariResolutionCandidates,
  scheduleAfterPaint,
  shouldIgnoreCariResolutionOpen,
  shouldApplyCariResolutionAsyncResult,
  isActiveCompanyOwnCariAccount,
  buildCariResolutionRowView,
  createInitialCariRowSelection,
  toggleCariRowSelection,
  setAllCariRowSelection,
  sliceCariRowsForDisplay,
  buildCariApplyGroupPayload,
  formatCariApplyButtonLabel,
  CARI_RESOLUTION_FILTERS,
  CARI_RESOLUTION_INITIAL_CANDIDATE_GROUPS,
  CARI_RESOLUTION_MODAL_MAX_WIDTH_PX,
  CARI_RESOLUTION_MODAL_WIDTH_CSS,
  CARI_RESOLUTION_ROW_PAGE_SIZE,
} from "@/src/utils/cariMissingResolutionGroups.js";

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
    return undefined;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makePlan(size = 400) {
  const plan = [];
  for (let i = 0; i < size; i++) {
    plan.push({
      accountCode: `320.01.${String(i).padStart(4, "0")}`,
      accountName: `TEDARIKCI ${i} LIMITED SIRKETI`,
      isActive: true,
    });
    if (i % 3 === 0) {
      plan.push({
        accountCode: `120.01.${String(i).padStart(4, "0")}`,
        accountName: `MUSTERI ${i} A.S.`,
        isActive: true,
      });
    }
  }
  return plan;
}

function makeCariRows(groupCount = 225) {
  const rows = [];
  for (let i = 0; i < groupCount; i++) {
    const dirIn = i % 2 === 0;
    rows.push({
      id: `r${i}`,
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: dirIn ? "GELEN_HAVALE" : "GIDEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: `${dirIn ? "GLN. HVL" : "GÖND. HVL"} / FIRMA ${i} OTEL`,
      borc: dirIn ? 0 : 100 + i,
      alacak: dirIn ? 100 + i : 0,
      fisTarihi: "2025-01-01",
      analysisKey: `firma${i}|${dirIn ? "GIRIS" : "CIKIS"}`,
    });
  }
  return rows;
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
  const snap = buildCariResolutionGroups(rows, {});
  assert.equal(snap.groupCount, 2);
  assert.ok(snap.groups.every((g) => g.direction));
  assert.notEqual(snap.groups[0].direction, snap.groups[1].direction);
});

test("personel and vergi excluded from cari groups", () => {
  const rows = [
    {
      id: "p1",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "PERSONEL_MAAS",
      cariRequired: false,
      missingHesapCategory: "Personel bulunamadı",
      detayAciklama: "MAAS ODEME",
      borc: 10,
      alacak: 0,
    },
    {
      id: "c1",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "GIDEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: "GÖND / CARI X",
      borc: 20,
      alacak: 0,
      analysisKey: "carix|CIKIS",
    },
  ];
  assert.equal(isCariMissingRow(rows[0]), false);
  assert.equal(isCariMissingRow(rows[1]), true);
  const snap = buildCariResolutionGroups(rows, {});
  assert.equal(snap.cariMissingCount, 1);
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
    {
      id: "1",
      foreignVendor: false,
      direction: "CIKIS",
      partyName: "A",
      samples: [],
      status: "remaining",
    },
    {
      id: "2",
      foreignVendor: true,
      direction: "CIKIS",
      partyName: "Google",
      samples: ["google ads"],
      status: "remaining",
    },
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

const MARE_OWN_IBAN = "TR330001500158000000000001";
const MARE_OTHER_OWN_IBAN = "TR440001000123000000000002";
const FOREIGN_IBAN = "TR110006400000011112223344";

function mareCompany() {
  return {
    companyName: "MARE RESORT OTEL AS",
    bankAccounts: [
      {
        bankName: "VAKIFBANK",
        iban: MARE_OWN_IBAN,
        accountNumber: "1580000001",
        lucaAccountCode: "102.01.001",
        isActive: true,
      },
      {
        bankName: "ZIRAAT",
        iban: MARE_OTHER_OWN_IBAN,
        accountNumber: "1230000002",
        lucaAccountCode: "102.02.001",
        isActive: true,
      },
    ],
    creditCards: [],
  };
}

function cariLikeRow(overrides = {}) {
  return {
    id: "x1",
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
    transactionType: "GIDEN_HAVALE",
    cariRequired: true,
    missingHesapCategory: "Cari bulunamadı",
    detayAciklama: "GÖND. HVL / DIS TEDARIKCI",
    borc: 100,
    alacak: 0,
    fisTarihi: "2025-01-01",
    analysisKey: "dis|CIKIS",
    ...overrides,
  };
}

test("own title + other own IBAN → kesin virman, cari grupta yok", () => {
  const company = mareCompany();
  const ctx = { selectedCompany: company, selectedBank: "VAKIFBANK" };
  const row = cariLikeRow({
    id: "own1",
    detayAciklama: `GÖND. HVL / MARE RESORT OTEL AS ${MARE_OTHER_OWN_IBAN}`,
    analysisKey: "mare-own|CIKIS",
  });
  assert.equal(isOwnAccountVirmanTransfer(row, ctx), true);
  assert.equal(isCariMissingRow(row, ctx), false);
  const snap = buildCariResolutionGroups([row], ctx, {
    initialCandidateGroups: false,
  });
  assert.equal(snap.groupCount, 0);
  const v = evaluateOwnAccountVirmanTransfer(row, ctx);
  assert.ok(v.suggested102.startsWith("102"));
  assert.equal(v.definiteEvidence, true);
});

test("own title + foreign IBAN → not auto virman", () => {
  const company = mareCompany();
  const ctx = { selectedCompany: company };
  const row = cariLikeRow({
    id: "cust1",
    detayAciklama: `GLN. HVL / MARE RESORT OTEL AS ${FOREIGN_IBAN}`,
    transactionType: "GELEN_HAVALE",
    analysisKey: "mare-cust|GIRIS",
  });
  assert.equal(isOwnAccountVirmanTransfer(row, ctx), false);
  assert.equal(isCariMissingRow(row, ctx), true);
});

test("BANKA_ICI_VIRMAN tipi + karşı 102 yok → aday, cari değil", () => {
  const company = mareCompany();
  const ctx = { selectedCompany: company, selectedBank: "VAKIFBANK" };
  const row = cariLikeRow({
    id: "v1",
    transactionType: "BANKA_ICI_VIRMAN",
    cariRequired: false,
    virmanCandidate: true,
    missingHesapCategory: "",
    detayAciklama: "VIRMAN HESAPLAR ARASI",
    kontrolNotu: "Virman adayı — karşı banka hesabı tanımlanmalı",
    analysisKey: "virman|CIKIS",
  });
  assert.equal(isOwnAccountVirmanTransfer(row, ctx), false);
  assert.equal(isCariMissingRow(row, ctx), false);
});

test("other own bank IBAN → kesin 102 hedefi", () => {
  const company = mareCompany();
  const ctx = {
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    ownAccountContext: createOwnAccountVirmanContext(company, "VAKIFBANK"),
  };
  const row = cariLikeRow({
    detayAciklama: `GÖND / MARE RESORT OTEL ${MARE_OTHER_OWN_IBAN}`,
  });
  const v = evaluateOwnAccountVirmanTransfer(row, ctx);
  assert.equal(v.definiteEvidence, true);
  assert.equal(v.suggested102, "102.02.001");
  assert.equal(isOwnAccountVirmanTransfer(row, ctx), true);
});

test("statement own IBAN alone is not virman", () => {
  const company = mareCompany();
  const ctx = {
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    ownAccountContext: createOwnAccountVirmanContext(company, "VAKIFBANK"),
  };
  const row = cariLikeRow({
    detayAciklama: "GÖND / DIS TEDARIKCI fatura bedeli",
    iban: MARE_OWN_IBAN,
  });
  const v = evaluateOwnAccountVirmanTransfer(row, ctx);
  assert.equal(v.isOwnVirman, false);
  assert.equal(v.isVirmanCandidate, false);
});

test("description statement IBAN + unvan → virman adayı değil (ekstre IBAN yetersiz)", () => {
  const company = mareCompany();
  const ctx = {
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    ownAccountContext: createOwnAccountVirmanContext(company, "VAKIFBANK"),
  };
  const row = cariLikeRow({
    detayAciklama: `GÖND / MARE RESORT OTEL ${MARE_OWN_IBAN}`,
  });
  const v = evaluateOwnAccountVirmanTransfer(row, ctx);
  assert.equal(isOwnAccountVirmanTransfer(row, ctx), false);
  assert.equal(v.isVirmanCandidate, false);
  assert.equal(isCariMissingRow(row, ctx), true);
});

test("same-name customer with foreign IBAN not excluded", () => {
  const company = mareCompany();
  const ctx = { selectedCompany: company };
  const row = cariLikeRow({
    id: "same-name",
    transactionType: "GIDEN_HAVALE",
    detayAciklama: `GÖND. HVL / MARE RESORT OTEL TEDARIK ${FOREIGN_IBAN}`,
    analysisKey: "mare-supplier|CIKIS",
  });
  // Unvan benzer + yabancı IBAN → cari kalır
  assert.equal(isOwnAccountVirmanTransfer(row, ctx), false);
  assert.equal(isCariMissingRow(row, ctx), true);
  const snap = buildCariResolutionGroups([row], ctx, {
    initialCandidateGroups: false,
  });
  assert.equal(snap.groupCount, 1);
  assert.equal(snap.virmanDivertedCount, 0);
});

test("double-click / already-open ignored", () => {
  assert.equal(
    shouldIgnoreCariResolutionOpen({ isOpen: false, isLoading: false }),
    false
  );
  assert.equal(
    shouldIgnoreCariResolutionOpen({ isOpen: true, isLoading: false }),
    true
  );
  assert.equal(
    shouldIgnoreCariResolutionOpen({ isOpen: false, isLoading: true }),
    true
  );
});

await test("scheduleAfterPaint runs asynchronously (modal-first yield)", async () => {
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

await test("scheduleAfterPaint cancel prevents work", async () => {
  let ran = false;
  const cancel = scheduleAfterPaint(() => {
    ran = true;
  });
  cancel();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(ran, false);
});

test("modal shell mount semantics — open before heavy work", () => {
  // Click handler contract: ignore gate false → open shell → schedule work
  assert.equal(
    shouldIgnoreCariResolutionOpen({ isOpen: false, isLoading: false }),
    false
  );
  const openThenSchedule = [];
  openThenSchedule.push("modal-open");
  scheduleAfterPaint(() => openThenSchedule.push("groups"));
  assert.equal(openThenSchedule[0], "modal-open");
  assert.ok(!openThenSchedule.includes("groups"));
});

test("close cancels async state apply", () => {
  assert.equal(
    shouldApplyCariResolutionAsyncResult({
      generation: 1,
      activeGeneration: 1,
      isOpen: true,
    }),
    true
  );
  assert.equal(
    shouldApplyCariResolutionAsyncResult({
      generation: 1,
      activeGeneration: 2,
      isOpen: true,
    }),
    false
  );
  assert.equal(
    shouldApplyCariResolutionAsyncResult({
      generation: 1,
      activeGeneration: 1,
      isOpen: false,
    }),
    false
  );
});

test("lazy: first N groups get candidates, rest on-demand", () => {
  const plan = makePlan(80);
  const rows = makeCariRows(50);
  const snap = buildCariResolutionGroups(
    rows,
    { companyPlans: plan },
    { initialCandidateGroups: 30, collectStats: true }
  );
  assert.equal(snap.groupCount, 50);
  assert.equal(CARI_RESOLUTION_INITIAL_CANDIDATE_GROUPS, 30);
  const ready = snap.groups.filter((g) => g.candidatesReady);
  const pending = snap.groups.filter((g) => !g.candidatesReady);
  assert.equal(ready.length, 30);
  assert.equal(pending.length, 20);
  assert.equal(snap.stats.indexBuilds, 1);
  assert.equal(snap.stats.candidateHydrations, 30);
  assert.ok(snap.stats.legacyWouldHaveRebuiltIndex === 50);

  const firstPending = pending[0];
  const hydrated = hydrateCariResolutionGroupCandidates(
    firstPending,
    plan,
    { planCache: snap.planCache }
  );
  assert.equal(hydrated.candidatesReady, true);
  assert.ok(Array.isArray(hydrated.candidates));
});

test("plan index built once for many candidate searches", () => {
  const plan = makePlan(300);
  const cache = createCariResolutionPlanCache(plan);
  assert.equal(cache.indexBuildCount, 1);
  assert.equal(cache.planNormalizeCount, 1);
  for (let i = 0; i < 40; i++) {
    searchCariResolutionCandidates(plan, {
      direction: "CIKIS",
      description: `TEDARIKCI ${i} LIMITED`,
      planCache: cache,
      limit: 5,
    });
  }
  // Cache immutable counters — still 1 (no rebuild)
  assert.equal(cache.indexBuildCount, 1);
});

await test("perf numbers for 225 groups (report)", async () => {
  const { buildCariMatchIndex } = await import(
    "@/src/utils/cariAccountMatcher.js"
  );
  const plan = makePlan(800);
  const rows = makeCariRows(225);

  const tIndex1 = performance.now();
  buildCariMatchIndex(plan);
  const indexOnceMs = performance.now() - tIndex1;

  const tIndexN = performance.now();
  for (let i = 0; i < 225; i++) buildCariMatchIndex(plan);
  const index225Ms = performance.now() - tIndexN;

  const tNew = performance.now();
  const snap = buildCariResolutionGroups(
    rows,
    { companyPlans: plan },
    { initialCandidateGroups: 30, collectStats: true }
  );
  const newTotalMs = performance.now() - tNew;

  console.log(
    JSON.stringify(
      {
        indexOnceMs: Math.round(indexOnceMs),
        index225RebuildMs: Math.round(index225Ms),
        newBuildMs: Math.round(newTotalMs),
        stats: snap.stats,
        groups: snap.groupCount,
        ready: snap.groups.filter((g) => g.candidatesReady).length,
      },
      null,
      2
    )
  );

  assert.equal(snap.groupCount, 225);
  assert.equal(snap.stats.indexBuilds, 1);
  assert.equal(snap.stats.candidateHydrations, 30);
  assert.equal(snap.stats.planScansDuringCandidates, 30);
  // Eski: her grupta index rebuild (~index225RebuildMs). Yeni: 1 index + 30 aday.
  assert.ok(snap.stats.indexBuilds === 1);
  assert.ok(
    snap.stats.candidateHydrations < snap.stats.legacyWouldHaveRebuiltIndex
  );

  const tAll = performance.now();
  const allSnap = buildCariResolutionGroups(
    rows,
    { companyPlans: plan, planCache: snap.planCache },
    { initialCandidateGroups: "all", collectStats: true }
  );
  const allMs = performance.now() - tAll;
  console.log(
    JSON.stringify({
      allCandidatesMs: Math.round(allMs),
      allHydrations: allSnap.stats.candidateHydrations,
      allIndexBuilds: allSnap.stats.indexBuilds,
    })
  );
  assert.equal(allSnap.stats.candidateHydrations, 225);
  assert.equal(allSnap.stats.indexBuilds, 1);
  assert.ok(
    newTotalMs < allMs,
    `lazy ${newTotalMs} should be faster than all ${allMs}`
  );
});

test("modal width constants", () => {
  assert.equal(CARI_RESOLUTION_MODAL_MAX_WIDTH_PX, 1500);
  assert.ok(CARI_RESOLUTION_MODAL_WIDTH_CSS.includes("1500px"));
  assert.ok(CARI_RESOLUTION_MODAL_WIDTH_CSS.includes("96vw"));
  assert.ok(CARI_RESOLUTION_MODAL_WIDTH_CSS.includes("92vh"));
});

test("title + masked statement IBAN → virman adayı değil, cari grupta yetersiz karşı taraf", () => {
  const company = mareCompany();
  const ctx = {
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    companyPlans: [
      {
        accountCode: "320.01.D0003",
        accountName: "DE MARE RESORT OTEL AS",
        isActive: true,
      },
      {
        accountCode: "320.01.001",
        accountName: "DIS TEDARIKCI LTD",
        isActive: true,
      },
    ],
  };
  const row = cariLikeRow({
    id: "mask1",
    detayAciklama:
      "GÖND. HVL / MARE RESORT OTEL AS TR33 0001 5001 58** **** **00 01",
    analysisKey: "mare-mask|CIKIS",
  });
  const v = evaluateOwnAccountVirmanTransfer(row, ctx);
  assert.equal(v.isVirmanCandidate, false);
  const snap = buildCariResolutionGroups([row], ctx, {
    initialCandidateGroups: "all",
  });
  assert.equal(snap.virmanCandidateCount, 0);
  assert.equal(snap.virmanCandidateGroups.length, 0);
  assert.equal(snap.groupCount, 1);
  assert.equal(snap.cariMissingCount, 1);
  const g = snap.groups[0];
  assert.equal(g.virmanCandidate || false, false);
  assert.notEqual(g.suggestedAccount || "", "120");
  assert.notEqual(g.suggestedAccount || "", "320");
});

test("aktif firmanın kendi 320 hesabı aday / tüm plan / fuzzy'de yok", () => {
  const company = {
    ...mareCompany(),
    id: "co-mare",
    taxNumber: "1234567890",
  };
  const plan = [
    {
      accountCode: "320.01.D0003",
      accountName: "DE MARE RESORT OTEL AS",
      isActive: true,
    },
    {
      accountCode: "320.01.0099",
      accountName: "MARE RESORT OTEL TEDARIK LTD",
      isActive: true,
    },
    {
      accountCode: "320.01.001",
      accountName: "BASKA TEDARIKCI AS",
      isActive: true,
    },
  ];
  assert.equal(
    isActiveCompanyOwnCariAccount(
      { code: "320.01.D0003", name: "DE MARE RESORT OTEL AS" },
      company
    ),
    true
  );
  assert.equal(
    isActiveCompanyOwnCariAccount(
      { code: "320.01.0099", name: "MARE RESORT OTEL TEDARIK LTD" },
      company
    ),
    false
  );

  const top = searchCariResolutionCandidates(plan, {
    direction: "CIKIS",
    description: "GÖND. HVL / MARE RESORT OTEL AS fatura bedeli",
    limit: 5,
    selectedCompany: company,
  });
  assert.ok(
    !top.candidates.some((c) => c.code.includes("320.01.D0003")),
    "own 320 not in top 5"
  );
  assert.ok(top.ownCompanyFiltered >= 1);

  const allPlan = searchCariResolutionCandidates(plan, {
    query: "MARE",
    direction: "CIKIS",
    description: "MARE",
    limit: 25,
    searchAll: true,
    selectedCompany: company,
  });
  assert.ok(
    !allPlan.allCandidates.some((c) => c.code.includes("320.01.D0003")),
    "own 320 not in all-plan search"
  );
  assert.ok(
    allPlan.allCandidates.some((c) => c.code.includes("320.01.0099")),
    "similar third party kept"
  );
});

test("yalnız aktif firma ünvanı → otomatik virman adayı değil", () => {
  const company = mareCompany();
  const ctx = { selectedCompany: company, selectedBank: "VAKIFBANK" };
  const row = cariLikeRow({
    detayAciklama: "GÖND. HVL / MARE RESORT OTEL AS fatura bedeli",
    analysisKey: "title-only|CIKIS",
  });
  const v = evaluateOwnAccountVirmanTransfer(row, ctx);
  assert.equal(v.isVirmanCandidate, false);
  assert.equal(isCariMissingRow(row, ctx), true);
  const snap = buildCariResolutionGroups([row], ctx, {
    initialCandidateGroups: false,
  });
  assert.equal(snap.groupCount, 1);
  assert.equal(snap.virmanCandidateCount, 0);
  assert.equal(snap.groups[0].partyUnresolved, true);
  assert.equal(snap.groups[0].partyName, "Karşı taraf tespit edilemedi");
  assert.ok(!/MARE RESORT/i.test(snap.groups[0].partyName));
});

test("kendi firma unvanı (companyName) sahte MARE grubu oluşturmaz", () => {
  const company = {
    id: "co-mare",
    companyName: "MARE RESORT TURIZM VE OTELCILIK TICARET AS",
  };
  const rows = Array.from({ length: 3 }, (_, i) =>
    cariLikeRow({
      id: `own${i}`,
      sourceRowId: `vakif|s|${100 + i}`,
      detayAciklama: `TARIHLI SORGU NO LU MARE RESORT TURIZM VE OTELCILIK TICARET AS HESABI ${i}`,
      analysisKey: `nolu-mare-shared|CIKIS`,
      transactionType: "GIDEN_HAVALE",
      borc: 100,
      alacak: 0,
    })
  );
  const snap = buildCariResolutionGroups(rows, {
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    companyPlans: [
      {
        accountCode: "320.01.D0003",
        accountName: "DE MARE RESORT OTEL AS",
        isActive: true,
      },
    ],
  }, { initialCandidateGroups: "all" });
  // Aynı analysisKey olsa bile tek generic yığın yok
  assert.equal(snap.groupCount, 3);
  assert.ok(snap.groups.every((g) => g.partyUnresolved));
  assert.ok(
    snap.groups.every((g) => g.partyName === "Karşı taraf tespit edilemedi")
  );
  assert.ok(snap.groups.every((g) => !(g.suggestedAccount || "")));
});

test("own unvan + gerçek karşı taraf (AVUKATLIK) tek generic yığına girmez", () => {
  const company = {
    id: "co-mare",
    companyName: "MARE RESORT TURIZM VE OTELCILIK TICARET AS",
  };
  const rows = [
    cariLikeRow({
      id: "a1",
      sourceRowId: "vakif|s|1",
      detayAciklama:
        "TARIHLI SORGU NO LU MARE RESORT TURIZM VE OTELCILIK TICARET AS HESABI AVUKATLIK UCRETI",
      analysisKey: "avukatlik|CIKIS",
      transactionType: "GIDEN_HAVALE",
      borc: 100,
      alacak: 0,
    }),
    cariLikeRow({
      id: "a2",
      sourceRowId: "vakif|s|2",
      detayAciklama:
        "TARIHLI SORGU NO LU MARE RESORT TURIZM VE OTELCILIK TICARET AS HESABI DANISMANLIK BEDELI",
      analysisKey: "danismanlik|CIKIS",
      transactionType: "GIDEN_HAVALE",
      borc: 200,
      alacak: 0,
    }),
  ];
  const snap = buildCariResolutionGroups(
    rows,
    { selectedCompany: company, selectedBank: "VAKIFBANK", companyPlans: [] },
    { initialCandidateGroups: false }
  );
  assert.equal(snap.groupCount, 2);
  assert.ok(
    snap.groups.every((g) => String(g.analysisKey || "").includes("party-unresolved") || g.partyUnresolved || g.count === 1)
  );
});

test("BİLET unique exact leaf → Seçilen hesap dolu (plan_search doldurmaz)", () => {
  const company = mareCompany();
  const plan = [
    { accountCode: "120", accountName: "ALICILAR", isActive: true },
    { accountCode: "120.01", accountName: "YURTICI", isActive: true },
    {
      accountCode: "120.01.B0019",
      accountName: "BİLETDÜKKANI TURİZM A.Ş.",
      isActive: true,
    },
    {
      accountCode: "120.10.B0001",
      accountName: "BİLET DÜKKANI TURİZM A.Ş.",
      isActive: true,
    },
    {
      accountCode: "120.10.X0099",
      accountName: "DIGER MUSTERI AS",
      isActive: true,
    },
  ];
  const desc =
    "TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 SORGU NUMARALI BILETDUK";
  const search = searchCariResolutionCandidates(plan, {
    description: desc,
    direction: "GIRIS",
    limit: 5,
    selectedCompany: company,
  });
  assert.equal(search.duplicateAccounts, false);
  assert.ok(
    search.candidates.some((c) => c.code === "120.10.B0001" && c.confidence >= 95)
  );
  assert.ok(
    !search.candidates.some((c) => c.matchReason === "plan_search"),
    "boş sorguda plan_search unique unvanı bozmasın"
  );

  const row = cariLikeRow({
    id: "bilet1",
    detayAciklama: desc,
    analysisKey: "biletduk-ziraat|GIRIS",
    transactionType: "GELEN_HAVALE",
    borc: 0,
    alacak: 250,
  });
  const snap = buildCariResolutionGroups(
    [row],
    { selectedCompany: company, selectedBank: "VAKIFBANK", companyPlans: plan },
    { initialCandidateGroups: "all" }
  );
  const g = snap.groups[0];
  assert.equal(g.suggestedAccount, "120.10.B0001");
  assert.ok(/B[İI]LET/i.test(g.suggestedName || ""));
  assert.ok(Number(g.confidence) >= 95);
});

test("virman adayı grup: hydrate aday üretmez", () => {
  const group = {
    id: "virman-aday:x",
    virmanCandidate: true,
    direction: "CIKIS",
    samples: ["maskeli"],
    foreignVendor: false,
  };
  const hydrated = hydrateCariResolutionGroupCandidates(
    group,
    [{ accountCode: "320.01.D0003", accountName: "DE MARE", isActive: true }],
    { limit: 5, selectedCompany: mareCompany() }
  );
  assert.equal(hydrated.candidatesReady, true);
  assert.deepEqual(hydrated.candidates, []);
  assert.equal(hydrated.suggestedAccount, "");
});

test("grup işlem listesi: 29 satır + varsayılan tümü seçili", () => {
  const rows = [];
  for (let i = 0; i < 29; i++) {
    rows.push({
      id: `g29-${i}`,
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "GIDEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: `GÖND / PARTNER OTEL fatura ${i}`,
      borc: 100 + i,
      alacak: 0,
      fisTarihi: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
      analysisKey: "partner-otel|CIKIS",
    });
  }
  const snap = buildCariResolutionGroups(rows, {}, {
    initialCandidateGroups: false,
  });
  assert.equal(snap.groupCount, 1);
  const g = snap.groups[0];
  assert.equal(g.count, 29);
  assert.equal(g.transactions.length, 29);
  assert.equal(g.rowIds.length, 29);
  const view = g.transactions[0];
  assert.ok(view.date);
  assert.ok(view.description);
  assert.equal(view.directionLabel, "Giden");
  assert.ok(view.amount > 0);
  assert.ok(view.transactionType);

  const selected = createInitialCariRowSelection(g.rowIds);
  assert.equal(selected.size, 29);

  let next = selected;
  next = toggleCariRowSelection(next, g.rowIds[0]);
  next = toggleCariRowSelection(next, g.rowIds[1]);
  assert.equal(next.size, 27);
  assert.equal(formatCariApplyButtonLabel(next.size), "Seçilen Hesabı 27 İşleme Uygula");

  const payload = buildCariApplyGroupPayload(g, [...next]);
  assert.equal(payload.rowIds.length, 27);
  assert.equal(payload.isPartialApply, true);
  assert.ok(String(payload.id).includes("__partial__"));
  assert.ok(!payload.rowIds.includes(g.rowIds[0]));
  assert.ok(!payload.rowIds.includes(g.rowIds[1]));
});

test("seçili 27 satıra uygulama; 2 eksik kalır; diğer grup dokunulmaz", () => {
  const rows = [];
  for (let i = 0; i < 29; i++) {
    rows.push({
      id: `p-${i}`,
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "GIDEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: `GÖND / PARTNER ${i}`,
      borc: 10,
      alacak: 0,
      analysisKey: "partner|CIKIS",
    });
  }
  rows.push({
    id: "other-1",
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
    transactionType: "GIDEN_HAVALE",
    cariRequired: true,
    missingHesapCategory: "Cari bulunamadı",
    detayAciklama: "GÖND / DIGER FIRMA",
    borc: 50,
    alacak: 0,
    analysisKey: "diger|CIKIS",
  });

  const lucaBefore = rows.map((r) => ({
    ...r,
    borc: r.borc,
    alacak: r.alacak,
  }));
  const lucaCountBefore = lucaBefore.length;
  const balanceBefore = lucaBefore.reduce(
    (s, r) => s + Number(r.borc || 0) - Number(r.alacak || 0),
    0
  );

  const snap = buildCariResolutionGroups(lucaBefore, {}, {
    initialCandidateGroups: false,
  });
  const partner = snap.groups.find((g) => g.analysisKey.includes("partner"));
  const other = snap.groups.find((g) => g.analysisKey.includes("diger"));
  assert.equal(partner.count, 29);
  assert.equal(other.count, 1);

  const skip = new Set([partner.rowIds[0], partner.rowIds[1]]);
  const selected = partner.rowIds.filter((id) => !skip.has(id));
  const payload = buildCariApplyGroupPayload(partner, selected);
  assert.equal(payload.rowIds.length, 27);

  const target = new Set(payload.rowIds);
  let updated = 0;
  const lucaAfter = lucaBefore.map((item) => {
    if (!target.has(item.id)) return item;
    updated += 1;
    return {
      ...item,
      hesapKodu: "320.01.0100",
      riskDurumu: "",
      missingHesapCategory: "",
    };
  });
  assert.equal(updated, 27);
  assert.equal(lucaAfter.length, lucaCountBefore);
  const balanceAfter = lucaAfter.reduce(
    (s, r) => s + Number(r.borc || 0) - Number(r.alacak || 0),
    0
  );
  assert.equal(balanceAfter, balanceBefore);

  const stillMissing = lucaAfter.filter(
    (r) => !String(r.hesapKodu || "").trim() || r.riskDurumu === "HESAP_EKSIK"
  );
  assert.equal(stillMissing.length, 3); // 2 partner + 1 other
  assert.ok(stillMissing.some((r) => r.id === partner.rowIds[0]));
  assert.ok(stillMissing.some((r) => r.id === partner.rowIds[1]));
  assert.ok(stillMissing.some((r) => r.id === "other-1"));
  assert.equal(
    lucaAfter.find((r) => r.id === "other-1").hesapKodu,
    ""
  );

  const snapAfter = buildCariResolutionGroups(lucaAfter, {}, {
    initialCandidateGroups: false,
  });
  const partnerAfter = snapAfter.groups.find((g) =>
    g.analysisKey.includes("partner")
  );
  const otherAfter = snapAfter.groups.find((g) =>
    g.analysisKey.includes("diger")
  );
  assert.equal(partnerAfter.count, 2);
  assert.equal(otherAfter.count, 1);
  assert.equal(snapAfter.cariMissingCount, 3);
});

test("100+ satır lazy sayfalama; seçim görünmeyenlerde korunur", () => {
  const rows = [];
  for (let i = 0; i < 120; i++) {
    rows.push({
      id: `big-${i}`,
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      transactionType: "GIDEN_HAVALE",
      cariRequired: true,
      missingHesapCategory: "Cari bulunamadı",
      detayAciklama: `GÖND / BUYUK GRUP ${i}`,
      borc: 5,
      alacak: 0,
      analysisKey: "buyuk|CIKIS",
    });
  }
  const snap = buildCariResolutionGroups(rows, {}, {
    initialCandidateGroups: false,
  });
  const g = snap.groups[0];
  assert.equal(g.transactions.length, 120);
  assert.equal(CARI_RESOLUTION_ROW_PAGE_SIZE, 25);
  const page1 = sliceCariRowsForDisplay(g.transactions, CARI_RESOLUTION_ROW_PAGE_SIZE);
  assert.equal(page1.visible.length, 25);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.remaining, 95);

  let selected = createInitialCariRowSelection(g.rowIds);
  assert.equal(selected.size, 120);
  selected = toggleCariRowSelection(selected, "big-100");
  assert.equal(selected.has("big-100"), false);
  assert.equal(selected.size, 119);
  // Görünmeyen satır hâlâ seçili
  assert.equal(selected.has("big-90"), true);

  const page2 = sliceCariRowsForDisplay(
    g.transactions,
    CARI_RESOLUTION_ROW_PAGE_SIZE * 2
  );
  assert.equal(page2.visible.length, 50);
  assert.equal(selected.size, 119);
});

test("row view ve tam seçimde partial bayrağı yok", () => {
  const row = buildCariResolutionRowView({
    id: "x",
    fisTarihi: "2025-02-01",
    detayAciklama: "GLN / TEST",
    alacak: 20,
    borc: 0,
    transactionType: "GELEN_HAVALE",
    analysisKey: "t|GIRIS",
    riskDurumu: "HESAP_EKSIK",
  });
  assert.equal(row.directionLabel, "Gelen");
  const group = {
    id: "t|GIRIS",
    rowIds: ["a", "b"],
    seedRow: { id: "a" },
    transactions: [
      { id: "a", learnSeed: { id: "a", detayAciklama: "A" } },
      { id: "b", learnSeed: { id: "b", detayAciklama: "B" } },
    ],
  };
  const full = buildCariApplyGroupPayload(group, ["a", "b"]);
  assert.equal(full.isPartialApply, false);
  assert.equal(full.id, "t|GIRIS");
  assert.equal(formatCariApplyButtonLabel(0).includes("İşleme"), true);
  assert.deepEqual([...setAllCariRowSelection(["a", "b"], false)], []);
});

console.log("\nAll cari missing resolution tests passed.");
