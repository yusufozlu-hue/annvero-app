/**
 * Repo secret tarama — değerleri terminale basmaz; yalnızca dosya + değişken adı.
 * Çalıştır: node scripts/security/scan-secrets.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".tmp-compare",
  "coverage",
  "dist",
  "build",
]);

const SKIP_FILES = new Set([".env", ".env.local", ".env.production", ".env.staging"]);

const PATTERNS = [
  {
    id: "supabase_service_role_assignment",
    re: /(?:SUPABASE_SERVICE_ROLE_KEY|service_role)\s*[=:]\s*['"](?!your_|changeme|xxx|<|\$\{)[A-Za-z0-9._-]{20,}/i,
    nameHint: "SUPABASE_SERVICE_ROLE_KEY",
  },
  {
    id: "sb_secret_literal",
    re: /sb_secret_[A-Za-z0-9]{20,}/,
    nameHint: "sb_secret_*",
  },
  {
    id: "jwt_like_literal",
    re: /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    nameHint: "JWT-like token",
  },
  {
    id: "gib_encryption_assignment",
    re: /GIB_CREDENTIALS_ENCRYPTION_KEY\s*[=:]\s*['"](?!your_|changeme|xxx|<|\$\{)[^'"]{16,}/i,
    nameHint: "GIB_CREDENTIALS_ENCRYPTION_KEY",
  },
  {
    id: "private_key_block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    nameHint: "PRIVATE_KEY_BLOCK",
  },
];

  const ALLOWLIST_PATH_SNIPPETS = [
  "scripts/security/scan-secrets.mjs",
  "scripts/test-security-regression.mjs",
  "docs/security/",
  "docs/disaster-recovery/",
  ".env.example",
  "SECURITY.md",
];

function shouldSkip(rel) {
  const parts = rel.split(/[/\\]/);
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  if (SKIP_FILES.has(path.basename(rel))) return true;
  if (ALLOWLIST_PATH_SNIPPETS.some((s) => rel.replace(/\\/g, "/").includes(s))) return true;
  return false;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (shouldSkip(rel)) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|ts|tsx|mjs|cjs|json|md|yml|yaml|env|txt|sql|sh|ps1)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const findings = [];
const files = walk(root);

for (const file of files) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const rel = path.relative(root, file).replace(/\\/g, "/");
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Placeholder / example satırlarını atla
    if (/your_|changeme|example|placeholder|xxx+|<SECRET>|<TOKEN>|\$\{/i.test(line)) continue;

    for (const pattern of PATTERNS) {
      if (pattern.re.test(line)) {
        findings.push({
          file: rel,
          line: i + 1,
          name: pattern.nameHint,
          patternId: pattern.id,
        });
      }
    }
  }
}

if (findings.length) {
  console.error("SECRET SCAN FAILED — olası secret örüntüleri (değer basılmadı):");
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  name=${f.name}  pattern=${f.patternId}`);
  }
  process.exit(1);
}

console.log(`PASS  secret scan (${files.length} dosya, bulgu yok)`);
