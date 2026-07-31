/**
 * Hesap planı UI helpers + bildirim rozet + yükleme kuralları
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-account-plan-notifications.mjs
 */
import assert from "node:assert/strict";
import {
  diffAccountPlanVersions,
  fingerprintAccountPlanAccounts,
  formatAccountPlanUploadStatus,
  paginateAccountPlanRows,
  parseAccountPlanSheetRows,
  EMPTY_ACCOUNT_PLAN_MESSAGE,
} from "@/src/utils/accountPlanUpload.js";
import { formatNotificationBadgeCount } from "@/src/utils/userNotificationsApi.js";
import fs from "node:fs";
import path from "node:path";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

test("4.167 hesap sayfalama — tek sayfada DOM budjeti", () => {
  const rows = Array.from({ length: 4167 }, (_, i) => ({
    id: `id-${i}`,
    accountCode: String(1000 + (i % 9000)),
    accountName: `Hesap ${i}`,
    currency: "TL",
    isActive: i % 7 !== 0,
  }));
  const page = paginateAccountPlanRows(rows, { page: 1, pageSize: 50, query: "" });
  assert.equal(page.total, 4167);
  assert.equal(page.rows.length, 50);
  assert.ok(page.pageCount > 80);
  assert.ok(page.activeCount + page.inactiveCount === 4167);
});

test("arama filtreler; sayfa reset mantığı", () => {
  const rows = [
    { accountCode: "100", accountName: "Kasa", isActive: true },
    { accountCode: "120", accountName: "Alıcılar", isActive: true },
    { accountCode: "320", accountName: "Satıcılar", isActive: false },
  ];
  const hit = paginateAccountPlanRows(rows, { page: 1, pageSize: 50, query: "satıcı" });
  assert.equal(hit.total, 1);
  assert.equal(hit.rows[0].accountCode, "320");
});

test("boş plan mesajı", () => {
  assert.equal(EMPTY_ACCOUNT_PLAN_MESSAGE, "Bu firmanın hesap planı tanımlı değil.");
});

await testAsync("fingerprint kararlı; diff sayıları", async () => {
  const a = [
    { accountCode: "100", accountName: "Kasa", currency: "TL", isActive: true },
    { accountCode: "120", accountName: "Alıcılar", currency: "TL", isActive: true },
  ];
  const b = [
    { accountCode: "100", accountName: "Kasa", currency: "TL", isActive: true },
    { accountCode: "120", accountName: "Alıcılar X", currency: "TL", isActive: true },
    { accountCode: "320", accountName: "Satıcılar", currency: "TL", isActive: true },
  ];
  const f1 = await fingerprintAccountPlanAccounts(a);
  const f2 = await fingerprintAccountPlanAccounts([...a].reverse());
  assert.equal(f1, f2);
  const diff = diffAccountPlanVersions(a, b);
  assert.equal(diff.addedCount, 1);
  assert.equal(diff.updatedCount, 1);
  assert.equal(diff.skippedCount, 1);
});

test("parse sheet — header/gürültü ve hatalı satır", () => {
  const { accounts, errorCount } = parseAccountPlanSheetRows([
    ["Hesap Kodu", "Hesap Adı", "PB"],
    ["100", "Kasa", "TL"],
    ["", "", ""],
    ["bad-only-code", "", "TL"],
  ]);
  assert.equal(accounts.length, 1);
  assert.ok(errorCount >= 1);
});

test("yükleme durum etiketleri", () => {
  assert.match(
    formatAccountPlanUploadStatus("duplicate"),
    /Mükerrer yükleme/
  );
  assert.equal(formatAccountPlanUploadStatus("active"), "Aktif sürüm");
});

test("bildirim rozet 0/1/99/100+", () => {
  assert.equal(formatNotificationBadgeCount(0), null);
  assert.equal(formatNotificationBadgeCount(1), "1");
  assert.equal(formatNotificationBadgeCount(99), "99");
  assert.equal(formatNotificationBadgeCount(100), "99+");
  assert.equal(formatNotificationBadgeCount(250), "99+");
});

test("API route dosyaları ve migration mevcut", () => {
  const root = process.cwd();
  assert.ok(
    fs.existsSync(
      path.join(root, "supabase/migrations/029_account_plan_uploads_and_user_notifications.sql")
    )
  );
  assert.ok(fs.existsSync(path.join(root, "app/api/account-plans/route.js")));
  assert.ok(fs.existsSync(path.join(root, "app/api/account-plans/uploads/route.js")));
  assert.ok(fs.existsSync(path.join(root, "app/api/account-plans/activate/route.js")));
  assert.ok(fs.existsSync(path.join(root, "app/api/user-notifications/route.js")));
});

test("Topbar artık pending transaction count kullanmıyor", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/components/AnnveroTopbar.jsx"),
    "utf8"
  );
  assert.doesNotMatch(src, /fetchPendingTransactionCount/);
  assert.match(src, /fetchUnreadNotificationCount/);
  assert.match(src, /formatNotificationBadgeCount/);
  assert.match(src, /markAllNotificationsRead/);
});

test("Hesap planı sayfası kompakt kolonlar + firma değişiminde sıfırlama", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/(annvero)/muhasebe/hesap-plani/page.jsx"),
    "utf8"
  );
  assert.match(src, /Hesap Kodu/);
  assert.match(src, /Yükleme Geçmişi/);
  assert.match(src, /selectedCompanyId/);
  assert.match(src, /setAllAccounts\(\[\]\)/);
  assert.match(src, /ROW_HEIGHT/);
  assert.match(src, /paginateAccountPlanRows|visibleRows/);
});

test("account-plans API yönetim + company access kalıpları", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/api/account-plans/route.js"),
    "utf8"
  );
  assert.match(src, /requireManagementApi/);
  assert.match(src, /assertCompanyAccess/);
  assert.match(src, /requireAuthenticatedApi/);
  assert.match(src, /Mükerrer yükleme/);
  assert.match(src, /is_active: false/);
});

test("user-notifications ownership 403", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/api/user-notifications/route.js"),
    "utf8"
  );
  assert.match(src, /user_id !== userId/);
  assert.match(src, /status: 403/);
  assert.match(src, /dedupe_key|dedupeKey/);
  assert.match(src, /markAllRead/);
});

console.log("All account-plan-notifications tests passed.");
