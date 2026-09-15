/**
 * Hesap planı güncellik metadata + hydrate passthrough.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-account-plan-freshness.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_PLAN_STALE_AFTER_MS,
  buildAccountPlanFreshnessSummary,
  countActiveAccountPlanRows,
  formatAccountPlanUpdatedAt,
  isAccountPlanFreshnessStaleForCompany,
} from "../src/utils/accountPlanFreshness.js";
import { hydrateCompanyAccountPlanFromApi } from "../src/utils/accountPlanHydrate.js";
import { setCompanyAccountPlan } from "../src/utils/companyCenter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const sampleUpload = {
  id: "upload-uuid-1",
  fileName: "mare hesap planı.xlsx",
  originalFileName: "mare hesap planı.xlsx",
  uploadedBy: "yusuf.ozlu",
  uploadedAt: "2026-09-15T14:25:00.000Z",
  activatedAt: "2026-09-15T14:25:00.000Z",
  isActive: true,
  totalRows: 4166,
};

await testAsync("aktif upload metadata hydrate ile taşınır", async () => {
  let storage = {};
  const accounts = [
    { accountCode: "100", accountName: "Kasa", isActive: true },
    { accountCode: "102", accountName: "Banka", isActive: true },
    { accountCode: "900", accountName: "Pasif", isActive: false },
  ];
  const result = await hydrateCompanyAccountPlanFromApi({
    companyId: "mare-id",
    fetchPlan: async () => ({
      source: "api",
      accounts,
      upload: sampleUpload,
      pagination: { planActiveCount: 2, activeCount: 2 },
    }),
    loadStorage: () => storage,
    setPlan: setCompanyAccountPlan,
    saveStorage: (next) => {
      storage = next;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "api");
  assert.equal(result.upload?.id, "upload-uuid-1");
  assert.equal(result.upload?.fileName, "mare hesap planı.xlsx");
  assert.equal(result.upload?.uploadedBy, "yusuf.ozlu");
  assert.equal(result.accountCount, 2);
  assert.equal(countActiveAccountPlanRows(result.accounts), 2);

  const summary = buildAccountPlanFreshnessSummary({
    companyId: "mare-id",
    source: result.source,
    upload: result.upload,
    accounts: result.accounts,
    accountCount: result.accountCount,
  });
  assert.equal(summary.readinessLabel, "Hazır");
  assert.equal(summary.accountCount, 2);
  assert.equal(summary.fileName, "mare hesap planı.xlsx");
  assert.equal(summary.uploadId, "upload-uuid-1");
  assert.equal(summary.uploadedBy, "yusuf.ozlu");
  assert.equal(summary.showApiDates, true);
});

test("firma değişiminde stale metadata kalmaz", () => {
  const summaryA = buildAccountPlanFreshnessSummary({
    companyId: "company-a",
    source: "api",
    upload: sampleUpload,
    accountCount: 10,
  });
  assert.equal(
    isAccountPlanFreshnessStaleForCompany(summaryA, "company-b"),
    true
  );
  assert.equal(
    isAccountPlanFreshnessStaleForCompany(summaryA, "company-a"),
    false
  );
  const loading = buildAccountPlanFreshnessSummary({
    companyId: "company-b",
    status: "loading",
  });
  assert.equal(loading.readinessLabel, "Yükleniyor");
  assert.equal(isAccountPlanFreshnessStaleForCompany(loading, "company-b"), false);
});

test("tarih formatı tr-TR 15.09.2026 17:25", () => {
  // Sabit yerel ofsetten bağımsız: formatAccountPlanUpdatedAt Date kullanır.
  const label = formatAccountPlanUpdatedAt("2026-09-15T14:25:00.000Z");
  assert.match(label, /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
  // Aynı gün/saat parçaları mevcut olmalı (TZ farkında gün kayabilir; pattern yeter)
  const local = new Date("2026-09-15T14:25:00.000Z");
  const expected = formatAccountPlanUpdatedAt(local);
  assert.equal(label, expected);
  assert.equal(
    formatAccountPlanUpdatedAt(
      new Date(2026, 8, 15, 17, 25, 0)
    ),
    "15.09.2026 17:25"
  );
});

test("30 gün uyarısı yalnız uyarıdır", () => {
  const now = Date.parse("2026-09-15T12:00:00.000Z");
  const fresh = buildAccountPlanFreshnessSummary({
    companyId: "x",
    source: "api",
    upload: {
      ...sampleUpload,
      activatedAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    accountCount: 5,
    nowMs: now,
  });
  assert.equal(fresh.isStale, false);
  assert.equal(fresh.staleWarning, null);

  const stale = buildAccountPlanFreshnessSummary({
    companyId: "x",
    source: "api",
    upload: {
      ...sampleUpload,
      activatedAt: new Date(
        now - ACCOUNT_PLAN_STALE_AFTER_MS - 60_000
      ).toISOString(),
    },
    accountCount: 5,
    nowMs: now,
  });
  assert.equal(stale.isStale, true);
  assert.equal(stale.staleWarning, "Hesap planı güncel olmayabilir");
  assert.equal(stale.readinessLabel, "Hazır");
});

test("API / localStorage kaynak etiketi", () => {
  const api = buildAccountPlanFreshnessSummary({
    companyId: "x",
    source: "api",
    upload: sampleUpload,
    accountCount: 3,
  });
  assert.equal(api.sourceLabel, "Sunucu (aktif sürüm)");
  assert.equal(api.showApiDates, true);

  const local = buildAccountPlanFreshnessSummary({
    companyId: "x",
    source: "localStorage",
    upload: sampleUpload,
    accountCount: 3,
  });
  assert.equal(local.sourceLabel, "Yerel önbellek");
  assert.equal(local.showApiDates, false);
  assert.equal(local.updatedAtLabel, null);
  assert.equal(local.fileName, null);
  assert.equal(local.uploadedBy, null);
});

test("hesap sayısı aktif sürümle aynı", () => {
  const accounts = [
    { accountCode: "1", isActive: true },
    { accountCode: "2", isActive: true },
    { accountCode: "3", isActive: false },
  ];
  assert.equal(countActiveAccountPlanRows(accounts), 2);
  const summary = buildAccountPlanFreshnessSummary({
    companyId: "x",
    source: "api",
    upload: { ...sampleUpload, totalRows: 3 },
    accounts,
  });
  assert.equal(summary.accountCount, 2);
});

test("UI: Fiş Dönüştürme + Hesap Planı freshness kartı", () => {
  const fis = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/fis-donusturme/page.jsx"),
    "utf8"
  );
  const plan = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/hesap-plani/page.jsx"),
    "utf8"
  );
  const hydrate = fs.readFileSync(
    path.join(root, "src/utils/accountPlanHydrate.js"),
    "utf8"
  );
  assert.match(fis, /AccountPlanFreshnessCard/);
  assert.match(fis, /displayedAccountPlanFreshness/);
  assert.match(plan, /AccountPlanFreshnessCard/);
  assert.match(plan, /variant=\"detailed\"/);
  assert.match(plan, /Yükleme Geçmişi/);
  assert.match(hydrate, /upload:/);
  assert.match(hydrate, /accountCount/);
});

console.log(`\n${passed} tests passed`);
