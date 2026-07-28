#!/usr/bin/env node
/**
 * Staging/preview live E2E: viewer upload via Preview origin (server-side Drive tokens).
 * Does not print secrets. Production blocked.
 *
 * Env (from vercel env run OR staging files):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY (via vercel env run — not printed)
 *   ANNVERO_STAGING_ORIGIN (preview URL)
 *   ANNVERO_STAGING_VIEWER_PASSWORD (set if missing via admin)
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
import { getValidGoogleAccessTokenByConnectionId } from "../../src/lib/googleDrive/connectionStore.js";

const ADH_COMPANY_ID = "114f98b5-0411-45c5-a7c6-8061c9f06699";
const PILOT_VIEWER_EMAIL = "yusufozlu+adhpilot@gmail.com";
const PROJECT_REF_STAGING = ANNVERO_KNOWN_PROJECT_REFS.staging;

function loadEnvFile(filePath) {
  try {
    const raw = readFileSync(resolve(process.cwd(), filePath), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      // Prefer already-injected Vercel preview env over local files.
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
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";
const stagingOrigin = String(
  process.env.ANNVERO_STAGING_ORIGIN || ANNVERO_STAGING_SAFE_INVITE_ORIGIN
).replace(/\/$/, "");
const projectRef = extractSupabaseProjectRef(url);

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

if (!url || !serviceRole || !anonKey) fail("Supabase URL/anon/service-role gerekli.");
if (projectRef === ANNVERO_KNOWN_PROJECT_REFS.production) {
  fail("Production engellendi.");
}
if (projectRef !== PROJECT_REF_STAGING) {
  fail(`Yalnız staging (${PROJECT_REF_STAGING}), bulunan: ${projectRef || "?"}`);
}

process.env.ANNVERO_ALLOW_REMOTE_SUPABASE =
  process.env.ANNVERO_ALLOW_REMOTE_SUPABASE || "1";

const admin = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function buildTinyPdf(label) {
  const body = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>endobj
4 0 obj<< /Length 48 >>stream
BT /F1 12 Tf 20 100 Td (fixture ${label}) Tj ET
endstream
endobj
trailer<< /Root 1 0 R >>
%%EOF
annvero-adh-pilot-fixture:${label}
`;
  return Buffer.from(body, "utf8");
}

function chunkCookieValue(name, value) {
  // @supabase/ssr often chunks large cookies as name.0, name.1, ...
  const max = 3180;
  const cookies = [];
  if (value.length <= max) {
    cookies.push(`${name}=${value}`);
    return cookies;
  }
  let i = 0;
  let part = 0;
  while (i < value.length) {
    cookies.push(`${name}.${part}=${value.slice(i, i + max)}`);
    i += max;
    part += 1;
  }
  return cookies;
}

async function ensureViewerPassword() {
  let password = process.env.ANNVERO_STAGING_VIEWER_PASSWORD || "";
  if (password) return password;
  password = `AdhPilot!${randomBytes(6).toString("hex")}`;
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = (list?.users || []).find(
    (u) => String(u.email || "").toLowerCase() === PILOT_VIEWER_EMAIL
  );
  if (!user?.id) fail("Pilot viewer auth kullanıcısı bulunamadı.");
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (error) fail(`Viewer parola set edilemedi: ${error.message}`);
  process.env.ANNVERO_STAGING_VIEWER_PASSWORD = password;
  return password;
}

async function signInViewer(password) {
  const auth = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await auth.auth.signInWithPassword({
    email: PILOT_VIEWER_EMAIL,
    password,
  });
  if (error || !data?.session?.access_token) {
    fail(`Viewer login başarısız: ${error?.message || "session yok"}`);
  }
  return data;
}

function buildAuthCookieHeader(session) {
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: "bearer",
    user: session.user,
  };
  // base64url JSON used by older sb cookie; also try plain encodeURIComponent JSON
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const name = `sb-${projectRef}-auth-token`;
  return [
    ...chunkCookieValue(name, encodeURIComponent(json)),
    ...chunkCookieValue(name, b64),
    `sb-access-token=${session.access_token}`,
    session.refresh_token ? `sb-refresh-token=${session.refresh_token}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

async function deleteDriveFile(accessToken, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Drive delete HTTP ${res.status}`);
  }
}

async function main() {
  const stamp = randomBytes(4).toString("hex");
  const fileName = `adh-pilot-fixture-${stamp}.pdf`;
  const pdf = buildTinyPdf(stamp);
  const contentHash = createHash("sha256").update(pdf).digest("hex");

  const report = {
    ok: false,
    environment: "staging",
    projectRef,
    stagingOrigin,
    commitHint: process.env.VERCEL_GIT_COMMIT_SHA || null,
    companyId: ADH_COMPANY_ID,
    viewerEmail: PILOT_VIEWER_EMAIL,
    viewerHasPersonalDriveConnection: null,
    bindingHasConnectionId: null,
    upload: { ok: false, status: null, code: null },
    list: { found: false },
    indexed: false,
    redirect: { ok: false, status: null, location: null },
    cleanup: { driveDeleted: false, indexRemoved: false },
    fixtureFileName: fileName,
  };

  const { data: folder } = await admin
    .from("company_cloud_folders")
    .select("connection_id,root_folder_id")
    .eq("company_id", ADH_COMPANY_ID)
    .maybeSingle();
  report.bindingHasConnectionId = Boolean(folder?.connection_id);

  const password = await ensureViewerPassword();
  const signed = await signInViewer(password);
  const session = signed.session;
  const viewerId = signed.user.id;

  const { data: personal } = await admin
    .from("cloud_storage_connections")
    .select("id,status")
    .eq("user_id", viewerId)
    .eq("provider", "google_drive")
    .maybeSingle();
  report.viewerHasPersonalDriveConnection = personal?.status === "connected";
  if (report.viewerHasPersonalDriveConnection) {
    fail("Viewer kişisel Drive OAuth’a sahip olmamalı.");
  }

  const cookieHeader = buildAuthCookieHeader(session);

  // Route redirect
  const redirectRes = await fetch(`${stagingOrigin}/muhasebe/firma-yonetimi`, {
    method: "GET",
    redirect: "manual",
    headers: { Cookie: cookieHeader, Accept: "text/html" },
  });
  const location = redirectRes.headers.get("location") || "";
  report.redirect.status = redirectRes.status;
  report.redirect.location = location || null;
  report.redirect.ok =
    redirectRes.status >= 300 &&
    redirectRes.status < 400 &&
    /\/mukellef(\/|$|\?)/.test(location);

  // If cookie shape wrong, also try browser-like login page cookie harvest via follow redirects after password grant
  // Upload
  const form = new FormData();
  form.set("companyId", ADH_COMPANY_ID);
  form.set("file", new Blob([pdf], { type: "application/pdf" }), fileName);

  const uploadRes = await fetch(`${stagingOrigin}/api/google-drive/files/upload`, {
    method: "POST",
    headers: { Cookie: cookieHeader },
    body: form,
  });
  const uploadBody = await uploadRes.json().catch(() => ({}));
  report.upload.status = uploadRes.status;
  report.upload.code = uploadBody?.code || null;
  report.upload.message = uploadBody?.message || uploadBody?.error || null;
  report.upload.ok =
    uploadRes.ok &&
    (uploadBody?.code === "UPLOADED" ||
      uploadBody?.code === "UPLOADED_QUARANTINE");

  // Poll document_index
  let indexRow = null;
  for (let i = 0; i < 10; i += 1) {
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
    await new Promise((r) => setTimeout(r, 1200));
  }
  report.indexed = Boolean(indexRow?.id);

  // List API (Evraklarım)
  const listRes = await fetch(
    `${stagingOrigin}/api/google-drive/files?companyId=${ADH_COMPANY_ID}`,
    { headers: { Cookie: cookieHeader } }
  );
  const listBody = await listRes.json().catch(() => ({}));
  const docs = Array.isArray(listBody?.documents) ? listBody.documents : [];
  report.list.status = listRes.status;
  report.list.found = docs.some(
    (d) => d?.fileName === fileName || d?.name === fileName
  );

  // Cleanup fixture only (Preview-compatible crypto key expected via vercel env run)
  if (indexRow?.provider_file_id && folder?.connection_id) {
    try {
      const token = await getValidGoogleAccessTokenByConnectionId(
        folder.connection_id
      );
      await deleteDriveFile(token.accessToken, indexRow.provider_file_id);
      report.cleanup.driveDeleted = true;
    } catch (e) {
      report.cleanup.driveError = e?.message || "drive_delete_failed";
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

  report.ok =
    report.bindingHasConnectionId &&
    report.viewerHasPersonalDriveConnection === false &&
    report.upload.ok &&
    report.indexed &&
    (report.list.found || report.indexed) &&
    report.redirect.ok &&
    report.cleanup.driveDeleted &&
    report.cleanup.indexRemoved;

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((e) => fail(e?.message || "E2E failed"));
