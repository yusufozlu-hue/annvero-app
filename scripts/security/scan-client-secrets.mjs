/**
 * Client bundle / client bileşenlerinde server secret kullanımını tarar.
 * Çalıştır: node scripts/security/scan-client-secrets.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const FORBIDDEN_IMPORTS = [
  "serverAdmin",
  "gibCredentialsCrypto",
  "encryptionService",
  "gibCredentialsEnv",
  "tokenCrypto",
];

const FORBIDDEN_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "GIB_CREDENTIALS_ENCRYPTION_KEY",
  "GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY",
  "GIB_AUTOMATION_SERVICE_TOKEN",
  "N8N_AUTOMATION_WEBHOOK_SECRET",
  "ANNVERO_FIELD_ENCRYPTION_KEY",
  "UPSTASH_REDIS_REST_TOKEN",
];

const CLIENT_GLOBS_DIRS = [
  path.join(root, "src", "components"),
  path.join(root, "src", "hooks"),
  path.join(root, "src", "utils"),
  path.join(root, "app"),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "api" || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const findings = [];

for (const dir of CLIENT_GLOBS_DIRS) {
  for (const file of walk(dir)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    // Server route / server-only dosyaları atla
    if (rel.includes("/api/")) continue;
    if (rel.includes("serverAdmin") || rel.includes("encryptionService")) continue;

    const text = fs.readFileSync(file, "utf8");
    const isClient =
      text.includes('"use client"') ||
      text.includes("'use client'") ||
      /\/components\//.test(rel) ||
      /\/hooks\//.test(rel);

    if (!isClient) continue;

    for (const name of FORBIDDEN_ENV) {
      if (text.includes(name) || text.includes(`NEXT_PUBLIC_${name}`)) {
        // NEXT_PUBLIC_SUPABASE_ANON_KEY izinli değil listede
        findings.push({ file: rel, name });
      }
    }

    for (const imp of FORBIDDEN_IMPORTS) {
      if (new RegExp(`from\\s+['\"][^'\"]*${imp}`, "i").test(text)) {
        findings.push({ file: rel, name: `import:${imp}` });
      }
    }

    if (/process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(text)) {
      findings.push({ file: rel, name: "process.env.SUPABASE_SERVICE_ROLE_KEY" });
    }
  }
}

if (findings.length) {
  console.error("CLIENT SECRET SCAN FAILED:");
  for (const f of findings) {
    console.error(`  ${f.file}  ${f.name}`);
  }
  process.exit(1);
}

console.log("PASS  client secret scan");
