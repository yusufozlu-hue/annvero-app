/**
 * Migration destructive SQL tarayıcı.
 * İzinli olmayan DROP TABLE / TRUNCATE / DELETE FROM (where'siz) fail eder.
 * Çalıştır: node scripts/security/scan-destructive-sql.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = path.join(root, "supabase", "migrations");

const FORBIDDEN = [
  { id: "drop_table", re: /\bdrop\s+table\b/i },
  { id: "truncate", re: /\btruncate\s+(table\s+)?/i },
  { id: "delete_all", re: /\bdelete\s+from\s+[a-z0-9_."]+(\s*;|\s*$)/im },
];

const ALLOWED_DROP = /\bdrop\s+(policy|function|index|trigger|view)\b/i;

const findings = [];

if (!fs.existsSync(migrationsDir)) {
  console.error("migrations klasörü yok");
  process.exit(1);
}

for (const name of fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))) {
  const rel = `supabase/migrations/${name}`;
  const text = fs.readFileSync(path.join(migrationsDir, name), "utf8");
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("--")) continue;
    if (ALLOWED_DROP.test(trimmed)) continue;

    for (const rule of FORBIDDEN) {
      if (rule.re.test(trimmed)) {
        findings.push({ file: rel, line: i + 1, rule: rule.id });
      }
    }
  }
}

if (findings.length) {
  console.error("DESTRUCTIVE SQL SCAN FAILED:");
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  rule=${f.rule}`);
  }
  process.exit(1);
}

console.log("PASS  destructive SQL scan");
