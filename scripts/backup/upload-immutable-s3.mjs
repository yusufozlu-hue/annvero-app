#!/usr/bin/env node
/**
 * Staging backup artifact → immutable S3 ikinci hedef (OIDC sonrası).
 *
 * - Access key kullanmaz (AWS CLI + OIDC session)
 * - DeleteObject / retention değiştirme YOK
 * - Production Supabase ref ile ilgisi yok; yalnız S3 vars
 *
 * Kullanım:
 *   node scripts/backup/upload-immutable-s3.mjs --dry-run --out ./backup-artifacts --github-run-id 1
 *   node scripts/backup/upload-immutable-s3.mjs --out ./backup-artifacts --github-run-id "$GITHUB_RUN_ID"
 *
 * Env (değer loglanmaz):
 *   BACKUP_SECONDARY_S3_BUCKET
 *   AWS_REGION (opsiyonel; CLI default)
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SOURCE_METADATA,
  assertDownloadedChecksum,
  assertImmutableHeadObject,
  buildS3ObjectKey,
  sha256Hex,
} from "./lib/s3ImmutableSecondary.mjs";
import { redactSecrets, normalize } from "./lib/stagingBackupGuard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argValue(flag, fallback = "") {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function fail(code, message) {
  console.error(`FAIL  ${code}: ${redactSecrets(message)}`);
  process.exit(1);
}

function awsJson(args) {
  const res = spawnSync("aws", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  });
  if (res.error) {
    fail("AWS_CLI", res.error.message);
  }
  if (res.status !== 0) {
    fail("AWS_CLI", redactSecrets(res.stderr || res.stdout || `exit ${res.status}`));
  }
  const out = (res.stdout || "").trim();
  if (!out) return {};
  try {
    return JSON.parse(out);
  } catch {
    fail("AWS_JSON", "aws çıktısı JSON değil");
  }
}

const dryRun = hasFlag("--dry-run");
const outDir = path.resolve(root, argValue("--out", path.join(root, ".tmp-staging-storage-backup")));
const githubRunId = normalize(argValue("--github-run-id", process.env.GITHUB_RUN_ID || ""));
const bucket = normalize(process.env.BACKUP_SECONDARY_S3_BUCKET || "");

const CANDIDATE_FILES = [
  "staging-storage-backup-envelope.json",
  "staging-storage-backup-manifest.json",
  "storage-backup-manifest.json",
];

function listLocalArtifacts() {
  if (!fs.existsSync(outDir)) {
    fail("OUT_DIR_MISSING", `out dir yok: ${outDir}`);
  }
  const files = CANDIDATE_FILES.filter((f) => fs.existsSync(path.join(outDir, f)));
  if (!files.length) {
    fail("NO_ARTIFACTS", "backup-artifacts içinde yüklenecek dosya yok");
  }
  return files.map((name) => {
    const full = path.join(outDir, name);
    const body = fs.readFileSync(full);
    return { name, full, body, sha256: sha256Hex(body), bytes: body.length };
  });
}

function runDryRun(artifacts) {
  if (!githubRunId) {
    fail("GITHUB_RUN_ID_REQUIRED", "--github-run-id veya GITHUB_RUN_ID gerekli");
  }
  const now = new Date();
  for (const art of artifacts) {
    const key = buildS3ObjectKey({
      dateUtc: now,
      githubRunId,
      fileName: art.name,
    });
    const mockHead = {
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: new Date(
        now.getTime() + 35 * 24 * 60 * 60 * 1000
      ).toISOString(),
      ContentLength: art.bytes,
      Metadata: {
        source: SOURCE_METADATA,
        "github-run-id": githubRunId,
        sha256: art.sha256,
      },
    };
    const headAssert = assertImmutableHeadObject(mockHead, {
      sha256Expected: art.sha256,
      contentLength: art.bytes,
      githubRunId,
      now,
    });
    if (!headAssert.ok) fail(headAssert.code, headAssert.message);
    const dlAssert = assertDownloadedChecksum(art.body, art.sha256);
    if (!dlAssert.ok) fail(dlAssert.code, "download checksum mock fail");
    console.log(`PASS  dry-run s3 plan key=${key} bytes=${art.bytes}`);
  }
  console.log("PASS  immutable S3 secondary dry-run (no AWS)");
  console.log(`  artifacts: ${artifacts.length}`);
  console.log(`  github_run_id: ${githubRunId}`);
  console.log(`  bucket_env_present: ${Boolean(bucket)}`);
}

function runLive(artifacts) {
  if (!githubRunId) {
    fail("GITHUB_RUN_ID_REQUIRED", "--github-run-id veya GITHUB_RUN_ID gerekli");
  }
  if (!bucket) {
    fail(
      "S3_BUCKET_MISSING",
      "BACKUP_SECONDARY_S3_BUCKET (vars) gerekli — değer loglanmaz"
    );
  }

  // Role ARN yalnız varlığını logla (değerin tamamını basma — uzun ARN kabul; secret değil)
  const roleArn = normalize(process.env.AWS_ROLE_ARN || "");
  if (roleArn) {
    const safeArn = roleArn.replace(/arn:aws:iam::\d+:role\//, "arn:aws:iam::****:role/");
    console.log(`  role_arn_redacted: ${safeArn}`);
  }

  const now = new Date();
  const results = [];

  for (const art of artifacts) {
    const key = buildS3ObjectKey({
      dateUtc: now,
      githubRunId,
      fileName: art.name,
    });
    const meta = [
      `source=${SOURCE_METADATA}`,
      `github-run-id=${githubRunId}`,
      `sha256=${art.sha256}`,
    ].join(",");

    awsJson([
      "s3api",
      "put-object",
      "--bucket",
      bucket,
      "--key",
      key,
      "--body",
      art.full,
      "--content-type",
      "application/json",
      "--metadata",
      meta,
      "--checksum-algorithm",
      "SHA256",
    ]);

    const head = awsJson([
      "s3api",
      "head-object",
      "--bucket",
      bucket,
      "--key",
      key,
      "--checksum-mode",
      "ENABLED",
    ]);

    const headAssert = assertImmutableHeadObject(head, {
      sha256Expected: art.sha256,
      contentLength: art.bytes,
      githubRunId,
      now,
    });
    if (!headAssert.ok) {
      fail(headAssert.code, headAssert.message);
    }

    const tmp = path.join(outDir, `.s3-verify-${art.name}`);
    const cp = spawnSync(
      "aws",
      ["s3", "cp", `s3://${bucket}/${key}`, tmp],
      { encoding: "utf8", env: process.env }
    );
    if (cp.status !== 0 || !fs.existsSync(tmp)) {
      fail("S3_CP", redactSecrets(cp.stderr || cp.stdout || "s3 cp failed"));
    }
    const downloaded = fs.readFileSync(tmp);
    const dlAssert = assertDownloadedChecksum(downloaded, art.sha256);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (!dlAssert.ok) {
      fail(dlAssert.code, "S3 re-download checksum uyuşmadı");
    }

    console.log(
      `PASS  s3 immutable object key=${key} lock=${headAssert.objectLockMode} retain=${headAssert.retainUntil}`
    );
    results.push({ key, sha256: art.sha256, bytes: art.bytes });
  }

  const summaryPath = path.join(outDir, "s3-immutable-secondary-manifest.json");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        kind: "s3_immutable_secondary_manifest",
        dry_run: false,
        bucket_configured: true,
        // bucket name is infra id — allowed; no secrets
        bucket,
        github_run_id: githubRunId,
        object_lock_mode_expected: "COMPLIANCE",
        retention_days: 35,
        objects: results,
        delete_attempted: false,
        generated_at: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("PASS  immutable S3 secondary upload + verify");
  console.log(`  objects: ${results.length}`);
  console.log(`  summary: ${path.relative(root, summaryPath)}`);
}

const artifacts = listLocalArtifacts();
if (dryRun) {
  runDryRun(artifacts);
} else {
  runLive(artifacts);
}
