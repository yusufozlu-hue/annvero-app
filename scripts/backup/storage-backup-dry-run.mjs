/**
 * Storage backup manifest — sentetik / dry-run.
 * Production dosya indirmez. DB backup Storage objelerini kapsamaz.
 * Canlı staging yedek: scripts/backup/staging-storage-backup.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  BACKUP_RETENTION,
  STAGING_PROJECT_REF,
  assertStagingOnlyBackupTarget,
} from "./lib/stagingBackupGuard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const prodGuard = assertStagingOnlyBackupTarget({
  projectRef: "ttxigznwcjvrlzuppbro",
  mode: "live",
});
if (prodGuard.ok) {
  console.error("FAIL  production ref must be rejected by staging backup guard");
  process.exit(1);
}

function argValue(flag, fallback = "") {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const outDir = path.resolve(root, argValue("--out", path.join(root, ".tmp-backup-dry-run")));
const runId = argValue("--run-id", randomUUID());

// Sentetik private bucket envanteri (gerçek prod verisi yok)
const syntheticObjects = [
  {
    bucket: "company-documents",
    path: "company-dry-run/evrak/demo.pdf",
    company_id: "dry-run-company",
    size: 128,
    content: Buffer.from("%PDF-SYNTHETIC-DEMO"),
    version: "v1",
  },
  {
    bucket: "company-documents",
    path: "company-dry-run/banka/ekstre.xlsx",
    company_id: "dry-run-company",
    size: 64,
    content: Buffer.from("PK\x03\x04SYNTHETIC"),
    version: "v1",
  },
];

const objects = syntheticObjects.map((obj) => {
  const checksum = createHash("sha256").update(obj.content).digest("hex");
  return {
    bucket: obj.bucket,
    path: obj.path,
    company_id: obj.company_id,
    size: obj.content.length,
    checksum_sha256: checksum,
    version: obj.version,
    private: true,
  };
});

const storageManifest = {
  kind: "storage_backup_manifest",
  run_id: runId,
  generated_at: new Date().toISOString(),
  dry_run: true,
  note: "Supabase DB backup Storage dosyalarını kapsamaz. Silinen dosya yalnız DB restore ile geri gelmez.",
  staging_ref_only: STAGING_PROJECT_REF,
  production_ref_forbidden: true,
  retention_policy: BACKUP_RETENTION,
  secondary_target: "NOT_CONFIGURED",
  object_lock: false,
  mutates_user_objects: false,
  objects,
  totals: {
    object_count: objects.length,
    bytes: objects.reduce((sum, o) => sum + o.size, 0),
  },
};

const dbManifestPath = path.join(outDir, "backup-manifest.json");
let dbManifest = null;
if (fs.existsSync(dbManifestPath)) {
  dbManifest = JSON.parse(fs.readFileSync(dbManifestPath, "utf8"));
}

const combined = {
  run_id: runId,
  dry_run: true,
  components: {
    database: dbManifest
      ? { present: true, checksum: dbManifest.checksum, dry_run: dbManifest.dry_run }
      : { present: false },
    storage: {
      present: true,
      object_count: objects.length,
      manifest_checksum: createHash("sha256")
        .update(JSON.stringify(storageManifest))
        .digest("hex"),
    },
  },
  success_requires_both: true,
  success:
    Boolean(dbManifest?.checksum) &&
    objects.length > 0 &&
    String(storageManifest.secondary_target).startsWith("s3://"),
  // secondary henüz yok → başarılı sayılmaz
  declared_complete: false,
  reason_incomplete:
    "İkinci bağımsız/object-lock Storage hedefi kurulmadan backup run tamamlanmış sayılmaz.",
};

fs.mkdirSync(outDir, { recursive: true });
const storagePath = path.join(outDir, "storage-backup-manifest.json");
const combinedPath = path.join(outDir, "backup-run-combined.json");
fs.writeFileSync(storagePath, JSON.stringify(storageManifest, null, 2), "utf8");
fs.writeFileSync(combinedPath, JSON.stringify(combined, null, 2), "utf8");

if (combined.declared_complete) {
  console.error("FAIL  incomplete backup should not be declared complete");
  process.exit(1);
}

console.log("PASS  storage backup dry-run manifest");
console.log(`  run_id: ${runId}`);
console.log(`  objects: ${objects.length}`);
console.log(`  combined success (both+secondary): ${combined.success}`);
console.log(`  declared_complete: ${combined.declared_complete}`);
