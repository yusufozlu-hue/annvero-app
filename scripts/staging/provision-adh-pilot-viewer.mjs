#!/usr/bin/env node
/**
 * Staging-only: ADH Drive pilot mükellef (goruntuleme) test kullanıcısı.
 *
 * Usage:
 *   node scripts/staging/provision-adh-pilot-viewer.mjs
 *   node scripts/staging/provision-adh-pilot-viewer.mjs --dry-run
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (staging ref zorunlu).
 * Opsiyonel: ANNVERO_STAGING_ENV_FILE=../annvero-app/.env.staging.local
 *
 * Secret, parola, magic link veya service-role değeri stdout'a yazılmaz.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ANNVERO_KNOWN_PROJECT_REFS,
  extractSupabaseProjectRef,
} from "../../src/lib/security/envGuard.js";
import { ANNVERO_ROLES } from "../../src/config/annveroRoles.js";

const ADH_COMPANY_ID = "114f98b5-0411-45c5-a7c6-8061c9f06699";
const PILOT_VIEWER_EMAIL = "yusufozlu+adhpilot@gmail.com";
const STAGING_OTHER_COMPANY_NAME = "ANNVERO STAGING TEST";
const VIEWER_ROLE = ANNVERO_ROLES.VIEWER;
const DRY_RUN = process.argv.includes("--dry-run");

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

async function main() {
  const report = {
    ok: true,
    environment: "staging",
    projectRef,
    dryRun: DRY_RUN,
    pilotViewerEmail: PILOT_VIEWER_EMAIL,
    adhCompanyId: ADH_COMPANY_ID,
    role: VIEWER_ROLE,
    user: { status: "unknown", authUserId: null },
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
    report.invite.skippedReason = "user_already_exists";
  } else if (DRY_RUN) {
    report.user.status = "would_create";
    report.invite.skippedReason = "dry_run";
  } else {
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      (process.env.VERCEL_URL
        ? process.env.VERCEL_URL.startsWith("http")
          ? process.env.VERCEL_URL.replace(/\/$/, "")
          : `https://${process.env.VERCEL_URL}`
        : "https://annvero-staging.vercel.app");
    const { data: invited, error: inviteError } =
      await supabase.auth.admin.inviteUserByEmail(PILOT_VIEWER_EMAIL, {
        redirectTo: `${siteUrl}/auth/callback`,
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
  }

  if (!authUser?.id && !DRY_RUN) {
    fail("Auth kullanıcısı oluşturulamadı veya kimlik alınamadı.");
  }

  if (authUser?.id && !DRY_RUN) {
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
        (row) =>
          row.company_id !== ADH_COMPANY_ID && row.is_active !== false
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
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  fail(error?.message || "Provisioning başarısız.");
});
