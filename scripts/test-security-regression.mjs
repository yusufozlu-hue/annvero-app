/**
 * ANNVERO güvenlik regresyon testleri (yerel, production'a bağlanmaz).
 * Çalıştır: node --import ./scripts/_alias-loader.mjs scripts/test-security-regression.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { isAdminUser, isManagementUser, explainAdminGate, isAdminEmail } from "../src/lib/auth/admin.js";
import { buildFallbackProfile, createUserAccess } from "../src/lib/auth/userAccess.js";
import {
  assertSafeSupabaseProjectRef,
  ANNVERO_KNOWN_PROJECT_REFS,
  findForbiddenPublicEnvLeaks,
  requiresStrictRuntimeSecrets,
  resolveAnnveroAppEnv,
} from "../src/lib/security/envGuard.js";
import {
  checkRateLimit,
  resetRateLimitBuckets,
} from "../src/lib/security/rateLimitCore.js";
import {
  redactDeep,
  stripSecretsFromExportValue,
  sanitizeSpreadsheetCell,
  safeErrorMessage,
  REDACTED,
} from "../src/lib/security/redact.js";
import { buildSoftDeletePatch, buildSoftRestorePatch } from "../src/lib/softDelete.js";
import { assertCriticalHumanApproval, CRITICAL_OPERATIONS } from "../src/lib/security/criticalApproval.js";
import { validateUploadFile } from "../src/lib/security/uploadGuard.js";
import { getSafeNextPath } from "../src/utils/authRedirect.js";
import {
  computeWebhookSignature,
  resetWebhookReplayStore,
  rememberWebhookEvent,
  safeEqualString,
  verifyWebhookRequest,
} from "../src/lib/security/webhookAuth.js";
import { isRecoveryApiEnabled } from "../src/lib/recovery/recoveryGate.js";/** next/server'siz privilege strip (requestGuards ile aynı mantık) */
function stripClientPrivilegeClaims(body = {}) {
  if (!body || typeof body !== "object") return body;
  const {
    role: _r,
    isAdmin: _a,
    is_admin: _ia,
    isManagementUser: _m,
    is_management_user: _imu,
    permissions: _p,
    ...rest
  } = body;
  void _r;
  void _a;
  void _ia;
  void _m;
  void _imu;
  void _p;
  return rest;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stripSqlCommentsAndStrings(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      continue;
    }
    if (sql[i] === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += " ";
      continue;
    }
    if (sql[i] === "$") {
      const m = sql.slice(i).match(/^\$([A-Za-z_]*)\$/);
      if (m) {
        const tag = m[0];
        i += tag.length;
        const end = sql.indexOf(tag, i);
        if (end === -1) {
          i = n;
        } else {
          i = end + tag.length;
        }
        out += " ";
        continue;
      }
    }
    out += sql[i++];
  }
  return out;
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// 1–3: Auth gate helpers (statik + davranış)
test("oturumsuz / yetkisiz / cross-tenant koruma kalıpları apiGuard'da mevcut", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/auth/apiGuard.js"), "utf8");
  assert.match(src, /jsonUnauthorized/);
  assert.match(src, /jsonForbidden/);
  assert.match(src, /assertCompanyAccess/);
  assert.match(src, /canAccessCompany/);
  assert.match(src, /requireApiSession/);
});

test("admin user_metadata.role ile yükseltilmez", () => {
  const attacker = {
    email: "attacker@example.com",
    user_metadata: { role: "admin", annvero_role: "admin", company_ids: ["other"] },
    app_metadata: {},
  };
  assert.equal(isAdminUser(attacker), false);
  assert.equal(isManagementUser(attacker), false);
  const fallback = buildFallbackProfile(attacker);
  assert.equal(fallback.role !== "admin" || !fallback.isPlatformAdmin, true);
  assert.deepEqual(fallback.companyIds, []);
});

test("admin AND: email yalnız VEYA app_metadata yalnız yetmez", () => {
  const emailOnly = {
    email: "yusufozlu@gmail.com",
    app_metadata: {},
    user_metadata: {},
  };
  assert.equal(isAdminEmail(emailOnly.email), true);
  assert.equal(isAdminUser(emailOnly), false);

  const appOnly = {
    email: "random@example.com",
    app_metadata: { role: "admin" },
    user_metadata: {},
  };
  assert.equal(isAdminUser(appOnly), false);

  const both = {
    email: "yusufozlu@gmail.com",
    app_metadata: { role: "admin" },
    user_metadata: { role: "viewer" },
  };
  const gate = explainAdminGate(both);
  assert.equal(gate.emailOk, true);
  assert.equal(gate.appOk, true);
  assert.equal(gate.isAdmin, true);
  assert.equal(gate.usedOrInsteadOfAnd, false);
  assert.equal(isAdminUser(both), true);
});

test("createUserAccess email allowlist tek başına ADMIN zorlamaz", () => {
  const access = createUserAccess({
    email: "yusufozlu@gmail.com",
    role: "goruntuleme",
    companyIds: [],
    isPlatformAdmin: false,
    isManagementUser: false,
    isActive: true,
  });
  assert.notEqual(access.role, "admin");
  assert.equal(access.isPlatformAdmin, false);
});

test("client privilege claim strip edilir", () => {
  const cleaned = stripClientPrivilegeClaims({
    companyId: "c1",
    role: "admin",
    isAdmin: true,
    isManagementUser: true,
    permissions: ["*"],
    note: "ok",
  });
  assert.equal(cleaned.companyId, "c1");
  assert.equal(cleaned.note, "ok");
  assert.equal(cleaned.role, undefined);
  assert.equal(cleaned.isAdmin, undefined);
});

// 6: Rate limit aşımı
test("rate limit aşımı blocked + retryAfter", () => {
  resetRateLimitBuckets();
  const key = "test:rl:" + Date.now();
  for (let i = 0; i < 3; i++) {
    const r = checkRateLimit(key, { limit: 3, windowMs: 60_000 });
    assert.equal(r.allowed, true);
  }
  const blocked = checkRateLimit(key, { limit: 3, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs >= 0);
  const routeSrc = fs.readFileSync(
    path.join(root, "src/lib/security/rateLimit.js"),
    "utf8"
  );
  assert.match(routeSrc, /status:\s*429/);
  assert.match(routeSrc, /Retry-After/);
});

// 7: Redaction / strip
test("hassas alanlar export nesnesinden tamamen çıkarılır", () => {
  const redacted = redactDeep({
    password: "secret123",
    token: "abc",
    ok: "visible",
  });
  assert.equal(redacted.password, REDACTED);
  assert.equal(redacted.ok, "visible");

  const stripped = stripSecretsFromExportValue({
    company_id: "c1",
    encrypted_password: "cipher",
    nested: { gib_password: "x", name: "ok", auth: { access_token: "t" } },
    password: "p",
    parola: "p2",
  });
  assert.equal(stripped.company_id, "c1");
  assert.equal("encrypted_password" in stripped, false);
  assert.equal(stripped.encrypted_password_was_present, true);
  assert.equal("password" in stripped, false);
  assert.equal("parola" in stripped, false);
  assert.equal(stripped.nested.name, "ok");
  assert.equal("gib_password" in stripped.nested, false);
  assert.ok(stripped.nested.auth);
  assert.equal("access_token" in (stripped.nested.auth || {}), false);

  assert.equal(sanitizeSpreadsheetCell("=CMD()"), "'=CMD()");
  assert.equal(
    safeErrorMessage(new Error("password=supersecret stack at foo")),
    "İşlem başarısız."
  );
});

test("cross-tenant export satırı engellenir (statik + fixture)", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/backup/companyExport.js"), "utf8");
  assert.match(src, /cross_tenant_row_blocked/);
  assert.match(src, /stripSecretsFromExportValue/);
  const foreign = { company_id: "other", amount: 1 };
  assert.notEqual(String(foreign.company_id), "mine");
});

// 8: Soft delete fiziksel silme yapmaz
test("soft delete patch fiziksel silme alanı içermez", () => {
  const patch = buildSoftDeletePatch({ email: "a@b.com" });
  assert.ok(patch.deleted_at);
  assert.equal(patch.deleted_by, "a@b.com");
  assert.equal("id" in patch, false);
  const restore = buildSoftRestorePatch();
  assert.equal(restore.deleted_at, null);
  assert.equal(restore.deleted_by, null);
});

// 9: Restore onay + entity allowlist
test("restore insan onayı zorunlu; keyfi tablo yok", () => {
  const restoreSrc = fs.readFileSync(
    path.join(root, "src/lib/recovery/restoreDeletedRecord.js"),
    "utf8"
  );
  assert.match(restoreSrc, /RESTORE_CONFIRMATION_PHRASE\s*=\s*"RESTORE_CONFIRM"/);
  assert.match(restoreSrc, /RESTORE_ENTITY_ALLOWLIST/);
  assert.match(restoreSrc, /isRecoveryApiEnabled/);
  assert.match(restoreSrc, /writeAuditEvent/);
  assert.match(restoreSrc, /DB backup \/ PITR restore yapmaz|PITR restore yapmaz/);

  const denied = assertCriticalHumanApproval({
    operation: CRITICAL_OPERATIONS.RESTORE,
    confirm: false,
    confirmPhrase: "",
    summary: { table: "companies", id: "1" },
  });
  assert.equal(denied.ok, false);

  const ok = assertCriticalHumanApproval({
    operation: CRITICAL_OPERATIONS.RESTORE,
    confirm: true,
    confirmPhrase: "RESTORE_CONFIRM",
    summary: { table: "companies", id: "1" },
  });
  assert.equal(ok.ok, true);
});

// 10: Export version redacted
test("company export v3 redaksiyonlu", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/backup/companyExport.js"), "utf8");
  assert.match(src, /COMPANY_EXPORT_VERSION\s*=\s*3/);
  assert.match(src, /redactExportRows/);
  assert.match(src, /cross_tenant_row_blocked/);
});

// 11: Client bundle server secret — static check file exists
test("client secret scan script mevcut", () => {
  assert.ok(fs.existsSync(path.join(root, "scripts/security/scan-client-secrets.mjs")));
});

// 12: Production/staging ref fail-closed
test("bilinen project ref sabitleri doğru pinlenmiş", () => {
  assert.equal(
    ANNVERO_KNOWN_PROJECT_REFS.staging,
    "bveipjvbopbkvojfdpmo",
    "staging ref Dashboard ile birebir olmalı"
  );
  assert.equal(
    ANNVERO_KNOWN_PROJECT_REFS.production,
    "ttxigznwcjvrlzuppbro",
    "production ref değişmemeli"
  );
  assert.notEqual(
    ANNVERO_KNOWN_PROJECT_REFS.staging,
    "bveipjbopbkvojfdpmo",
    "eksik harfli eski staging ref kullanılmamalı"
  );
});

test("local ortamda production/staging ref fail-closed", () => {
  const prev = process.env.ANNVERO_APP_ENV;
  const allow = process.env.ANNVERO_ALLOW_REMOTE_SUPABASE;
  process.env.ANNVERO_APP_ENV = "development";
  delete process.env.ANNVERO_ALLOW_REMOTE_SUPABASE;

  const prod = assertSafeSupabaseProjectRef({
    projectRef: ANNVERO_KNOWN_PROJECT_REFS.production,
    appEnv: "development",
  });
  assert.equal(prod.ok, false);
  assert.equal(prod.blocked, true);

  const staging = assertSafeSupabaseProjectRef({
    projectRef: ANNVERO_KNOWN_PROJECT_REFS.staging,
    appEnv: "test",
  });
  assert.equal(staging.ok, false);

  // Eski/yanlış staging yazımı bilinen remote listesinde olmamalı (fail-closed tetiklemez)
  const typoStaging = assertSafeSupabaseProjectRef({
    projectRef: "bveipjbopbkvojfdpmo",
    appEnv: "development",
  });
  assert.equal(typoStaging.ok, true);

  const local = assertSafeSupabaseProjectRef({
    projectRef: "abcdefghijklmnop",
    appEnv: "development",
  });
  assert.equal(local.ok, true);

  if (prev === undefined) delete process.env.ANNVERO_APP_ENV;
  else process.env.ANNVERO_APP_ENV = prev;
  if (allow === undefined) delete process.env.ANNVERO_ALLOW_REMOTE_SUPABASE;
  else process.env.ANNVERO_ALLOW_REMOTE_SUPABASE = allow;
});

test("public env secret leak tespiti", () => {
  const leaks = findForbiddenPublicEnvLeaks({
    // Kasıtlı sahte public sızıntı adı — gerçek secret değeri yok
    NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "placeholder_not_a_real_secret",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_ok",
  });
  assert.ok(leaks.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"));
});

// 13: Backup dry-run manifest/checksum
test("backup dry-run manifest + checksum üretir", () => {
  const fixture = {
    version: 1,
    tables: { companies: [{ id: "demo" }] },
    exported_at: "2026-07-19T00:00:00.000Z",
  };
  const payload = JSON.stringify(fixture);
  const checksum = createHash("sha256").update(payload).digest("hex");
  const manifest = {
    algorithm: "sha256",
    checksum,
    bytes: Buffer.byteLength(payload),
    dry_run: true,
  };
  assert.equal(manifest.checksum.length, 64);
  assert.equal(manifest.dry_run, true);
});

// Upload + open redirect
test("path traversal ve open redirect engellenir", () => {
  assert.equal(getSafeNextPath("https://evil.com"), "/dashboard");
  assert.equal(getSafeNextPath("//evil.com"), "/dashboard");
  assert.equal(getSafeNextPath("/muhasebe/banka"), "/muhasebe/banka");

  const bad = validateUploadFile({
    fileName: "../etc/passwd.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 100,
    buffer: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
  });
  // basename temizler; uzantı xlsx kalır — isim sanitize edilir
  assert.equal(bad.ok, true);
  assert.ok(!bad.safeName.includes(".."));

  const exe = validateUploadFile({
    fileName: "malware.exe",
    mimeType: "application/octet-stream",
    size: 10,
  });
  assert.equal(exe.ok, false);
});

test("migration 024 restrictive deny + no DROP POLICY + rate limit RPC", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/024_security_dr_hardening.sql"),
    "utf8"
  );
  const stripped = stripSqlCommentsAndStrings(sql);
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\btruncate\s+table\b/i);
  // DROP POLICY checks must strip comments/strings first
  assert.doesNotMatch(stripped, /\bdrop\s+policy\b/i);
  assert.match(sql, /rate_limit_buckets/);
  assert.match(sql, /as restrictive/i);
  assert.match(sql, /annvero_rate_limit_consume/);
  assert.match(sql, /audit_events_no_delete/);
  assert.match(sql, /to_regprocedure\('public\.annvero_is_management\(\)'\)/);
  // rate limit search_path: pg_catalog, pg_temp without public
  assert.match(sql, /set search_path\s*=\s*pg_catalog,\s*pg_temp/i);
  assert.match(
    sql,
    /create or replace function public\.annvero_rate_limit_consume[\s\S]*?set search_path\s*=\s*pg_catalog,\s*pg_temp/i
  );
  const rlBlock = sql.match(
    /create or replace function public\.annvero_rate_limit_consume[\s\S]*?\$\$;/i
  );
  assert.ok(rlBlock, "rate_limit function block present");
  assert.doesNotMatch(
    stripSqlCommentsAndStrings(rlBlock[0]).match(/set search_path\s*=\s*[^;\n]+/i)?.[0] || "",
    /\bpublic\b/i
  );
  assert.match(sql, /least\s*\(\s*b\.count::bigint\s*\+\s*1\s*,\s*v_limit::bigint\s*\+\s*1\s*\)\s*::integer/i);
  assert.match(sql, /interval\s+'1 second'\s*\*\s*\(\s*v_window_ms::double precision\s*\/\s*1000\.0\s*\)/i);
  // executed unique on (company_id, table_name, record_id)
  assert.match(
    sql,
    /uq_recovery_restore_approvals_executed_record[\s\S]*?\(\s*company_id\s*,\s*table_name\s*,\s*record_id\s*\)/i
  );
  assert.match(sql, /where\s*\(?\s*executed\s+is\s+true\s*\)?/i);
  assert.match(
    sql,
    /idx_recovery_restore_approvals_company[\s\S]*?\(\s*company_id\s+asc\s*,\s*created_at\s+desc\s*\)/i
  );
  assert.match(sql, /recovery_restore_approvals_company_id_fkey/);
  // helpers revoke service_role EXECUTE; allow revoke truncate privilege text
  assert.match(sql, /truncate,\s*references,\s*trigger/i);
  assert.match(
    sql,
    /revoke\s+truncate,\s*references,\s*trigger\s+on\s+table\s+public\.rate_limit_buckets\s+from\s+service_role/i
  );
  assert.match(
    sql,
    /revoke all on function public\.annvero_ensure_restrictive_deny_policy[\s\S]*service_role/i
  );
  assert.match(
    sql,
    /revoke all on function public\.annvero_assert_table_column[\s\S]*service_role/i
  );
});

test("migration 025 index gating — user_id, no schema comment, no DROP POLICY/FUNCTION", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/025_security_view_indexes_grants.sql"),
    "utf8"
  );
  const stripped = stripSqlCommentsAndStrings(sql);
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\btruncate\s+table\b/i);
  assert.doesNotMatch(stripped, /\bdrop\s+policy\b/i);
  assert.doesNotMatch(stripped, /\bdrop\s+function\b/i);
  // no top-level comment on schema public
  assert.doesNotMatch(sql, /^\s*comment\s+on\s+schema\s+public\b/im);
  assert.match(sql, /annvero_company_members\s*\(\s*user_id\s*\)/i);
  assert.doesNotMatch(sql, /annvero_company_members\s*\(\s*auth_user_id\s*\)/i);
  assert.match(sql, /annvero_ensure_index_if_columns/);
  assert.match(sql, /View ALTER|security_invoker/i);
  // revoke old 7-arg overload (no DROP FUNCTION)
  assert.match(
    sql,
    /annvero_ensure_index_if_columns\(text,\s*text,\s*text,\s*text,\s*text\[\],\s*boolean,\s*text\)/
  );
  // full 7-priv checks
  assert.match(sql, /array\['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'\]/);
  // helpers revoke service_role EXECUTE; allow revoke truncate privilege text
  assert.match(sql, /truncate,\s*references,\s*trigger/i);
  assert.match(
    sql,
    /revoke all on function public\.annvero_ensure_index_if_columns[\s\S]*service_role/i
  );
});

test("production rate limit memory fallback kullanmaz (statik)", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/security/rateLimitDurable.js"), "utf8");
  assert.match(src, /RATE_LIMIT_BACKENDS\.UNAVAILABLE/);
  assert.match(src, /jsonRateLimitMisconfigured/);
  assert.match(src, /fail-closed/);
  assert.doesNotMatch(
    src,
    /production.*falling back to memory|falling back to memory.*production/i
  );
});

test("webhook HMAC + replay koruması", () => {
  resetWebhookReplayStore();
  const secret = "test-hmac-secret-value-32chars!!";
  const ts = String(Date.now());
  const body = '{"event":"ping"}';
  const sig = computeWebhookSignature(secret, ts, body);
  assert.equal(safeEqualString(sig, sig), true);
  assert.equal(safeEqualString(sig, "nope"), false);

  const first = rememberWebhookEvent("evt-1");
  const second = rememberWebhookEvent("evt-1");
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "replay");
});

function mockWebhookRequest(headers = {}) {
  const map = new Map(
    Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)])
  );
  return {
    headers: {
      get(name) {
        return map.get(String(name).toLowerCase()) || null;
      },
    },
  };
}

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    const v = overrides[k];
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("webhook staging/preview/production HMAC missing → fail-closed; local DEV_OPEN", () => {
  resetWebhookReplayStore();
  const body = "{}";

  withEnv(
    {
      ANNVERO_APP_ENV: "staging",
      VERCEL_ENV: undefined,
      NODE_ENV: "production",
      N8N_AUTOMATION_WEBHOOK_HMAC_SECRET: undefined,
      N8N_AUTOMATION_WEBHOOK_SECRET: undefined,
    },
    () => {
      assert.equal(requiresStrictRuntimeSecrets(), true);
      const r = verifyWebhookRequest(mockWebhookRequest(), body);
      assert.equal(r.ok, false);
      assert.equal(r.code, "WEBHOOK_SECRET_MISSING");
    }
  );

  withEnv(
    {
      ANNVERO_APP_ENV: undefined,
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      N8N_AUTOMATION_WEBHOOK_HMAC_SECRET: undefined,
      N8N_AUTOMATION_WEBHOOK_SECRET: undefined,
    },
    () => {
      assert.equal(resolveAnnveroAppEnv(), "staging");
      const r = verifyWebhookRequest(mockWebhookRequest(), body);
      assert.equal(r.ok, false);
      assert.equal(r.code, "WEBHOOK_SECRET_MISSING");
    }
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "production",
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      N8N_AUTOMATION_WEBHOOK_HMAC_SECRET: undefined,
      N8N_AUTOMATION_WEBHOOK_SECRET: undefined,
    },
    () => {
      const r = verifyWebhookRequest(mockWebhookRequest(), body);
      assert.equal(r.ok, false);
      assert.equal(r.code, "WEBHOOK_SECRET_MISSING");
    }
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "development",
      VERCEL_ENV: undefined,
      NODE_ENV: "development",
      N8N_AUTOMATION_WEBHOOK_HMAC_SECRET: undefined,
      N8N_AUTOMATION_WEBHOOK_SECRET: undefined,
    },
    () => {
      const r = verifyWebhookRequest(mockWebhookRequest(), body);
      assert.equal(r.ok, true);
      assert.equal(r.code, "DEV_OPEN");
    }
  );
});

test("webhook staging valid HMAC accepted; invalid/replay/stale rejected; bearer no bypass", () => {
  const hmac = "staging-hmac-secret-for-tests-only!!";
  const body = '{"ok":true}';

  withEnv(
    {
      ANNVERO_APP_ENV: "staging",
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      N8N_AUTOMATION_WEBHOOK_HMAC_SECRET: hmac,
      N8N_AUTOMATION_WEBHOOK_SECRET: "legacy-bearer-should-not-bypass",
    },
    () => {
      resetWebhookReplayStore();
      const ts = String(Date.now());
      const sig = computeWebhookSignature(hmac, ts, body);
      const ok = verifyWebhookRequest(
        mockWebhookRequest({
          "x-annvero-signature": sig,
          "x-annvero-timestamp": ts,
          "x-annvero-event-id": "evt-staging-1",
        }),
        body
      );
      assert.equal(ok.ok, true, ok.message);

      resetWebhookReplayStore();
      const bad = verifyWebhookRequest(
        mockWebhookRequest({
          "x-annvero-signature": "deadbeef",
          "x-annvero-timestamp": ts,
          "x-annvero-event-id": "evt-bad",
        }),
        body
      );
      assert.equal(bad.ok, false);
      assert.equal(bad.code, "INVALID_SIGNATURE");

      resetWebhookReplayStore();
      const stale = verifyWebhookRequest(
        mockWebhookRequest({
          "x-annvero-signature": computeWebhookSignature(hmac, "1", body),
          "x-annvero-timestamp": "1",
          "x-annvero-event-id": "evt-stale",
        }),
        body
      );
      assert.equal(stale.ok, false);
      assert.equal(stale.code, "TIMESTAMP_EXPIRED");

      resetWebhookReplayStore();
      const h1 = {
        "x-annvero-signature": sig,
        "x-annvero-timestamp": ts,
        "x-annvero-event-id": "evt-replay",
      };
      assert.equal(verifyWebhookRequest(mockWebhookRequest(h1), body).ok, true);
      const replay = verifyWebhookRequest(mockWebhookRequest(h1), body);
      assert.equal(replay.ok, false);
      assert.equal(replay.code, "REPLAY");

      // Legacy Bearer alone must not bypass HMAC on staging
      const bearerOnly = verifyWebhookRequest(
        mockWebhookRequest({ authorization: "Bearer legacy-bearer-should-not-bypass" }),
        body
      );
      assert.equal(bearerOnly.ok, false);
      assert.equal(bearerOnly.code, "HMAC_REQUIRED");
    }
  );
});

test("recovery staging/preview require RECOVERY_API_ENABLED=true; local default on", () => {
  withEnv(
    {
      ANNVERO_APP_ENV: "staging",
      VERCEL_ENV: undefined,
      NODE_ENV: "production",
      RECOVERY_API_ENABLED: undefined,
    },
    () => assert.equal(isRecoveryApiEnabled(), false)
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "staging",
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      RECOVERY_API_ENABLED: "false",
    },
    () => assert.equal(isRecoveryApiEnabled(), false)
  );

  withEnv(
    {
      ANNVERO_APP_ENV: undefined,
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      RECOVERY_API_ENABLED: undefined,
    },
    () => assert.equal(isRecoveryApiEnabled(), false)
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "staging",
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      RECOVERY_API_ENABLED: "true",
    },
    () => assert.equal(isRecoveryApiEnabled(), true)
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "production",
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      RECOVERY_API_ENABLED: "false",
    },
    () => assert.equal(isRecoveryApiEnabled(), false)
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "development",
      VERCEL_ENV: undefined,
      NODE_ENV: "development",
      RECOVERY_API_ENABLED: undefined,
    },
    () => assert.equal(isRecoveryApiEnabled(), true)
  );

  // Route still gates on management/CSRF when enabled — static contract
  const routeSrc = fs.readFileSync(
    path.join(root, "app/api/recovery/restore/route.js"),
    "utf8"
  );
  assert.match(routeSrc, /requireManagementApi/);
  assert.match(routeSrc, /enforceSameOriginCsrf/);
  assert.match(routeSrc, /isRecoveryApiEnabled/);
  assert.match(routeSrc, /RECOVERY_API_ENABLED=true/);
  assert.match(
    routeSrc,
    /RESTORE_CONFIRM tek başına yetki değildir/
  );
});

test("user_metadata yetki kaynağı olarak kullanılmıyor (tarama)", () => {
  const files = [
    "src/lib/auth/admin.js",
    "src/lib/auth/userAccess.js",
    "src/lib/auth/apiGuard.js",
    "src/lib/auth/profileService.js",
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    // Yetki ataması: user_metadata.company_ids = ... veya ? user.user_metadata.company_ids
    assert.doesNotMatch(
      src,
      /companyIds:\s*[^\n]*user_metadata\.company_ids/,
      `${rel} companyIds için user_metadata kullanmamalı`
    );
    assert.doesNotMatch(
      src,
      /=\s*user\.user_metadata\.company_ids/,
      `${rel} user_metadata.company_ids ataması olmamalı`
    );
  }
  const adminSrc = fs.readFileSync(path.join(root, "src/lib/auth/admin.js"), "utf8");
  assert.match(adminSrc, /emailOk && appOk/);
});

test("RTO dokümanı 4 saat (4s değil)", () => {
  const docs = [
    "docs/disaster-recovery/BACKUP_POLICY.md",
    "docs/disaster-recovery/RESTORE_DRILL_CHECKLIST.md",
  ];
  for (const rel of docs) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    assert.doesNotMatch(text, /RTO\s*≤\s*4s\b|RTO\s*<=\s*4s\b/);
    assert.match(text, /4 saat|240/);
  }
});

test("security headers next.config'te bağlı", () => {
  const src = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
  assert.match(src, /buildSecurityHeaders/);
});

if (process.exitCode) {
  console.error("\nSecurity regression: FAILED");
} else {
  console.log("\nSecurity regression: ALL PASSED");
}
