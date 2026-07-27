#!/usr/bin/env node
/**
 * Staging-only: ADH company_cloud_folders.connection_id → ofis Drive bağlantısı backfill.
 *
 * Usage:
 *   node --import ./scripts/_alias-loader.mjs ./scripts/staging/backfill-adh-company-drive-binding.mjs
 *   node --import ./scripts/_alias-loader.mjs ./scripts/staging/backfill-adh-company-drive-binding.mjs --dry-run
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ Drive token crypto key).
 * Production engellenir. Token/secret stdout'a yazılmaz.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ANNVERO_KNOWN_PROJECT_REFS,
  extractSupabaseProjectRef,
} from "../../src/lib/security/envGuard.js";
import { getValidGoogleAccessTokenByConnectionId } from "../../src/lib/googleDrive/connectionStore.js";
import { assertDriveRootBelongsToCompany } from "../../src/utils/cloudStorage/googleDriveAdapter.js";

const ADH_COMPANY_ID = "114f98b5-0411-45c5-a7c6-8061c9f06699";
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
    // ignore
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
if (projectRef === ANNVERO_KNOWN_PROJECT_REFS.production) {
  fail(`Production engellendi (ref ${ANNVERO_KNOWN_PROJECT_REFS.production}).`);
}
if (projectRef !== ANNVERO_KNOWN_PROJECT_REFS.staging) {
  fail(
    `Yalnız staging izinli (beklenen ${ANNVERO_KNOWN_PROJECT_REFS.staging}, bulunan: ${projectRef || "?"})`
  );
}

const supabase = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function verifyConnectionCanAccessRoot(connectionId, rootFolderId) {
  const token = await getValidGoogleAccessTokenByConnectionId(connectionId);
  await assertDriveRootBelongsToCompany({
    accessToken: token.accessToken,
    rootFolderId,
    companyId: ADH_COMPANY_ID,
  });
  return true;
}

async function main() {
  const report = {
    ok: true,
    environment: "staging",
    projectRef,
    dryRun: DRY_RUN,
    companyId: ADH_COMPANY_ID,
    folder: null,
    binding: { before: null, after: null, updated: false, verified: false },
    candidateCount: 0,
    selectedConnectionId: null,
  };

  const { data: folder, error: folderError } = await supabase
    .from("company_cloud_folders")
    .select("company_id,root_folder_id,connection_id,root_folder_name")
    .eq("company_id", ADH_COMPANY_ID)
    .maybeSingle();
  if (folderError) throw folderError;
  if (!folder?.root_folder_id) {
    fail("ADH company_cloud_folders kaydı veya root_folder_id yok.");
  }

  report.folder = {
    hasRoot: true,
    rootFolderName: folder.root_folder_name || null,
    hasConnectionId: Boolean(folder.connection_id),
  };
  report.binding.before = folder.connection_id || null;

  if (folder.connection_id) {
    try {
      await verifyConnectionCanAccessRoot(
        folder.connection_id,
        folder.root_folder_id
      );
      report.binding.verified = true;
      report.binding.after = folder.connection_id;
      report.selectedConnectionId = folder.connection_id;
      console.log(JSON.stringify(report, null, 2));
      return;
    } catch {
      // Mevcut binding geçersiz — yeniden aday ara.
    }
  }

  const { data: connections, error: connError } = await supabase
    .from("cloud_storage_connections")
    .select("id,user_id,status,account_email,connected_at")
    .eq("provider", "google_drive")
    .eq("status", "connected")
    .order("connected_at", { ascending: false });
  if (connError) throw connError;

  const candidates = connections || [];
  report.candidateCount = candidates.length;

  let chosen = null;
  for (const candidate of candidates) {
    try {
      await verifyConnectionCanAccessRoot(candidate.id, folder.root_folder_id);
      chosen = candidate;
      break;
    } catch {
      // sonraki aday
    }
  }

  if (!chosen) {
    fail(
      "ADH kök klasörüne erişebilen bağlı ofis Drive connection bulunamadı."
    );
  }

  report.selectedConnectionId = chosen.id;

  if (!DRY_RUN) {
    const { error: updateError } = await supabase
      .from("company_cloud_folders")
      .update({ connection_id: chosen.id })
      .eq("company_id", ADH_COMPANY_ID);
    if (updateError) throw updateError;
    report.binding.updated = true;
    report.binding.after = chosen.id;
    report.binding.verified = true;
  } else {
    report.binding.after = chosen.id;
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  fail(error?.message || "Backfill başarısız.");
});
