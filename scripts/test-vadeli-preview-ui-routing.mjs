/**
 * Preview UI / reanalysis: vadeli lifecycle satırları cari gruba ve
 * “Karşı taraf tespit edilemedi” kovasına düşmez.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-vadeli-preview-ui-routing.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCariResolutionGroups,
  selectVisibleResolutionGroups,
  listResolvableResolutionGroups,
  CARI_RESOLUTION_FILTERS,
  PARTY_UNRESOLVED_LABEL,
  VADELI_ACCOUNT_MISSING_LABEL,
  FAIZ_STOPAJI_MISSING_LABEL,
  isCariMissingRow,
} from "@/src/utils/cariMissingResolutionGroups.js";
import {
  stripStandardLucaRow,
  bankMovementToStandardLucaRows,
} from "@/src/utils/standardLucaRow.js";
import { BANK_TRANSACTION_TYPE } from "@/src/utils/bankTransactionType.js";
import { MISSING_HESAP_CATEGORY } from "@/src/utils/previewExportValidation.js";
import { VADELI_LIFECYCLE_SCENARIO } from "@/src/utils/vadeliMevduatLifecycle.js";

const COMPANY = {
  id: "company-vadeli-ui",
  name: "TEST TURIZM A.S.",
  companyName: "TEST",
  bankAccounts: [
    {
      bankName: "VAKIFBANK",
      accountType: "VADESIZ",
      lucaAccountCode: "102.10.V001",
      accountNumber: "158007308428449",
      isActive: true,
    },
  ],
};

const PLANS = [
  { accountCode: "102.10.V001", accountName: "VAKIF VADESIZ", isActive: true },
  { accountCode: "102.10.V099", accountName: "YENI VADELI", isActive: true },
  { accountCode: "193.01.001", accountName: "PESIN VERGI", isActive: true },
  { accountCode: "193.01.002", accountName: "DIGER STOPAJ", isActive: true },
  { accountCode: "120.01.001", accountName: "MUSTERI X", isActive: true },
  { accountCode: "320.01.001", accountName: "TEDARIKCI Y", isActive: true },
];

function missingCounterLeg({
  id,
  transactionType,
  description,
  amount = 1000,
  direction = "CIKIS",
  missingHesapCategory = "",
  accountingScenario = VADELI_LIFECYCLE_SCENARIO,
  vadeliLifecycleRole = "",
}) {
  const movement = {
    id: `m-${id}`,
    amount,
    direction,
    description,
    lucaDescription: description,
    accountCode: "102.10.V099",
    counterAccountCode: "",
    transactionType,
    accountingScenario,
    cariRequired: false,
    missingHesapCategory,
    vadeliLifecycleRole,
    warning: missingHesapCategory || "Hesap eşleşmesi bulunamadı",
  };
  const rows = bankMovementToStandardLucaRows(movement, `F-${id}`, {
    kaynakAdi: "VAKIFBANK",
    bankAccounts: COMPANY.bankAccounts,
  });
  // Reanalysis / hydrate yolu: strip alanları korumalı
  return rows.map(stripStandardLucaRow);
}

function assertNoPartyUnresolved(snapshot) {
  for (const g of snapshot.groups || []) {
    assert.notEqual(
      g.partyName,
      PARTY_UNRESOLVED_LABEL,
      `cari group partyName must not be ${PARTY_UNRESOLVED_LABEL}`
    );
    assert.equal(g.partyUnresolved, false);
  }
}

/** Preview modalın göstereceği metrik/başlık yüzeyi (browser kabul sözleşmesi). */
function renderPreviewResolutionSurface(snapshot) {
  const remaining = selectVisibleResolutionGroups({
    filter: CARI_RESOLUTION_FILTERS.REMAINING,
    groups: snapshot.groups,
    vadeliAccountGroups: snapshot.vadeliAccountGroups,
    faizStopajiGroups: snapshot.faizStopajiGroups,
    creditCardGroups: snapshot.creditCardGroups,
    taxObligationGroups: snapshot.taxObligationGroups,
    virmanCandidateGroups: snapshot.virmanCandidateGroups,
  });
  const headings = remaining.map((g) => g.partyName || "");
  return {
    html: [
      `<div data-metric="cari-grup">${snapshot.groupCount}</div>`,
      `<div data-metric="cari-bulunamadi">${snapshot.cariMissingCount}</div>`,
      `<div data-metric="virman-adayi">${snapshot.virmanCandidateCount || 0}</div>`,
      `<div data-metric="vadeli-eksik">${snapshot.vadeliAccountMissingCount || 0}</div>`,
      `<div data-metric="stopaj-eksik">${snapshot.faizStopajiMissingCount || 0}</div>`,
      ...headings.map(
        (h, i) => `<h3 data-group-title="${i}">${escapeHtml(h)}</h3>`
      ),
    ].join(""),
    headings,
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readMetric(html, key) {
  const m = html.match(new RegExp(`data-metric="${key}">([^<]*)<`));
  return m ? m[1] : "";
}

test("unmatched vadeli + stopaj: CARI GRUP=0, vadeli kategori görünür, strip sonrası korunur", () => {
  const legs = [
    ...missingCounterLeg({
      id: "kapanis",
      transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
      description: "Hesap Kapatma",
      missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      vadeliLifecycleRole: "VADELI_KAPANIS",
    }),
    ...missingCounterLeg({
      id: "acilis",
      transactionType: BANK_TRANSACTION_TYPE.VADELI_ACILIS,
      description: "Vadeli Hesap Acma",
      missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      vadeliLifecycleRole: "VADELI_ACILIS",
    }),
    ...missingCounterLeg({
      id: "faiz",
      transactionType: BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
      description: "Mevduat Faiz Tahakkuk",
      direction: "GIRIS",
      missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      vadeliLifecycleRole: "FAIZ_GELIRI",
    }),
    ...missingCounterLeg({
      id: "stopaj1",
      transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
      description: "Mevduat Faiz Stopaj",
      missingHesapCategory: MISSING_HESAP_CATEGORY.FAIZ_STOPAJI_HESAP,
      vadeliLifecycleRole: "FAIZ_STOPAJI",
      amount: 50,
    }),
    ...missingCounterLeg({
      id: "stopaj2",
      transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
      description: "Stopaj",
      missingHesapCategory: MISSING_HESAP_CATEGORY.FAIZ_STOPAJI_HESAP,
      vadeliLifecycleRole: "FAIZ_STOPAJI",
      amount: 51,
    }),
  ];

  const missingOnly = legs.filter((r) => !String(r.hesapKodu || "").trim());
  assert.ok(missingOnly.length >= 5, "counter legs missing");

  for (const row of missingOnly) {
    assert.ok(row.transactionType, "strip preserves transactionType");
    assert.ok(row.accountingScenario, "strip preserves accountingScenario");
    assert.equal(isCariMissingRow(row, { selectedCompany: COMPANY }), false);
  }

  const snapshot = buildCariResolutionGroups(legs, {
    selectedCompany: COMPANY,
    companyPlans: PLANS,
  });

  assert.equal(snapshot.groupCount, 0, "CARI GRUP=0");
  assert.equal(snapshot.cariMissingCount, 0, "Cari bulunamadı=0");
  assert.equal(snapshot.virmanCandidateCount || 0, 0, "VİRMAN ADAYI=0");
  assert.ok(snapshot.vadeliAccountMissingCount >= 3, "vadeli missing rows");
  assert.ok(snapshot.vadeliAccountGroupCount >= 1, "vadeli groups");
  assert.ok(snapshot.faizStopajiMissingCount >= 2, "stopaj missing");
  assert.ok(snapshot.faizStopajiGroupCount >= 1, "stopaj groups");
  assertNoPartyUnresolved(snapshot);

  const titles = (snapshot.vadeliAccountGroups || []).map((g) => g.partyName);
  assert.ok(
    titles.every((t) => t === VADELI_ACCOUNT_MISSING_LABEL),
    "Vadeli mevduat hesabı eşleştirilmedi"
  );
  for (const g of snapshot.vadeliAccountGroups || []) {
    assert.equal(g.hideCariSearch, true);
    assert.deepEqual(g.preferredPrefixes, ["102"]);
    assert.ok(!g.partyUnresolved);
  }
  for (const g of snapshot.faizStopajiGroups || []) {
    assert.equal(g.partyName, FAIZ_STOPAJI_MISSING_LABEL);
    assert.equal(g.hideCariSearch, true);
    assert.deepEqual(g.preferredPrefixes, ["193"]);
  }

  const visibleVadeli = selectVisibleResolutionGroups({
    filter: CARI_RESOLUTION_FILTERS.VADELI_ACCOUNTS,
    vadeliAccountGroups: snapshot.vadeliAccountGroups,
  });
  assert.ok(visibleVadeli.length >= 1);
  assert.ok(
    visibleVadeli.some((g) => g.partyName === VADELI_ACCOUNT_MISSING_LABEL)
  );

  const visibleCariOnly = selectVisibleResolutionGroups({
    filter: CARI_RESOLUTION_FILTERS.INCOMING,
    groups: snapshot.groups,
    vadeliAccountGroups: snapshot.vadeliAccountGroups,
    faizStopajiGroups: snapshot.faizStopajiGroups,
  });
  assert.equal(visibleCariOnly.length, 0);

  const union = listResolvableResolutionGroups(snapshot);
  assert.ok(
    !union.some((g) => g.partyName === PARTY_UNRESOLVED_LABEL),
    "Karşı taraf tespit edilemedi görünmez"
  );
  assert.ok(union.some((g) => g.partyName === VADELI_ACCOUNT_MISSING_LABEL));
});

test("description-only (alan kaybı) HESAP KAPATMA hâlâ vadeli kovasına gider", () => {
  const row = {
    id: "bare-kapanis",
    hesapKodu: "",
    detayAciklama: "Hesap Kapatma",
    fisAciklama: "Hesap Kapatma",
    borc: 177025.42,
    alacak: 0,
  };
  const snapshot = buildCariResolutionGroups([row], {
    selectedCompany: COMPANY,
    companyPlans: PLANS,
  });
  assert.equal(snapshot.groupCount, 0);
  assert.equal(snapshot.cariMissingCount, 0);
  assert.ok(snapshot.vadeliAccountMissingCount >= 1);
  assertNoPartyUnresolved(snapshot);
});

test("preview UI surface / reanalysis: metrikler + kategori başlığı (browser kabul sözleşmesi)", async () => {
  const legs = [
    ...missingCounterLeg({
      id: "ui-kapanis",
      transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
      description: "Hesap Kapatma",
      missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      vadeliLifecycleRole: "VADELI_KAPANIS",
    }),
    ...missingCounterLeg({
      id: "ui-stopaj",
      transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
      description: "Mevduat Faiz Stopaj",
      missingHesapCategory: MISSING_HESAP_CATEGORY.FAIZ_STOPAJI_HESAP,
      vadeliLifecycleRole: "FAIZ_STOPAJI",
      amount: 12,
    }),
  ];
  const snapshot = buildCariResolutionGroups(legs, {
    selectedCompany: COMPANY,
    companyPlans: PLANS,
  });
  const surface = renderPreviewResolutionSurface(snapshot);

  assert.equal(readMetric(surface.html, "cari-grup"), "0");
  assert.equal(readMetric(surface.html, "cari-bulunamadi"), "0");
  assert.equal(readMetric(surface.html, "virman-adayi"), "0");
  assert.ok(Number(readMetric(surface.html, "vadeli-eksik")) >= 1);
  assert.ok(Number(readMetric(surface.html, "stopaj-eksik")) >= 1);
  assert.ok(surface.headings.includes(VADELI_ACCOUNT_MISSING_LABEL));
  assert.ok(surface.headings.includes(FAIZ_STOPAJI_MISSING_LABEL));
  assert.ok(!surface.headings.includes(PARTY_UNRESOLVED_LABEL));
  assert.ok(!surface.html.includes(PARTY_UNRESOLVED_LABEL));

  // Opsiyonel gerçek browser — kuruluysa çalıştır
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        `<!doctype html><html><body>${surface.html}</body></html>`
      );
      assert.equal(
        await page.locator('[data-metric="cari-grup"]').innerText(),
        "0"
      );
      assert.equal(
        await page.locator('[data-metric="cari-bulunamadi"]').innerText(),
        "0"
      );
      const titles = await page.locator("[data-group-title]").allInnerTexts();
      assert.ok(titles.includes(VADELI_ACCOUNT_MISSING_LABEL));
      assert.ok(!titles.includes(PARTY_UNRESOLVED_LABEL));
    } finally {
      await browser.close();
    }
  } catch (error) {
    if (
      !/Cannot find package 'playwright'|ERR_MODULE_NOT_FOUND/i.test(
        String(error)
      )
    ) {
      throw error;
    }
  }
});

console.log("OK: test-vadeli-preview-ui-routing");
