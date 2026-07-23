#!/usr/bin/env node
/**
 * Production Supabase Storage -> yerel immutable-upload hazırlığı.
 *
 * Kaynak Supabase'te yalnız listBuckets/list/download çağrıları vardır.
 * createBucket/upload/update/move/copy/remove/deleteBucket YOK.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  PRODUCTION_PROJECT_REF,
  assertProductionBackupTarget,
  normalize,
  redactSecrets,
  safeLocalObjectPath,
} from "./lib/productionBackupGuard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argValue(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

function fail(code, message) {
  console.error(`FAIL  ${code}: ${redactSecrets(message)}`);
  process.exit(1);
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

const mode = normalize(argValue("--mode", "dry-run")).toLowerCase();
const outDir = path.resolve(
  root,
  argValue("--out", path.join(root, ".tmp-production-storage-backup"))
);
const runId = normalize(argValue("--run-id", randomUUID()));
const maxTotalBytes = Number(
  normalize(process.env.PRODUCTION_BACKUP_MAX_BYTES) || 5 * 1024 ** 3
);
const maxObjectBytes = Number(
  normalize(process.env.PRODUCTION_BACKUP_MAX_OBJECT_BYTES) || 2 * 1024 ** 3
);

function writeJson(name, value) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2), "utf8");
}

function buildProof(manifest) {
  const digestInput = manifest.objects
    .map((item) => `${item.bucket}\0${item.path}\0${item.bytes}\0${item.sha256 || ""}`)
    .sort()
    .join("\n");
  return {
    kind: "production_storage_backup_proof",
    run_id: manifest.run_id,
    generated_at: manifest.generated_at,
    mode: manifest.mode,
    project_ref: manifest.project_ref,
    source_read_only: true,
    source_mutation_attempted: false,
    bucket_count: manifest.totals.bucket_count,
    object_count: manifest.totals.object_count,
    bytes: manifest.totals.bytes,
    inventory_digest_sha256: sha256(Buffer.from(digestInput, "utf8")),
    complete: manifest.complete,
  };
}

async function listObjectsRecursive(supabase, bucket, prefix = "") {
  const found = [];
  let offset = 0;
  const limit = 100;

  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`list object metadata failed: ${error.message}`);
    const page = data || [];
    for (const entry of page) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const isFolder =
        !entry.id &&
        !entry.metadata &&
        entry.name &&
        !entry.name.endsWith("/");
      if (isFolder) {
        found.push(...(await listObjectsRecursive(supabase, bucket, entryPath)));
      } else if (entry.name) {
        found.push({
          bucket,
          path: entryPath,
          metadata_bytes: Number(entry.metadata?.size || 0),
          content_type: normalize(entry.metadata?.mimetype || ""),
          updated_at: entry.updated_at || null,
        });
      }
    }
    if (page.length < limit) break;
    offset += limit;
  }
  return found;
}

async function runDryRun() {
  const guard = assertProductionBackupTarget({ mode: "dry-run" });
  if (!guard.ok) fail(guard.code, "production dry-run guard failed");
  const manifest = {
    kind: "production_storage_backup_manifest",
    run_id: runId,
    generated_at: new Date().toISOString(),
    mode,
    project_ref: PRODUCTION_PROJECT_REF,
    dry_run: true,
    source_read_only: true,
    source_mutation_attempted: false,
    complete: true,
    objects: [],
    totals: { bucket_count: 0, object_count: 0, bytes: 0 },
  };
  writeJson("production-storage-backup-manifest.json", manifest);
  writeJson("production-storage-backup-proof.json", buildProof(manifest));
  console.log("PASS  production storage backup dry-run (no network)");
}

async function runNetwork() {
  const url = normalize(process.env.PRODUCTION_SUPABASE_URL);
  const key = normalize(process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    fail(
      "PRODUCTION_SECRETS_MISSING",
      "PRODUCTION_SUPABASE_URL ve PRODUCTION_SUPABASE_SERVICE_ROLE_KEY gerekli"
    );
  }
  const guard = assertProductionBackupTarget({ supabaseUrl: url, mode });
  if (!guard.ok) fail(guard.code, `production target guard blocked ref=${guard.projectRef}`);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) fail("LIST_BUCKETS", bucketError.message);

  const objects = [];
  for (const bucket of buckets || []) {
    objects.push(...(await listObjectsRecursive(supabase, bucket.name)));
  }

  let totalBytes = 0;
  if (mode === "live") {
    for (const item of objects) {
      if (item.metadata_bytes > maxObjectBytes) {
        fail("OBJECT_LIMIT", "Bir kaynak nesne güvenli runner boyut sınırını aşıyor");
      }
      const { data, error } = await supabase.storage
        .from(item.bucket)
        .download(item.path);
      if (error) fail("DOWNLOAD", error.message);
      const body = Buffer.from(await data.arrayBuffer());
      totalBytes += body.length;
      if (totalBytes > maxTotalBytes) {
        fail("TOTAL_LIMIT", "Toplam kaynak boyutu güvenli runner sınırını aşıyor");
      }
      const localPath = safeLocalObjectPath(outDir, item.bucket, item.path);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, body, { flag: "wx" });
      item.bytes = body.length;
      item.sha256 = sha256(body);
      item.local_rel_path = path.relative(outDir, localPath).replaceAll("\\", "/");
    }
  } else {
    totalBytes = objects.reduce((sum, item) => sum + item.metadata_bytes, 0);
    for (const item of objects) item.bytes = item.metadata_bytes;
  }

  const manifest = {
    kind: "production_storage_backup_manifest",
    run_id: runId,
    generated_at: new Date().toISOString(),
    mode,
    project_ref: guard.projectRef,
    dry_run: false,
    source_read_only: true,
    source_mutation_attempted: false,
    complete: mode === "live",
    objects,
    totals: {
      bucket_count: (buckets || []).length,
      object_count: objects.length,
      bytes: totalBytes,
    },
  };
  writeJson("production-storage-backup-manifest.json", manifest);
  writeJson("production-storage-backup-proof.json", buildProof(manifest));
  console.log(`PASS  production storage ${mode}`);
  console.log(`  buckets: ${manifest.totals.bucket_count}`);
  console.log(`  objects: ${manifest.totals.object_count}`);
  console.log(`  bytes: ${manifest.totals.bytes}`);
  console.log("  source_mutation_attempted: false");
}

async function main() {
  const guardProbe = assertProductionBackupTarget({
    projectRef: "bveipjvbopbkvojfdpmo",
    mode: "live",
  });
  if (guardProbe.ok) fail("GUARD_BROKEN", "staging ref production backup tarafından kabul edildi");
  if (mode === "dry-run") return runDryRun();
  if (!["inventory", "live"].includes(mode)) fail("INVALID_MODE", mode);
  return runNetwork();
}

main().catch((error) => fail("UNHANDLED", error?.message || String(error)));
