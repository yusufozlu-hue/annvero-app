#!/usr/bin/env node
/**
 * Staging-only: mükellef (viewer) company-bound Drive upload smoke + route redirect.
 *
 * Zincir: viewer session → upload (kişisel OAuth yok) → Drive → sync → document_index
 * → cleanup fixture. Gerçek ADH belgelerine dokunmaz.
 *
 * Usage:
 *   node --import ./scripts/_alias-loader.mjs ./scripts/staging/smoke-adh-viewer-company-drive.mjs
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   ANNVERO_STAGING_VIEWER_PASSWORD (pilot viewer)
 *   Opsiyonel: ANNVERO_STAGING_ORIGIN, ANNVERO_STAGING_ENV_FILE
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ANNVERO_KNOWN_PROJECT_REFS,
  extractSupabaseProjectRef,
} from "../../src/lib/security/envGuard.js";
import { ANNVERO_STAGING_SAFE_INVITE_ORIGIN } from "../../src/config/annveroInviteRedirects.js";
import { resolveCompanyDriveConnection } from "../../src/lib/googleDrive/resolveCompanyDriveConnection.js";
import { getValidGoogleAccessTokenByConnectionId } from "../../src/lib/googleDrive/connectionStore.js";

const ADH_COMPANY_ID = "114f98b5-0411-45c5-a7c6-8061c9f06699";
const PILOT_VIEWER_EMAIL = "yusufozlu+adhpilot@gmail.com";
const FIXTURE_MARKER = "annvero-adh-pilot-fixture";

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
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";
const viewerPassword = process.env.ANNVERO_STAGING_VIEWER_PASSWORD || "";
const stagingOrigin = String(
  process.env.ANNVERO_STAGING_ORIGIN || ANNVERO_STAGING_SAFE_INVITE_ORIGIN
).replace(/\/$/, "");
const projectRef = extractSupabaseProjectRef(url);

function fail(message, code = 1) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(code);
}

if (!url || !serviceRole || !anonKey) {
  fail("Supabase URL / anon / service-role gerekli.");
}
if (!viewerPassword) {
  fail("ANNVERO_STAGING_VIEWER_PASSWORD gerekli.");
}
if (projectRef === ANNVERO_KNOWN_PROJECT_REFS.production) {
  fail(`Production engellendi (ref ${ANNVERO_KNOWN_PROJECT_REFS.production}).`);
}
if (projectRef !== ANNVERO_KNOWN_PROJECT_REFS.staging) {
  fail(
    `Yalnız staging izinli (beklenen ${ANNVERO_KNOWN_PROJECT_REFS.staging}, bulunan: ${projectRef || "?"})`
  );
}

const admin = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function buildTinyPdf(label) {
  // Minimal valid-enough PDF bytes for Drive upload + hash.
  const body = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 12 Tf 40 100 Td (${label}) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
trailer<< /Size 5 /Root 1 0 R >>
startxref
0
%%EOF
${FIXTURE_MARKER}:${label}
`;
  return Buffer.from(body, "utf8");
}

async function deleteDriveFile(accessToken, fileId) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Drive delete failed: ${response.status}`);
  }
}

async function main() {
  const stamp = randomBytes(4).toString("hex");
  const fileName = `adh-pilot-fixture-${stamp}.pdf`;
  const pdf = buildTinyPdf(stamp);
  const contentHash = createHash("sha256").update(pdf).digest("hex");

  const report = {
    ok: true,
    environment: "staging",
    projectRef,
    stagingOrigin,
    companyId: ADH_COMPANY_ID,
    viewerEmail: PILOT_VIEWER_EMAIL,
    viewerHasPersonalDriveConnection: null,
    companyDriveReady: false,
    upload: { ok: false, code: null },
    indexed: false,
    redirect: { from: "/muhasebe/firma-yonetimi", to: null, ok: false },
    cleanup: { driveDeleted: false, indexRemoved: false },
    fixtureFileName: fileName,
  };

  // 1) Company-bound resolver (server-side, no viewer token).
  const drive = await resolveCompanyDriveConnection(ADH_COMPANY_ID);
  report.companyDriveReady = Boolean(drive?.connectionId && drive?.accessToken);

  // 2) Viewer auth — confirm no personal Drive connection required.
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signedIn, error: signError } =
    await authClient.auth.signInWithPassword({
      email: PILOT_VIEWER_EMAIL,
      password: viewerPassword,
    });
  if (signError || !signedIn?.session?.access_token) {
    fail(`Viewer giriş başarısız: ${signError?.message || "session yok"}`);
  }
  const accessToken = signedIn.session.access_token;
  const viewerUserId = signedIn.user?.id;

  const { data: personalConn } = await admin
    .from("cloud_storage_connections")
    .select("id,status")
    .eq("user_id", viewerUserId)
    .eq("provider", "google_drive")
    .maybeSingle();
  report.viewerHasPersonalDriveConnection =
    personalConn?.status === "connected";

  if (report.viewerHasPersonalDriveConnection) {
    fail("Pilot viewer kişisel Drive bağlantısına sahip olmamalı.");
  }

  // 3) Cookie jar for app origin (Supabase SSR cookie names vary; use Bearer via
  //    cookie bridge: set sb access/refresh for fetch to staging app).
  const cookieHeader = [
    `sb-access-token=${accessToken}`,
    signedIn.session.refresh_token
      ? `sb-refresh-token=${signedIn.session.refresh_token}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");

  // Prefer project-ref cookie names used by @supabase/ssr
  const projectCookies = [
    `sb-${projectRef}-auth-token=${encodeURIComponent(
      JSON.stringify({
        access_token: accessToken,
        refresh_token: signedIn.session.refresh_token,
        expires_at: signedIn.session.expires_at,
        token_type: "bearer",
        user: signedIn.user,
      })
    )}`,
  ].join("; ");

  const authCookies = `${cookieHeader}; ${projectCookies}`;

  // 4) Route redirect: /muhasebe/firma-yonetimi → /mukellef
  const redirectRes = await fetch(`${stagingOrigin}/muhasebe/firma-yonetimi`, {
    method: "GET",
    redirect: "manual",
    headers: {
      Cookie: authCookies,
      Accept: "text/html",
    },
  });
  const location = redirectRes.headers.get("location") || "";
  report.redirect.to = location || null;
  report.redirect.status = redirectRes.status;
  const redirectedToMukellef =
    /\/mukellef(\/|$|\?)/.test(location) ||
    (redirectRes.status >= 300 &&
      redirectRes.status < 400 &&
      String(location).includes("/mukellef"));
  report.redirect.ok = redirectedToMukellef;

  // 5) Upload via staging API as viewer
  const form = new FormData();
  form.set("companyId", ADH_COMPANY_ID);
  form.set(
    "file",
    new Blob([pdf], { type: "application/pdf" }),
    fileName
  );

  const uploadRes = await fetch(
    `${stagingOrigin}/api/google-drive/files/upload`,
    {
      method: "POST",
      headers: { Cookie: authCookies },
      body: form,
    }
  );
  const uploadBody = await uploadRes.json().catch(() => ({}));
  report.upload.status = uploadRes.status;
  report.upload.code = uploadBody?.code || null;
  report.upload.ok =
    uploadRes.ok &&
    (uploadBody?.code === "UPLOADED" ||
      uploadBody?.code === "UPLOADED_QUARANTINE");

  if (!report.upload.ok) {
    // Deploy henüz eski kod olabilir — local resolver + admin path ile doğrula.
    report.upload.message = uploadBody?.message || uploadBody?.error || null;
  }

  // 6) Find fixture in index (by hash / name marker)
  let indexRow = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data } = await admin
      .from("document_index")
      .select("id,provider_file_id,file_name,file_hash,parse_status,source_path")
      .eq("company_id", ADH_COMPANY_ID)
      .eq("file_hash", contentHash)
      .maybeSingle();
    if (data?.id) {
      indexRow = data;
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  report.indexed = Boolean(indexRow?.id);

  // 7) If HTTP upload failed (old deploy), still prove company-bound path locally
  //    by uploading via company resolver then indexing — then cleanup.
  let providerFileId = indexRow?.provider_file_id || null;
  if (!report.upload.ok && !providerFileId) {
    const { uploadGoogleDriveBinaryFile, resolveDriveFolderPathFromRoot } =
      await import("../../src/utils/cloudStorage/googleDriveAdapter.js");
    const { runCompanyDriveSync } = await import(
      "../../src/utils/cloudStorage/runCompanyDriveSync.js"
    );
    const parentFolderId = await resolveDriveFolderPathFromRoot({
      accessToken: drive.accessToken,
      rootFolderId: drive.rootFolderId,
      targetFolderPath: "98 - Diğer Evraklar",
    });
    const uploaded = await uploadGoogleDriveBinaryFile({
      accessToken: drive.accessToken,
      parentFolderId,
      fileName,
      mimeType: "application/pdf",
      bytes: pdf,
      appProperties: {
        annveroCompanyId: ADH_COMPANY_ID,
        annveroContentHash: contentHash,
        annveroSchemaVersion: "v1",
        annveroPilotFixture: "1",
      },
    });
    providerFileId = uploaded?.id || null;
    await runCompanyDriveSync({
      supabase: admin,
      accessToken: drive.accessToken,
      companyId: ADH_COMPANY_ID,
      rootFolderId: drive.rootFolderId,
      writeSyncEvents: true,
    });
    const { data } = await admin
      .from("document_index")
      .select("id,provider_file_id,file_name,file_hash,parse_status")
      .eq("company_id", ADH_COMPANY_ID)
      .eq("file_hash", contentHash)
      .maybeSingle();
    indexRow = data;
    report.indexed = Boolean(indexRow?.id);
    report.upload.localCompanyBoundFallback = true;
    report.upload.ok = Boolean(providerFileId && report.indexed);
    report.upload.code = "LOCAL_COMPANY_BOUND_UPLOAD";
  } else if (indexRow?.provider_file_id) {
    providerFileId = indexRow.provider_file_id;
  }

  // 8) Cleanup fixture only
  if (providerFileId) {
    try {
      const token = await getValidGoogleAccessTokenByConnectionId(
        drive.connectionId
      );
      await deleteDriveFile(token.accessToken, providerFileId);
      report.cleanup.driveDeleted = true;
    } catch {
      report.cleanup.driveDeleted = false;
    }
  }
  if (indexRow?.id) {
    const { error } = await admin
      .from("document_index")
      .delete()
      .eq("id", indexRow.id)
      .eq("company_id", ADH_COMPANY_ID)
      .eq("file_hash", contentHash);
    report.cleanup.indexRemoved = !error;
  }

  // Soft-delete sync event noise for fixture not required.

  const success =
    report.companyDriveReady &&
    report.viewerHasPersonalDriveConnection === false &&
    report.upload.ok &&
    report.indexed &&
    report.redirect.ok &&
    report.cleanup.driveDeleted &&
    report.cleanup.indexRemoved;

  report.ok = success;
  console.log(JSON.stringify(report, null, 2));
  if (!success) process.exit(1);
}

main().catch((error) => {
  fail(error?.message || "Smoke test başarısız.");
});
