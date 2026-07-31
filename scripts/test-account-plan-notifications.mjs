/**
 * Hesap planı 1000+ satır pagination + archive naming + güvenlik sözleşmeleri
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
import {
  ACCOUNT_PLAN_PAGE_CHUNK,
  countAccountsForUpload,
  fetchAllSupabaseRows,
  queryAccountsPage,
} from "@/src/utils/accountPlanQuery.js";
import { formatNotificationBadgeCount } from "@/src/utils/userNotificationsApi.js";
import {
  buildDatedArchiveFileName,
  sanitizeUploadFileName,
} from "@/src/utils/cloudStorage/uploadPolicy.js";
import { classifyUploadTarget } from "@/src/utils/cloudStorage/documentClassify.js";
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

/** In-memory Supabase stub — range truncation doğrular */
function makeMemorySupabase(rows) {
  const store = [...rows];
  return {
    from() {
      const state = {
        filters: [],
        orFilter: null,
        orderAsc: true,
        head: false,
        countExact: false,
        from: 0,
        to: null,
        eq(col, val) {
          state.filters.push({ col, val, op: "eq" });
          return state;
        },
        is(col, val) {
          state.filters.push({ col, val, op: "is" });
          return state;
        },
        or(expr) {
          state.orFilter = expr;
          return state;
        },
        order() {
          return state;
        },
        select(_cols, opts = {}) {
          state.head = Boolean(opts.head);
          state.countExact = opts.count === "exact";
          return state;
        },
        range(from, to) {
          state.from = from;
          state.to = to;
          return state.then ? state : Object.assign(state, thenable(state));
        },
        then(resolve, reject) {
          return thenable(state).then(resolve, reject);
        },
      };

      function applyFilters(list) {
        let out = list;
        for (const f of state.filters) {
          if (f.op === "eq") {
            out = out.filter((r) => r[f.col] === f.val);
          } else if (f.op === "is" && f.val === null) {
            out = out.filter((r) => r[f.col] == null);
          }
        }
        if (state.orFilter) {
          const q = String(state.orFilter);
          const m = q.match(/%([^%]+)%/);
          const needle = (m?.[1] || "").toLocaleLowerCase("tr");
          if (needle) {
            out = out.filter(
              (r) =>
                String(r.account_code || "")
                  .toLocaleLowerCase("tr")
                  .includes(needle) ||
                String(r.account_name || "")
                  .toLocaleLowerCase("tr")
                  .includes(needle)
            );
          }
        }
        out = [...out].sort((a, b) =>
          String(a.account_code).localeCompare(String(b.account_code), "tr")
        );
        return out;
      }

      function thenable(s) {
        return {
          then(resolve) {
            const filtered = applyFilters(store);
            if (s.countExact && s.head) {
              resolve({ count: filtered.length, error: null, data: null });
              return;
            }
            const to = s.to == null ? filtered.length - 1 : s.to;
            const slice = filtered.slice(s.from, to + 1);
            resolve({ data: slice, error: null, count: filtered.length });
          },
        };
      }

      return state;
    },
  };
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

await testAsync("full-plan pagination beyond 1000 (range loop)", async () => {
  assert.equal(ACCOUNT_PLAN_PAGE_CHUNK, 1000);
  const rows = Array.from({ length: 4166 }, (_, i) => ({
    id: `id-${i}`,
    company_id: "mare",
    upload_id: "u1",
    account_code: `9.${String(i).padStart(5, "0")}`,
    account_name: `Hesap ${i}`,
    currency: "TL",
    is_active: i % 11 !== 0,
    deleted_at: null,
  }));
  const supabase = makeMemorySupabase(rows);
  const all = await fetchAllSupabaseRows(supabase, "company_account_plan_accounts", (q) =>
    q.eq("company_id", "mare").eq("upload_id", "u1").is("deleted_at", null)
  );
  assert.equal(all.length, 4166);
  assert.ok(all.length > 1000);

  const counts = await countAccountsForUpload(
    supabase,
    "company_account_plan_accounts",
    "mare",
    "u1"
  );
  assert.equal(counts.total, 4166);
  assert.equal(counts.activeCount + counts.inactiveCount, 4166);
  assert.ok(counts.activeCount > 1000);

  const beyond = await queryAccountsPage(supabase, "company_account_plan_accounts", {
    companyId: "mare",
    uploadId: "u1",
    page: 25,
    pageSize: 50,
    query: "",
  });
  assert.equal(beyond.page, 25);
  assert.equal(beyond.total, 4166);
  assert.equal(beyond.rows.length, 50);
  assert.ok(beyond.rows[0].account_code > rows[999].account_code);

  const searchHit = await queryAccountsPage(supabase, "company_account_plan_accounts", {
    companyId: "mare",
    uploadId: "u1",
    page: 1,
    pageSize: 50,
    query: "9.04100",
  });
  assert.ok(searchHit.total >= 1);
  assert.ok(
    searchHit.rows.some((r) => String(r.account_code).includes("9.04100"))
  );
});

test("dated archive file name + sanitize", () => {
  const when = new Date("2026-07-31T13:45:09");
  const named = buildDatedArchiveFileName("MARE Hesap Planı.xlsx", when);
  assert.equal(named.originalFileName, sanitizeUploadFileName("MARE Hesap Planı.xlsx"));
  assert.match(named.driveFileName, /__2026-07-31_134509\.xlsx$/);
  assert.doesNotMatch(named.driveFileName, /\.\.\//);
});

test("hesap planı Drive klasör sınıflandırması", () => {
  const hit = classifyUploadTarget({ fileName: "hesap_plani_mare.xlsx" });
  assert.equal(hit.targetFolderPath, "01 - Hesap Planı");
  assert.equal(hit.documentType, "hesap_plani");
});

test("duplicate upload + archive_pending sözleşmesi (kaynak)", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/api/account-plans/route.js"),
    "utf8"
  );
  assert.match(src, /fetchAll|loadAllAccountsForUpload|countAccountsForUpload/);
  assert.match(src, /Mükerrer yükleme/);
  assert.match(src, /archive_pending/);
  assert.match(src, /planTotal/);
  assert.doesNotMatch(src, /accounts\.length\)\s*;\s*\n\s*const wantAll/);

  const archiveSrc = fs.readFileSync(
    path.join(process.cwd(), "app/api/account-plans/archive/route.js"),
    "utf8"
  );
  assert.match(archiveSrc, /01 - Hesap Planı/);
  assert.match(archiveSrc, /buildDatedArchiveFileName/);
  assert.match(archiveSrc, /findDriveFileByCompanyContentHash/);
  assert.match(archiveSrc, /archive_pending/);
  assert.match(archiveSrc, /Drive id \/ token asla/);
  const publicFn = archiveSrc.slice(
    archiveSrc.indexOf("function publicArchiveResult"),
    archiveSrc.indexOf("async function patchArchiveSafe")
  );
  assert.doesNotMatch(publicFn, /accessToken|providerFileId|fileId|rootFolderId/);
});

test("Bank Parser full plan hydrate", () => {
  const workbench = fs.readFileSync(
    path.join(
      process.cwd(),
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(workbench, /fetchFullActiveAccountPlan/);

  const api = fs.readFileSync(
    path.join(process.cwd(), "src/utils/accountPlanApi.js"),
    "utf8"
  );
  assert.match(api, /all:\s*true|set\("all", "1"\)/);
  assert.match(api, /fetchFullActiveAccountPlan/);
  assert.match(api, /archiveAccountPlanFile/);
});

test("UI sunucu sayfalama — all:true DOM dump yok", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/(annvero)/muhasebe/hesap-plani/page.jsx"),
    "utf8"
  );
  assert.match(src, /planCounts/);
  assert.match(src, /wipeCompanyUi|setPageAccounts\(\[\]\)/);
  assert.match(src, /fetchActiveAccountPlan\(companyId,\s*\{[\s\S]*page:/);
  assert.doesNotMatch(src, /fetchActiveAccountPlan\(companyId,\s*\{\s*all:\s*true/);
  assert.match(src, /archiveAccountPlanFile/);
  assert.match(src, /Yükleme Geçmişi/);
});

test("API route dosyaları ve migration mevcut", () => {
  const root = process.cwd();
  assert.ok(
    fs.existsSync(
      path.join(root, "supabase/migrations/029_account_plan_uploads_and_user_notifications.sql")
    )
  );
  assert.ok(
    fs.existsSync(
      path.join(root, "supabase/migrations/030_account_plan_drive_archive.sql")
    )
  );
  assert.ok(fs.existsSync(path.join(root, "app/api/account-plans/route.js")));
  assert.ok(fs.existsSync(path.join(root, "app/api/account-plans/uploads/route.js")));
  assert.ok(fs.existsSync(path.join(root, "app/api/account-plans/activate/route.js")));
  assert.ok(fs.existsSync(path.join(root, "app/api/account-plans/archive/route.js")));
  assert.ok(fs.existsSync(path.join(root, "app/api/user-notifications/route.js")));
  assert.ok(fs.existsSync(path.join(root, "src/utils/accountPlanQuery.js")));
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

test("migration 030 forward-only; drop table yok", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/030_account_plan_drive_archive.sql"),
    "utf8"
  );
  assert.match(sql, /archive_status/);
  assert.match(sql, /file_content_hash/);
  assert.match(sql, /original_file_name/);
  assert.doesNotMatch(sql, /\bdrop table\b/i);
  assert.doesNotMatch(sql, /\bdelete from\b/i);
});

console.log("All account-plan-notifications tests passed.");
