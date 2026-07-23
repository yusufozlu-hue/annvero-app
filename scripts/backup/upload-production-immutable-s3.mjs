#!/usr/bin/env node
/**
 * Production Storage yerel kopyası -> immutable S3.
 * OIDC session kullanır; delete ve retention değiştirme çağrısı içermez.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  IMMUTABLE_RETENTION_DAYS,
  PRODUCTION_PROJECT_REF,
  PRODUCTION_S3_PREFIX,
  PRODUCTION_SOURCE_METADATA,
  encodePathPart,
  normalize,
  redactSecrets,
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
function awsJson(args) {
  const result = spawnSync("aws", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    fail("AWS_CLI", result.error?.message || result.stderr || result.stdout);
  }
  try {
    return result.stdout.trim() ? JSON.parse(result.stdout) : {};
  } catch {
    fail("AWS_JSON", "AWS çıktısı JSON değil");
  }
}

const outDir = path.resolve(
  root,
  argValue("--out", path.join(root, ".tmp-production-storage-backup"))
);
const runId = normalize(argValue("--github-run-id", process.env.GITHUB_RUN_ID));
const bucket = normalize(process.env.BACKUP_SECONDARY_S3_BUCKET);
const manifestPath = path.join(outDir, "production-storage-backup-manifest.json");

if (!runId) fail("RUN_ID_REQUIRED", "GitHub run id gerekli");
if (!bucket) fail("BUCKET_REQUIRED", "S3 bucket variable gerekli");
if (!fs.existsSync(manifestPath)) fail("MANIFEST_MISSING", "production manifest yok");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (
  manifest.project_ref !== PRODUCTION_PROJECT_REF ||
  manifest.mode !== "live" ||
  manifest.source_read_only !== true ||
  manifest.source_mutation_attempted !== false ||
  manifest.complete !== true
) {
  fail("MANIFEST_GUARD", "production live/read-only/complete manifest sözleşmesi sağlanmadı");
}

const date = new Date().toISOString().slice(0, 10);
const uploaded = [];

function uploadAndVerify(localPath, key, expectedSha, expectedBytes) {
  const metadata = [
    `source=${PRODUCTION_SOURCE_METADATA}`,
    `github-run-id=${runId}`,
    `sha256=${expectedSha}`,
  ].join(",");
  awsJson([
    "s3api", "put-object",
    "--bucket", bucket,
    "--key", key,
    "--body", localPath,
    "--metadata", metadata,
    "--checksum-algorithm", "SHA256",
  ]);
  const head = awsJson([
    "s3api", "head-object",
    "--bucket", bucket,
    "--key", key,
    "--checksum-mode", "ENABLED",
  ]);
  if (normalize(head.ObjectLockMode).toUpperCase() !== "COMPLIANCE") {
    fail("OBJECT_LOCK_MODE", "COMPLIANCE doğrulanamadı");
  }
  const retain = new Date(head.ObjectLockRetainUntilDate || "");
  const minRetain = Date.now() + (IMMUTABLE_RETENTION_DAYS - 1) * 86400000;
  if (Number.isNaN(retain.getTime()) || retain.getTime() < minRetain) {
    fail("RETAIN_UNTIL", "35 günlük retention doğrulanamadı");
  }
  if (Number(head.ContentLength) !== Number(expectedBytes)) {
    fail("CONTENT_LENGTH", "S3 içerik boyutu uyuşmadı");
  }
  if (normalize(head.Metadata?.sha256).toLowerCase() !== expectedSha.toLowerCase()) {
    fail("HEAD_CHECKSUM", "S3 checksum metadata uyuşmadı");
  }
  const verifyPath = path.join(outDir, `.verify-${encodePathPart(key)}`);
  const copy = spawnSync("aws", ["s3", "cp", `s3://${bucket}/${key}`, verifyPath], {
    encoding: "utf8",
    env: process.env,
  });
  if (copy.status !== 0 || !fs.existsSync(verifyPath)) {
    fail("REDOWNLOAD", copy.stderr || copy.stdout || "S3 re-download başarısız");
  }
  const downloadedSha = sha256(fs.readFileSync(verifyPath));
  fs.unlinkSync(verifyPath);
  if (downloadedSha !== expectedSha) fail("REDOWNLOAD_CHECKSUM", "S3 re-download SHA-256 uyuşmadı");
  uploaded.push({ key, bytes: expectedBytes, sha256: expectedSha, retain_until: retain.toISOString() });
}

for (const item of manifest.objects) {
  const localPath = path.resolve(outDir, item.local_rel_path || "");
  if (!localPath.startsWith(`${outDir}${path.sep}`) || !fs.existsSync(localPath)) {
    fail("LOCAL_OBJECT_PATH", "manifest local path güvenli değil veya dosya yok");
  }
  const body = fs.readFileSync(localPath);
  if (sha256(body) !== item.sha256 || body.length !== item.bytes) {
    fail("LOCAL_CHECKSUM", "yerel production backup checksum uyuşmadı");
  }
  const key = `${PRODUCTION_S3_PREFIX}/${date}/${runId}/objects/${encodePathPart(item.bucket)}/${encodePathPart(item.path)}.bin`;
  uploadAndVerify(localPath, key, item.sha256, item.bytes);
}

const manifestBody = fs.readFileSync(manifestPath);
const manifestSha = sha256(manifestBody);
uploadAndVerify(
  manifestPath,
  `${PRODUCTION_S3_PREFIX}/${date}/${runId}/production-storage-backup-manifest.json`,
  manifestSha,
  manifestBody.length
);

fs.writeFileSync(
  path.join(outDir, "production-immutable-s3-proof.json"),
  JSON.stringify(
    {
      kind: "production_immutable_s3_proof",
      run_id: runId,
      source: PRODUCTION_SOURCE_METADATA,
      object_lock_mode: "COMPLIANCE",
      retention_days: IMMUTABLE_RETENTION_DAYS,
      uploaded_count: uploaded.length,
      uploaded_bytes: uploaded.reduce((sum, item) => sum + item.bytes, 0),
      delete_attempted: false,
      source_mutation_attempted: false,
      generated_at: new Date().toISOString(),
    },
    null,
    2
  )
);
console.log("PASS  production immutable S3 upload + full checksum verify");
console.log(`  uploaded: ${uploaded.length}`);
console.log("  delete_attempted: false");
