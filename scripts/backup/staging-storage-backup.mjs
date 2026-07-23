#!/usr/bin/env node
/**
 * Staging-only Storage backup (drill-scoped).
 *
 * - Production ref → fail-closed (API çağrısı yok)
 * - Live: yalnız STAGING_* kimlikleri + staging ref
 * - Kaynak kullanıcı bucket/objelerine dokunmaz (yalnız drill bucket)
 * - Secret değer loglamaz
 *
 * Kullanım:
 *   node scripts/backup/staging-storage-backup.mjs --mode dry-run
 *   node scripts/backup/staging-storage-backup.mjs --mode live --out .tmp-staging-storage-backup
 *
 * Live secret adları (değerler GitHub Environment / lokal export):
 *   STAGING_SUPABASE_URL
 *   STAGING_SUPABASE_SERVICE_ROLE_KEY
 * İsteğe bağlı ikinci hedef:
 *   BACKUP_SECONDARY_DIR  (yerel/CI path; S3 yoksa staging kanıtı için)
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  BACKUP_RETENTION,
  DRILL_BUCKET_PREFIX,
  STAGING_PROJECT_REF,
  assertStagingOnlyBackupTarget,
  extractSupabaseProjectRef,
  normalize,
  redactSecrets,
} from "./lib/stagingBackupGuard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argValue(flag, fallback = "") {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function fail(code, message, extra = {}) {
  const payload = {
    ok: false,
    code,
    message: redactSecrets(message),
    ...extra,
  };
  console.error(`FAIL  ${payload.code}: ${payload.message}`);
  process.exitCode = 1;
  return payload;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const mode = normalize(argValue("--mode", "dry-run")).toLowerCase();
const outDir = path.resolve(
  root,
  argValue("--out", path.join(root, ".tmp-staging-storage-backup"))
);
const runId = argValue("--run-id", randomUUID());
const doCleanup = !hasFlag("--no-cleanup");
const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

async function runDryRun() {
  const guard = assertStagingOnlyBackupTarget({ mode: "dry-run" });
  if (!guard.ok) {
    fail(guard.code, guard.message, { projectRef: guard.projectRef });
    process.exit(1);
  }

  const content = Buffer.from(
    `ANNVERO staging storage backup dry-run\nrun_id=${runId}\n`,
    "utf8"
  );
  const objectPath = `drill/${runId}/proof.txt`;
  const checksum = sha256(content);
  const bucket = `${DRILL_BUCKET_PREFIX}dryrun`;

  const objects = [
    {
      bucket,
      path: objectPath,
      size: content.length,
      checksum_sha256: checksum,
      private: true,
      synthetic: true,
    },
  ];

  const storageManifest = {
    kind: "staging_storage_backup_manifest",
    run_id: runId,
    generated_at: new Date().toISOString(),
    dry_run: true,
    mode: "dry-run",
    project_ref_allowed: STAGING_PROJECT_REF,
    production_ref_forbidden: true,
    retention_policy: BACKUP_RETENTION,
    secondary_target: normalize(process.env.BACKUP_SECONDARY_DIR) || "NOT_CONFIGURED",
    mutates_user_objects: false,
    objects,
    totals: {
      object_count: objects.length,
      bytes: content.length,
    },
  };

  const envelope = {
    kind: "staging_storage_backup_envelope",
    run_id: runId,
    dry_run: true,
    objects: objects.map((o) => ({
      ...o,
      content_base64: content.toString("base64"),
    })),
  };

  const envelopeJson = JSON.stringify(envelope, null, 2);
  const envelopeChecksum = sha256(Buffer.from(envelopeJson, "utf8"));
  const manifest = {
    algorithm: "sha256",
    checksum: envelopeChecksum,
    bytes: Buffer.byteLength(envelopeJson, "utf8"),
    run_id: runId,
    dry_run: true,
    generated_at: storageManifest.generated_at,
    retention_policy: BACKUP_RETENTION,
    restore_verified: true,
    note: "Dry-run: sentetik envelope; ağ / Staging API yok",
  };

  // Restore doğrulama (yerel): envelope → içerik checksum
  const restored = Buffer.from(envelope.objects[0].content_base64, "base64");
  const restoreMatch = sha256(restored) === checksum;

  fs.mkdirSync(outDir, { recursive: true });
  const envelopePath = path.join(outDir, "staging-storage-backup-envelope.json");
  const manifestPath = path.join(outDir, "staging-storage-backup-manifest.json");
  const storagePath = path.join(outDir, "storage-backup-manifest.json");
  fs.writeFileSync(envelopePath, envelopeJson, "utf8");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(storagePath, JSON.stringify(storageManifest, null, 2), "utf8");

  if (!restoreMatch) {
    fail("RESTORE_CHECKSUM_MISMATCH", "Dry-run restore checksum uyuşmadı");
    process.exit(1);
  }

  const verify = sha256(fs.readFileSync(envelopePath));
  if (verify !== envelopeChecksum) {
    fail("MANIFEST_CHECKSUM_MISMATCH", "Envelope checksum uyuşmadı");
    process.exit(1);
  }

  console.log("PASS  staging storage backup dry-run");
  console.log(`  run_id: ${runId}`);
  console.log(`  objects: ${objects.length}`);
  console.log(`  restore_match: ${restoreMatch}`);
  console.log(`  secondary: ${storageManifest.secondary_target}`);
  console.log(`  retention_daily_days: ${BACKUP_RETENTION.daily_days}`);
}

async function runLive() {
  const stagingUrl = normalize(process.env.STAGING_SUPABASE_URL);
  const stagingKey = normalize(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);

  // Canlı modda genel NEXT_PUBLIC / SERVICE_ROLE kullanılmaz (prod .env.local kazası engeli)
  const accidentalUrl = normalize(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  );
  if (!stagingUrl && accidentalUrl) {
    const accidentalRef = extractSupabaseProjectRef(accidentalUrl);
    const guardAccidental = assertStagingOnlyBackupTarget({
      supabaseUrl: accidentalUrl,
      mode: "live",
    });
    if (!guardAccidental.ok) {
      fail(guardAccidental.code, guardAccidental.message, {
        projectRef: accidentalRef,
        hint: "STAGING_SUPABASE_URL kullanın; genel SUPABASE URL canlı backup için kabul edilmez.",
      });
      process.exit(1);
    }
  }

  if (!stagingUrl || !stagingKey) {
    fail(
      "STAGING_SECRETS_MISSING",
      "Live backup için STAGING_SUPABASE_URL ve STAGING_SUPABASE_SERVICE_ROLE_KEY gerekli. Değer uydurulmadı.",
      {
        blocked: true,
        required_secret_names: [
          "STAGING_SUPABASE_URL",
          "STAGING_SUPABASE_SERVICE_ROLE_KEY",
        ],
        optional_secret_names: [
          "BACKUP_SECONDARY_DIR",
          "BACKUP_SECONDARY_S3_BUCKET",
          "BACKUP_ENCRYPTION_KEY",
        ],
      }
    );
    process.exit(2);
  }

  const guard = assertStagingOnlyBackupTarget({
    supabaseUrl: stagingUrl,
    mode: "live",
  });
  if (!guard.ok) {
    fail(guard.code, guard.message, { projectRef: guard.projectRef });
    process.exit(1);
  }

  const bucket = `${DRILL_BUCKET_PREFIX}${dateStamp}`;
  const objectPath = `proof/${runId}.txt`;
  const content = Buffer.from(
    `ANNVERO staging auto storage backup proof\nref=${STAGING_PROJECT_REF}\nrun_id=${runId}\n`,
    "utf8"
  );
  const sourceChecksum = sha256(content);

  const supabase = createClient(stagingUrl, stagingKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /** @type {{ step: string, ok: boolean, detail?: string }[]} */
  const steps = [];

  try {
    const { data: existingBuckets, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) {
      throw new Error(`listBuckets: ${redactSecrets(listErr.message)}`);
    }
    const exists = (existingBuckets || []).some((b) => b.name === bucket);
    if (!exists) {
      const { error: createErr } = await supabase.storage.createBucket(bucket, {
        public: false,
        fileSizeLimit: "1MB",
        allowedMimeTypes: ["text/plain"],
      });
      if (createErr) {
        throw new Error(`createBucket: ${redactSecrets(createErr.message)}`);
      }
      steps.push({ step: "create_drill_bucket", ok: true, detail: bucket });
    } else {
      steps.push({ step: "reuse_drill_bucket", ok: true, detail: bucket });
    }

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(objectPath, content, {
        contentType: "text/plain",
        upsert: false,
      });
    if (upErr) {
      throw new Error(`upload: ${redactSecrets(upErr.message)}`);
    }
    steps.push({ step: "upload_synthetic_object", ok: true });

    const { data: dl, error: dlErr } = await supabase.storage
      .from(bucket)
      .download(objectPath);
    if (dlErr) {
      throw new Error(`download: ${redactSecrets(dlErr.message)}`);
    }
    const downloaded = Buffer.from(await dl.arrayBuffer());
    const backupChecksum = sha256(downloaded);
    if (backupChecksum !== sourceChecksum) {
      throw new Error("BACKUP_MATCH failed");
    }
    steps.push({ step: "backup_download_checksum", ok: true });

    const restorePath = `restore/${runId}.txt`;
    const { error: restoreUpErr } = await supabase.storage
      .from(bucket)
      .upload(restorePath, downloaded, {
        contentType: "text/plain",
        upsert: false,
      });
    if (restoreUpErr) {
      throw new Error(`restore_upload: ${redactSecrets(restoreUpErr.message)}`);
    }
    const { data: restoredBlob, error: restoreDlErr } = await supabase.storage
      .from(bucket)
      .download(restorePath);
    if (restoreDlErr) {
      throw new Error(`restore_download: ${redactSecrets(restoreDlErr.message)}`);
    }
    const restored = Buffer.from(await restoredBlob.arrayBuffer());
    const restoreChecksum = sha256(restored);
    if (restoreChecksum !== sourceChecksum) {
      throw new Error("RESTORE_MATCH failed");
    }
    steps.push({ step: "restore_verify", ok: true });

    const secondaryDir = normalize(process.env.BACKUP_SECONDARY_DIR);
    let secondaryTarget = "NOT_CONFIGURED";
    if (secondaryDir) {
      const secondaryRoot = path.resolve(secondaryDir, runId);
      fs.mkdirSync(secondaryRoot, { recursive: true });
      const secondaryFile = path.join(secondaryRoot, "proof.txt");
      fs.writeFileSync(secondaryFile, downloaded);
      const secondaryChecksum = sha256(fs.readFileSync(secondaryFile));
      if (secondaryChecksum !== sourceChecksum) {
        throw new Error("SECONDARY_MATCH failed");
      }
      secondaryTarget = secondaryRoot;
      steps.push({ step: "secondary_local_copy", ok: true });
    }

    const objects = [
      {
        bucket,
        path: objectPath,
        size: content.length,
        checksum_sha256: sourceChecksum,
        private: true,
        synthetic: true,
      },
      {
        bucket,
        path: restorePath,
        size: restored.length,
        checksum_sha256: restoreChecksum,
        private: true,
        synthetic: true,
        role: "restore_copy",
      },
    ];

    const storageManifest = {
      kind: "staging_storage_backup_manifest",
      run_id: runId,
      generated_at: new Date().toISOString(),
      dry_run: false,
      mode: "live",
      project_ref: STAGING_PROJECT_REF,
      production_impact: "NONE",
      retention_policy: BACKUP_RETENTION,
      secondary_target: secondaryTarget,
      secondary_s3: normalize(process.env.BACKUP_SECONDARY_S3_BUCKET) || "NOT_CONFIGURED",
      mutates_user_objects: false,
      drill_bucket_only: true,
      objects,
      totals: {
        object_count: objects.length,
        bytes: objects.reduce((s, o) => s + o.size, 0),
      },
      BACKUP_MATCH: true,
      RESTORE_MATCH: true,
      steps,
      declared_complete: secondaryTarget !== "NOT_CONFIGURED",
      reason_incomplete:
        secondaryTarget === "NOT_CONFIGURED"
          ? "İkinci hedef (BACKUP_SECONDARY_DIR veya S3) yok — drill PASS; complete backup sayılmaz."
          : null,
    };

    const envelope = {
      kind: "staging_storage_backup_envelope",
      run_id: runId,
      dry_run: false,
      project_ref: STAGING_PROJECT_REF,
      objects: [
        {
          bucket,
          path: objectPath,
          checksum_sha256: sourceChecksum,
          content_base64: downloaded.toString("base64"),
        },
      ],
    };
    const envelopeJson = JSON.stringify(envelope, null, 2);
    const envelopeChecksum = sha256(Buffer.from(envelopeJson, "utf8"));

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "staging-storage-backup-envelope.json"),
      envelopeJson,
      "utf8"
    );
    fs.writeFileSync(
      path.join(outDir, "staging-storage-backup-manifest.json"),
      JSON.stringify(
        {
          algorithm: "sha256",
          checksum: envelopeChecksum,
          bytes: Buffer.byteLength(envelopeJson, "utf8"),
          run_id: runId,
          dry_run: false,
          BACKUP_MATCH: true,
          RESTORE_MATCH: true,
          retention_policy: BACKUP_RETENTION,
        },
        null,
        2
      ),
      "utf8"
    );
    fs.writeFileSync(
      path.join(outDir, "storage-backup-manifest.json"),
      JSON.stringify(storageManifest, null, 2),
      "utf8"
    );

    if (doCleanup) {
      await supabase.storage.from(bucket).remove([objectPath, restorePath]);
      const { error: delBucketErr } = await supabase.storage.deleteBucket(bucket);
      if (delBucketErr) {
        // Bucket boş değilse veya API kısıtı — nesneler silindi; bucket silme fail-soft log
        steps.push({
          step: "cleanup_bucket",
          ok: false,
          detail: redactSecrets(delBucketErr.message),
        });
        console.error(
          `WARN  drill bucket silinemedi (nesneler silindi): ${redactSecrets(delBucketErr.message)}`
        );
      } else {
        steps.push({ step: "cleanup_bucket", ok: true });
      }
      storageManifest.cleanup = {
        synthetic_objects_deleted: true,
        drill_bucket_deleted: !delBucketErr,
      };
      fs.writeFileSync(
        path.join(outDir, "storage-backup-manifest.json"),
        JSON.stringify(storageManifest, null, 2),
        "utf8"
      );
    }

    console.log("PASS  staging storage backup live (drill-scoped)");
    console.log(`  run_id: ${runId}`);
    console.log(`  project_ref: ${STAGING_PROJECT_REF}`);
    console.log(`  BACKUP_MATCH: true`);
    console.log(`  RESTORE_MATCH: true`);
    console.log(`  secondary: ${secondaryTarget}`);
    console.log(`  cleanup: ${doCleanup ? "attempted" : "skipped"}`);
    console.log(`  declared_complete: ${storageManifest.declared_complete}`);
  } catch (err) {
    fail("LIVE_BACKUP_ERROR", err?.message || String(err), {
      projectRef: STAGING_PROJECT_REF,
      steps,
    });
    // Best-effort cleanup on failure (yalnız drill)
    if (doCleanup) {
      try {
        await supabase.storage.from(bucket).remove([objectPath, `restore/${runId}.txt`]);
        await supabase.storage.deleteBucket(bucket);
      } catch {
        /* ignore */
      }
    }
    process.exit(1);
  }
}

async function main() {
  if (mode !== "dry-run" && mode !== "live") {
    fail("INVALID_MODE", `Geçersiz --mode: ${mode} (dry-run|live)`);
    process.exit(1);
  }

  // Guard self-check: production URL asla geçmemeli
  const prodProbe = assertStagingOnlyBackupTarget({
    projectRef: "ttxigznwcjvrlzuppbro",
    mode: "live",
  });
  if (prodProbe.ok) {
    fail("GUARD_BROKEN", "Production ref live modda kabul edildi — abort");
    process.exit(1);
  }

  if (mode === "dry-run") {
    await runDryRun();
    return;
  }
  await runLive();
}

main().catch((err) => {
  fail("UNHANDLED", err?.message || String(err));
  process.exit(1);
});
