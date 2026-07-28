#!/usr/bin/env node
/**
 * Staging-only: ADH Drive pilot mükellef (goruntuleme) test kullanıcısı.
 *
 * Usage:
 *   node scripts/staging/provision-adh-pilot-viewer.mjs
 *   node scripts/staging/provision-adh-pilot-viewer.mjs --dry-run
 *   node scripts/staging/provision-adh-pilot-viewer.mjs --delete-only
 *   node scripts/staging/provision-adh-pilot-viewer.mjs --reset
 *
 * --delete-only: Admin Auth API ile kullanıcıyı sil + app tablolarını temizle (davet yok).
 * --reset: sil + tek yeni davet + yalnız ADH üyeliği.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (staging ref zorunlu).
 * Opsiyonel: ANNVERO_STAGING_ENV_FILE=../annvero-app/.env.staging.local
 *
 * Secret, parola, magic link veya service-role değeri stdout'a yazılmaz.
 * Auth schema tablolarına doğrudan SQL yazılmaz; yalnız Admin Auth API kullanılır.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ANNVERO_KNOWN_PROJECT_REFS,
  extractSupabaseProjectRef,
} from "../../src/lib/security/envGuard.js";
import { ANNVERO_ROLES } from "../../src/config/annveroRoles.js";
import {
  ANNVERO_STAGING_SAFE_INVITE_ORIGIN,
  buildStagingInviteCallbackUrl,
} from "../../src/config/annveroInviteRedirects.js";

const ADH_COMPANY_ID = "114f98b5-0411-45c5-a7c6-8061c9f06699";
const PILOT_VIEWER_EMAIL = "yusufozlu+adhpilot@gmail.com";
const STAGING_OTHER_COMPANY_NAME = "ANNVERO STAGING TEST";
const VIEWER_ROLE = ANNVERO_ROLES.VIEWER;
const DRY_RUN = process.argv.includes("--dry-run");
const DELETE_ONLY =
  process.argv.includes("--delete-only") ||
  process.argv.includes("--revoke-only");
const RESET =
  process.argv.includes("--reset") ||
  process.argv.includes("--resend-invite") ||
  process.argv.includes("--force-invite");

const STAGING_SAFE_CALLBACK_URL = buildStagingInviteCallbackUrl();

function loadEnvFile(filePath) {
  try {
    const raw = readFileSync(resolve(process.cwd(), filePath), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      value = value.replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore missing file
  }
}

const envFile =
  process.env.ANNVERO_STAGING_ENV_FILE || "../annvero-app/.env.staging.local";
loadEnvFile(".env.local");
loadEnvFile(envFile);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const projectRef = extractSupabaseProjectRef(url);

function fail(message, code = 1) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(code);
}

if (!url || !serviceRole) {
  fail("NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.");
}

// Production hard-block (explicit, fail-closed).
if (projectRef === ANNVERO_KNOWN_PROJECT_REFS.production) {
  fail(
    `Production Auth engellendi (ref ${ANNVERO_KNOWN_PROJECT_REFS.production}).`
  );
}
if (projectRef !== ANNVERO_KNOWN_PROJECT_REFS.staging) {
  fail(
    `Yalnız staging Supabase izinli (beklenen ${ANNVERO_KNOWN_PROJECT_REFS.staging}, bulunan: ${projectRef || "?"})`
  );
}

const supabase = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findAuthUserByEmail(email) {
  let page = 1;
  const target = email.toLowerCase();
  while (page <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find(
      (user) => String(user.email || "").toLowerCase() === target
    );
    if (found) return found;
    if (users.length < 200) break;
    page += 1;
  }
  return null;
}

/**
 * Uygulama tablolarını temizle (auth schema SQL yok).
 * Eski auth_user_id veya e-posta ile orphan kayıtları kaldırır.
 */
async function cleanupAppRecords({ authUserId = "", email = "" } = {}) {
  const cleaned = {
    membershipRows: 0,
    profileRows: 0,
  };

  if (authUserId) {
    const { data: memberRows, error: memberSelectError } = await supabase
      .from("annvero_company_members")
      .select("id")
      .eq("user_id", authUserId);
    if (memberSelectError) throw memberSelectError;
    if (memberRows?.length) {
      const { error } = await supabase
        .from("annvero_company_members")
        .delete()
        .eq("user_id", authUserId);
      if (error) throw error;
      cleaned.membershipRows = memberRows.length;
    }
  }

  const profileIds = new Set();
  if (authUserId) {
    const { data: byAuth, error } = await supabase
      .from("annvero_user_profiles")
      .select("id")
      .eq("auth_user_id", authUserId);
    if (error) throw error;
    for (const row of byAuth || []) {
      if (row?.id) profileIds.add(row.id);
    }
  }
  if (email) {
    const { data: byEmail, error } = await supabase
      .from("annvero_user_profiles")
      .select("id")
      .ilike("email", email.toLowerCase().replace(/[%_]/g, ""));
    if (error) throw error;
    for (const row of byEmail || []) {
      if (row?.id) profileIds.add(row.id);
    }
  }

  const ids = [...profileIds];
  if (ids.length) {
    const { error } = await supabase
      .from("annvero_user_profiles")
      .delete()
      .in("id", ids);
    if (error) throw error;
    cleaned.profileRows = ids.length;
  }

  return cleaned;
}

/**
 * Resmi Admin Auth API ile kullanıcı sil + app cleanup.
 * Auth schema tablolarına doğrudan SQL yazılmaz.
 */
async function deletePilotUserViaAdminApi(authUser) {
  const result = {
    deleted: false,
    authUserId: authUser?.id || null,
    appCleanup: { membershipRows: 0, profileRows: 0 },
  };
  if (!authUser?.id) return result;

  // App rows first (FK / orphan riskini azaltır), sonra Auth Admin delete.
  result.appCleanup = await cleanupAppRecords({
    authUserId: authUser.id,
    email: PILOT_VIEWER_EMAIL,
  });

  const { error } = await supabase.auth.admin.deleteUser(authUser.id, false);
  if (error) throw error;
  result.deleted = true;
  return result;
}

async function main() {
  const report = {
    ok: true,
    environment: "staging",
    projectRef,
    dryRun: DRY_RUN,
    mode: DELETE_ONLY ? "delete-only" : RESET ? "reset" : "provision",
    pilotViewerEmail: PILOT_VIEWER_EMAIL,
    safeStagingOrigin: ANNVERO_STAGING_SAFE_INVITE_ORIGIN,
    inviteCallbackPath: "/auth/callback",
    adhCompanyId: ADH_COMPANY_ID,
    role: VIEWER_ROLE,
    user: { status: "unknown", authUserId: null },
    delete: { executed: false, deleted: false, appCleanup: null },
    invite: { sent: false, skippedReason: null },
    membership: { adhActive: false, otherCompanyIdsRemoved: [] },
    profile: { role: null, isActive: null },
    verification: {
      adhCompanyExists: false,
      stagingTestCompanyId: null,
      activeMembershipCount: 0,
      activeCompanyIds: [],
    },
  };

  const { data: adhCompany, error: adhError } = await supabase
    .from("companies")
    .select("id, company_name")
    .eq("id", ADH_COMPANY_ID)
    .maybeSingle();
  if (adhError) throw adhError;
  if (!adhCompany) {
    fail(`ADH firması bulunamadı: ${ADH_COMPANY_ID}`);
  }
  report.verification.adhCompanyExists = true;

  const { data: stagingTest } = await supabase
    .from("companies")
    .select("id, company_name")
    .ilike("company_name", STAGING_OTHER_COMPANY_NAME)
    .maybeSingle();
  report.verification.stagingTestCompanyId = stagingTest?.id || null;

  let authUser = await findAuthUserByEmail(PILOT_VIEWER_EMAIL);
  if (authUser) {
    report.user.status = "existing";
    report.user.authUserId = authUser.id;
  } else {
    report.user.status = "absent";
  }

  const shouldDelete = !DRY_RUN && (DELETE_ONLY || RESET) && authUser;
  if (shouldDelete) {
    report.delete.executed = true;
    const deleted = await deletePilotUserViaAdminApi(authUser);
    report.delete.deleted = deleted.deleted;
    report.delete.appCleanup = deleted.appCleanup;
    authUser = null;
    report.user.status = "deleted";
    report.user.authUserId = null;
  } else if ((DELETE_ONLY || RESET) && !authUser && !DRY_RUN) {
    // Orphan app rows for email may remain after prior auth delete.
    report.delete.executed = true;
    report.delete.appCleanup = await cleanupAppRecords({
      email: PILOT_VIEWER_EMAIL,
    });
    report.user.status = "absent";
  }

  if (DELETE_ONLY) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (DRY_RUN) {
    report.invite.skippedReason = "dry_run";
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Create/invite only when absent (or after reset delete).
  if (!authUser) {
    const { data: invited, error: inviteError } =
      await supabase.auth.admin.inviteUserByEmail(PILOT_VIEWER_EMAIL, {
        redirectTo: STAGING_SAFE_CALLBACK_URL,
        data: {
          annvero_role: VIEWER_ROLE,
          display_name: "ADH Pilot Mükellef",
        },
      });
    if (inviteError) throw inviteError;
    authUser = invited.user;
    report.user.status = "invited";
    report.user.authUserId = authUser?.id || null;
    report.invite.sent = true;
  } else if (!RESET) {
    report.invite.skippedReason = "user_already_exists";
  }

  if (!authUser?.id) {
    fail("Auth kullanıcısı oluşturulamadı veya kimlik alınamadı.");
  }

  const profileRecord = {
    id: authUser.id,
    auth_user_id: authUser.id,
    email: PILOT_VIEWER_EMAIL,
    display_name: "ADH Pilot Mükellef",
    role: VIEWER_ROLE,
    permissions: ["view"],
    company_ids: [],
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  const { error: profileError } = await supabase
    .from("annvero_user_profiles")
    .upsert(profileRecord, { onConflict: "email" });
  if (profileError) throw profileError;
  report.profile.role = VIEWER_ROLE;
  report.profile.isActive = true;

  await supabase.auth.admin.updateUserById(authUser.id, {
    user_metadata: {
      annvero_role: VIEWER_ROLE,
      display_name: "ADH Pilot Mükellef",
    },
    app_metadata: {
      role: VIEWER_ROLE,
    },
  });

  const { error: syncError } = await supabase.rpc(
    "annvero_sync_company_membership",
    {
      target_user_id: authUser.id,
      target_company_ids: [ADH_COMPANY_ID],
      actor_user_id: authUser.id,
    }
  );
  if (syncError) throw syncError;
  report.membership.adhActive = true;

  const { data: beforeRows } = await supabase
    .from("annvero_company_members")
    .select("company_id, is_active")
    .eq("user_id", authUser.id);
  const removed = (beforeRows || [])
    .filter(
      (row) => row.company_id !== ADH_COMPANY_ID && row.is_active !== false
    )
    .map((row) => row.company_id);
  if (removed.length) {
    report.membership.otherCompanyIdsRemoved = removed;
  }

  const { data: activeRows } = await supabase
    .from("annvero_company_members")
    .select("company_id")
    .eq("user_id", authUser.id)
    .eq("is_active", true);
  report.verification.activeMembershipCount = activeRows?.length || 0;
  report.verification.activeCompanyIds = (activeRows || []).map(
    (row) => row.company_id
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  fail(error?.message || "Provisioning başarısız.");
});
