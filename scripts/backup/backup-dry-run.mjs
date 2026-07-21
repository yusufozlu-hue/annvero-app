#!/usr/bin/env node
/**
 * Production backup dry-run / manifest üretici.
 * Production DB'ye bağlanmaz. Secret gerektirmez.
 *
 * Kullanım:
 *   node scripts/backup/backup-dry-run.mjs
 *   node scripts/backup/backup-dry-run.mjs --out .tmp-backup-dry-run
 *
 * Gerçek yedek: .github/workflows/backup-daily.yml.example + secret store.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argValue(flag, fallback = "") {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const outDir = path.resolve(
  root,
  argValue("--out", path.join(root, ".tmp-backup-dry-run"))
);

const synthetic = {
  version: 1,
  dry_run: true,
  generated_at: new Date().toISOString(),
  run_id: randomUUID(),
  note: "Sentetik envelope — production veri içermez",
  retention_policy: {
    daily_days: 35,
    weekly_weeks: 12,
    monthly_months: 12,
  },
  targets: {
    primary: "supabase-managed-backup (panel)",
    secondary: "NOT_CONFIGURED — ayrı hesap/object-lock kullanıcı adımı",
  },
  tables_sample: {
    companies: [{ id: "dry-run-company", name: "DEMO" }],
    learning_memory: [],
  },
};

const payload = JSON.stringify(synthetic, null, 2);
const checksum = createHash("sha256").update(payload).digest("hex");

const manifest = {
  algorithm: "sha256",
  checksum,
  bytes: Buffer.byteLength(payload, "utf8"),
  generated_at: synthetic.generated_at,
  run_id: synthetic.run_id,
  encrypted: false,
  encryption_note: "Gerçek yedeklerde AES-256-GCM + CI secret key zorunlu",
  immutable_copy: false,
  immutable_note: "Object-lock / WORM hedefi kullanıcı kurulumu gerektirir",
  dry_run: true,
};

fs.mkdirSync(outDir, { recursive: true });
const envelopePath = path.join(outDir, "backup-envelope.json");
const manifestPath = path.join(outDir, "backup-manifest.json");
fs.writeFileSync(envelopePath, payload, "utf8");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

// Bütünlük doğrulama
const verify = createHash("sha256")
  .update(fs.readFileSync(envelopePath))
  .digest("hex");
if (verify !== checksum) {
  console.error("FAIL  checksum mismatch");
  process.exit(1);
}

console.log("PASS  backup dry-run");
console.log(`  envelope: ${path.relative(root, envelopePath)}`);
console.log(`  manifest: ${path.relative(root, manifestPath)}`);
console.log(`  sha256: ${checksum}`);
