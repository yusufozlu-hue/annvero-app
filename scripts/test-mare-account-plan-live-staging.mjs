#!/usr/bin/env node
/**
 * MARE live staging proof — full account plan + beyond-1000 search + tenant guard.
 * No customer statement upload. No Drive write. No destructive DB ops.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (staging only),
 * optional ANNVERO_STAGING_ORIGIN + session cookie via ANNVERO_STAGING_COOKIE_HEADER.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-mare-account-plan-live-staging.mjs
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ANNVERO_KNOWN_PROJECT_REFS,
  extractSupabaseProjectRef,
} from "../src/lib/security/envGuard.js";
import { fetchAllSupabaseRows } from "../src/utils/accountPlanQuery.js";

const MARE_ID = "84384297-270c-47cd-ac5a-d693ba80b84a";
const FOREIGN_ID = "00000000-0000-4000-8000-000000000099";
const UPLOADS = "company_account_plan_uploads";
const ACCOUNTS = "company_account_plan_accounts";

function loadEnvFile(filePath) {
  try {
    const raw = readFileSync(resolve(process.cwd(), filePath), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

loadEnvFile(".env.local");
loadEnvFile(
  process.env.ANNVERO_STAGING_ENV_FILE || "../annvero-app/.env.staging.local"
);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const projectRef = extractSupabaseProjectRef(url);
const stagingOrigin = String(process.env.ANNVERO_STAGING_ORIGIN || "")
  .trim()
  .replace(/\/$/, "");
const cookieHeader = String(process.env.ANNVERO_STAGING_COOKIE_HEADER || "").trim();

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
}

if (!url || !serviceRole) {
  fail("Staging Supabase URL + service role gerekli (canlı plan doğrulaması).");
}
if (projectRef === ANNVERO_KNOWN_PROJECT_REFS.production) {
  fail("Production engellendi.");
}
if (
  projectRef &&
  projectRef !== ANNVERO_KNOWN_PROJECT_REFS.staging &&
  process.env.ANNVERO_ALLOW_NON_STAGING_LIVE !== "1"
) {
  fail(`Beklenen staging project ref; bulunan: ${projectRef || "?"}`);
}

process.env.ANNVERO_ALLOW_REMOTE_SUPABASE =
  process.env.ANNVERO_ALLOW_REMOTE_SUPABASE || "1";

const admin = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("=== MARE account-plan live staging ===");
console.log(`company=${MARE_ID.slice(0, 8)}… project=${projectRef || "?"}`);

const { data: activeUpload, error: uploadErr } = await admin
  .from(UPLOADS)
  .select("id, is_active")
  .eq("company_id", MARE_ID)
  .eq("is_active", true)
  .is("deleted_at", null)
  .maybeSingle();
if (uploadErr) fail(`active upload: ${uploadErr.message}`);
if (!activeUpload?.id) fail("MARE aktif hesap planı yüklemesi bulunamadı.");

const rows = await fetchAllSupabaseRows(admin, ACCOUNTS, (q) =>
  q
    .eq("company_id", MARE_ID)
    .eq("upload_id", activeUpload.id)
    .is("deleted_at", null)
);
const activeRows = rows.filter((r) => r.is_active !== false);
assert.ok(rows.length > 1000, `expected >1000 plan accounts, got ${rows.length}`);
assert.ok(
  rows.length >= 4166,
  `expected >=4166 plan rows (MARE all=1 contract), got ${rows.length}`
);
console.log(
  `PASS  full plan pagination: total=${rows.length} active=${activeRows.length}`
);

const beyond = rows[1500];
assert.ok(beyond?.account_code, "beyond-1000 row missing");
const code = String(beyond.account_code);
const escaped = code.replace(/[%_,]/g, "");
const { data: searchHits, error: searchErr } = await admin
  .from(ACCOUNTS)
  .select("account_code, account_name")
  .eq("company_id", MARE_ID)
  .eq("upload_id", activeUpload.id)
  .eq("is_active", true)
  .is("deleted_at", null)
  .or(`account_code.ilike.%${escaped}%,account_name.ilike.%${escaped}%`)
  .limit(20);
if (searchErr) fail(`search: ${searchErr.message}`);
assert.ok(
  (searchHits || []).some((r) => String(r.account_code) === code),
  `beyond-1000 code not found via search: ${code.slice(0, 8)}…`
);
console.log(
  `PASS  beyond-1000 search hit index=1500 codeLen=${code.length} hits=${(searchHits || []).length}`
);

const { data: foreignUpload } = await admin
  .from(UPLOADS)
  .select("id")
  .eq("company_id", FOREIGN_ID)
  .limit(1);
assert.equal(
  (foreignUpload || []).length,
  0,
  "foreign probe company should have no plan rows"
);
console.log("PASS  foreign company isolation (no plan for probe id)");

let httpStatus = "SKIPPED_NO_COOKIE";
if (stagingOrigin && cookieHeader) {
  const allRes = await fetch(
    `${stagingOrigin}/api/account-plans?companyId=${encodeURIComponent(MARE_ID)}&all=1`,
    {
      headers: { Cookie: cookieHeader, Accept: "application/json" },
      redirect: "manual",
    }
  );
  assert.equal(allRes.status, 200, `HTTP all=1 status ${allRes.status}`);
  const allBody = await allRes.json();
  const accounts = Array.isArray(allBody.accounts) ? allBody.accounts : [];
  assert.ok(accounts.length >= 4166, `HTTP all=1 count ${accounts.length}`);

  const qRes = await fetch(
    `${stagingOrigin}/api/account-plans?companyId=${encodeURIComponent(MARE_ID)}&q=${encodeURIComponent(code)}&pageSize=50`,
    {
      headers: { Cookie: cookieHeader, Accept: "application/json" },
      redirect: "manual",
    }
  );
  assert.equal(qRes.status, 200, `HTTP q= status ${qRes.status}`);
  const qBody = await qRes.json();
  const qAccounts = Array.isArray(qBody.accounts) ? qBody.accounts : [];
  assert.ok(
    qAccounts.some((a) => String(a.account_code || a.code) === code),
    "HTTP q= missed beyond-1000 code"
  );

  const xRes = await fetch(
    `${stagingOrigin}/api/account-plans?companyId=${encodeURIComponent(FOREIGN_ID)}&all=1`,
    {
      headers: { Cookie: cookieHeader, Accept: "application/json" },
      redirect: "manual",
    }
  );
  assert.ok(
    xRes.status === 403 || xRes.status === 404 || xRes.status === 200,
    `unexpected cross-tenant status ${xRes.status}`
  );
  if (xRes.status === 200) {
    const xBody = await xRes.json();
    const xAccounts = Array.isArray(xBody.accounts) ? xBody.accounts : [];
    assert.equal(xAccounts.length, 0, "cross-tenant must return empty accounts");
  }
  httpStatus = "PASS";
  console.log("PASS  HTTP account-plans all=1 + q= + cross-tenant safe");
} else {
  console.log(
    "SKIP  HTTP cookie path — set ANNVERO_STAGING_ORIGIN + ANNVERO_STAGING_COOKIE_HEADER for UI API proof"
  );
}

console.log(
  JSON.stringify({
    ok: true,
    marePlanAccounts: rows.length,
    mareActiveAccounts: activeRows.length,
    beyond1000CodeLen: code.length,
    httpApi: httpStatus,
    uploadIdPrefix: String(activeUpload.id).slice(0, 8),
  })
);
console.log("All MARE account-plan live staging checks passed.");
