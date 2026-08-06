/**
 * Eksik Hesap Çözüm Merkezi — sayaç dolu / liste boş regresyonu.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-missing-account-center-empty-list.mjs
 */
import assert from "node:assert/strict";
import {
  buildCariResolutionGroups,
  CARI_RESOLUTION_FILTERS,
  selectVisibleResolutionGroups,
  pickDefaultCariResolutionFilter,
  countOpenResolutionGroups,
  listResolvableResolutionGroups,
} from "@/src/utils/cariMissingResolutionGroups.js";
import { buildTaxObligationResolutionGroups } from "@/src/utils/taxObligation/resolutionGroups.js";
import { MISSING_HESAP_CATEGORY } from "@/src/utils/previewExportValidation.js";

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

function missingRow(partial) {
  return {
    riskDurumu: "HESAP_EKSIK",
    hesapKodu: "",
    borc: 100,
    alacak: 0,
    fisTarihi: "15.03.2026",
    ...partial,
  };
}

test("MTV/tax pre-bucketed rows are never dropped by tax group builder", () => {
  // Wide bucket admits MTV via isVergiSgkType; old narrow gate dropped it.
  const groups = buildTaxObligationResolutionGroups(
    [
      missingRow({
        id: "mtv1",
        detayAciklama: "MOTORLU TASITLAR VERGISI 2026",
        transactionType: "MTV",
        missingHesapCategory: "",
        direction: "CIKIS",
      }),
    ],
    [],
    { companyId: "mare" }
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].taxObligationGroup, true);
  assert.equal(groups[0].transactions.length, 1);
  assert.match(groups[0].transactions[0].description, /MOTORLU/);
  assert.equal(groups[0].status, "remaining");
});

test("totalMissing 3 → Tümü and Kalanlar list 3 (tax + orphans + cari)", () => {
  const rows = [
    missingRow({
      id: "cari1",
      detayAciklama: "GÖND / ABC TEDARIK LIMITED SIRKETI FATURA",
      transactionType: "GIDEN_HAVALE",
      missingHesapCategory: MISSING_HESAP_CATEGORY.CARI_BULUNAMADI,
      analysisKey: "abc|CIKIS",
      direction: "CIKIS",
      cariRequired: true,
    }),
    missingRow({
      id: "tax1",
      detayAciklama: "MTV ODEME 34 ABC 01",
      transactionType: "MTV",
      missingHesapCategory: "",
      analysisKey: "mtv|CIKIS",
      direction: "CIKIS",
    }),
    missingRow({
      id: "pos1",
      detayAciklama: "POS KOMISYON VADE",
      transactionType: "POS_KOMISYON",
      missingHesapCategory: MISSING_HESAP_CATEGORY.POS_KOMISYON,
      analysisKey: "pos|CIKIS",
      direction: "CIKIS",
    }),
  ];

  const snapshot = buildCariResolutionGroups(
    rows,
    {
      selectedCompany: { id: "mare", name: "MARE" },
      companyPlans: [
        {
          accountCode: "320.01.0001",
          accountName: "ABC TEDARIK LIMITED SIRKETI",
          isActive: true,
        },
      ],
    },
    { initialCandidateGroups: 0 }
  );

  assert.equal(snapshot.totalMissing, 3);
  assert.equal(snapshot.taxObligationMissingCount, 1);
  assert.equal(snapshot.taxObligationGroupCount, 1);
  assert.ok(
    snapshot.resolvableGroupCount >= 3,
    `expected >=3 resolvable groups, got ${snapshot.resolvableGroupCount}`
  );

  const allVisible = selectVisibleResolutionGroups({
    filter: CARI_RESOLUTION_FILTERS.ALL,
    ...snapshot,
  });
  const remainingVisible = selectVisibleResolutionGroups({
    filter: CARI_RESOLUTION_FILTERS.REMAINING,
    ...snapshot,
  });
  const taxVisible = selectVisibleResolutionGroups({
    filter: CARI_RESOLUTION_FILTERS.TAX_OBLIGATIONS,
    ...snapshot,
  });

  assert.equal(allVisible.length, 3, `Tümü expected 3, got ${allVisible.length}`);
  assert.equal(
    remainingVisible.length,
    3,
    `Kalanlar expected 3, got ${remainingVisible.length}`
  );
  assert.equal(taxVisible.length, 1);
  assert.ok(allVisible.some((g) => g.taxObligationGroup));
  assert.ok(
    allVisible.every(
      (g) =>
        (g.transactions && g.transactions.length) ||
        (g.samples && g.samples.length) ||
        g.partyName
    )
  );

  const defaultFilter = pickDefaultCariResolutionFilter(snapshot);
  assert.ok(
    [CARI_RESOLUTION_FILTERS.REMAINING, CARI_RESOLUTION_FILTERS.ALL].includes(
      defaultFilter
    )
  );
  const defaultVisible = selectVisibleResolutionGroups({
    filter: defaultFilter,
    ...snapshot,
  });
  assert.ok(defaultVisible.length > 0, "default filter must not be empty");
  assert.equal(countOpenResolutionGroups(snapshot), 3);
});

test("Vergi/SGK non-cari missing stays visible in Tümü", () => {
  const snapshot = buildCariResolutionGroups(
    [
      missingRow({
        id: "sgk1",
        detayAciklama: "SGK PRIM ODEME MAYIS 2026",
        transactionType: "SGK",
        missingHesapCategory: MISSING_HESAP_CATEGORY.VERGI_SGK,
        direction: "CIKIS",
      }),
      missingRow({
        id: "cari2",
        detayAciklama: "GÖND / XYZ LOJISTIK A.S. ODEME",
        transactionType: "GIDEN_HAVALE",
        missingHesapCategory: MISSING_HESAP_CATEGORY.CARI_BULUNAMADI,
        analysisKey: "xyz|CIKIS",
        direction: "CIKIS",
        cariRequired: true,
      }),
    ],
    {
      selectedCompany: { id: "mare", name: "MARE" },
      companyPlans: [],
    },
    { initialCandidateGroups: 0 }
  );

  const all = selectVisibleResolutionGroups({
    filter: CARI_RESOLUTION_FILTERS.ALL,
    ...snapshot,
  });
  assert.equal(all.length, 2);
  assert.equal(all.filter((g) => g.taxObligationGroup).length, 1);
  assert.equal(
    listResolvableResolutionGroups(snapshot).length,
    snapshot.resolvableGroupCount
  );
});

test("PDF/Excel parity — same rows yield same visible ALL count", () => {
  const sharedRows = [
    missingRow({
      id: "r1",
      sourceRowId: "src-1",
      detayAciklama: "GÖND / PARITY CARI AS",
      transactionType: "GIDEN_HAVALE",
      missingHesapCategory: MISSING_HESAP_CATEGORY.CARI_BULUNAMADI,
      analysisKey: "parity|CIKIS",
      direction: "CIKIS",
      cariRequired: true,
    }),
    missingRow({
      id: "r2",
      sourceRowId: "src-2",
      detayAciklama: "KDV1 ODEME",
      transactionType: "BILINMEYEN",
      missingHesapCategory: MISSING_HESAP_CATEGORY.VERGI_SGK,
      analysisKey: "kdv|CIKIS",
      direction: "CIKIS",
    }),
  ];
  const ctx = {
    selectedCompany: { id: "c1", name: "TEST" },
    companyPlans: [],
    selectedBank: "VakıfBank",
  };
  const pdfSnap = buildCariResolutionGroups(sharedRows, {
    ...ctx,
    sourceKind: "pdf",
  }, { initialCandidateGroups: 0 });
  const xlsSnap = buildCariResolutionGroups(sharedRows, {
    ...ctx,
    sourceKind: "excel",
  }, { initialCandidateGroups: 0 });
  const pdfAll = selectVisibleResolutionGroups({
    filter: CARI_RESOLUTION_FILTERS.ALL,
    ...pdfSnap,
  });
  const xlsAll = selectVisibleResolutionGroups({
    filter: CARI_RESOLUTION_FILTERS.ALL,
    ...xlsSnap,
  });
  assert.equal(pdfAll.length, xlsAll.length);
  assert.equal(pdfSnap.totalMissing, xlsSnap.totalMissing);
  assert.equal(pdfSnap.taxObligationGroupCount, xlsSnap.taxObligationGroupCount);
});

test("empty default filter is avoided when only tax groups exist", () => {
  const snapshot = buildCariResolutionGroups(
    [
      missingRow({
        id: "only-tax",
        detayAciklama: "DAMGA VERGISI",
        transactionType: "DAMGA_VERGISI_ODEME",
        missingHesapCategory: "",
        direction: "CIKIS",
      }),
    ],
    {
      selectedCompany: { id: "c1" },
      companyPlans: [],
    },
    { initialCandidateGroups: 0 }
  );
  assert.equal(snapshot.groups.length, 0);
  assert.equal(snapshot.taxObligationGroupCount, 1);
  const def = pickDefaultCariResolutionFilter(snapshot);
  const visible = selectVisibleResolutionGroups({
    filter: def,
    ...snapshot,
  });
  assert.ok(visible.length >= 1, "tax-only snapshot must open non-empty");
});

console.log("\nAll missing-account-center empty-list tests passed.");
