#!/usr/bin/env node
/** Staging-only: set ADH pilot viewer password from ANNVERO_STAGING_VIEWER_PASSWORD. No secrets printed. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  ANNVERO_KNOWN_PROJECT_REFS,
  extractSupabaseProjectRef,
} from "../../src/lib/security/envGuard.js";

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
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

loadEnvFile("../annvero-app/.env.staging.local");
loadEnvFile(".env.local");

const EMAIL = "yusufozlu+adhpilot@gmail.com";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ref = extractSupabaseProjectRef(url);

if (ref === ANNVERO_KNOWN_PROJECT_REFS.production) {
  console.log(JSON.stringify({ ok: false, error: "production_blocked" }));
  process.exit(1);
}
if (ref !== ANNVERO_KNOWN_PROJECT_REFS.staging) {
  console.log(JSON.stringify({ ok: false, error: "staging_only", ref }));
  process.exit(1);
}

const password =
  process.env.ANNVERO_STAGING_VIEWER_PASSWORD ||
  `AdhE2E!${randomBytes(9).toString("hex")}`;

const admin = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUser() {
  let page = 1;
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find(
      (u) => String(u.email || "").toLowerCase() === EMAIL
    );
    if (found) return found;
    if (users.length < 200) break;
    page += 1;
  }
  return null;
}

const user = await findUser();
if (!user) {
  console.log(JSON.stringify({ ok: false, error: "viewer_missing" }));
  process.exit(1);
}

const { error } = await admin.auth.admin.updateUserById(user.id, {
  password,
  email_confirm: true,
});
if (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
}

// Write password to temp env file for subsequent E2E only (gitignored pattern)
import { writeFileSync } from "node:fs";
writeFileSync(
  resolve(process.cwd(), ".tmp-adh-e2e-password.env"),
  `ANNVERO_STAGING_VIEWER_PASSWORD=${password}\n`,
  { encoding: "utf8", mode: 0o600 }
);

console.log(
  JSON.stringify({
    ok: true,
    passwordSet: true,
    userId: user.id,
    stagingRef: ref,
    passwordFile: ".tmp-adh-e2e-password.env",
  })
);
