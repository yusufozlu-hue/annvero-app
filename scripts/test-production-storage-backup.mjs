import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  assertProductionBackupTarget,
  safeLocalObjectPath,
} from "./backup/lib/productionBackupGuard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(
  assertProductionBackupTarget({ projectRef: PRODUCTION_PROJECT_REF, mode: "live" }).ok,
  true
);
assert.equal(
  assertProductionBackupTarget({ projectRef: STAGING_PROJECT_REF, mode: "live" }).ok,
  false
);
assert.equal(
  assertProductionBackupTarget({ projectRef: "unexpected", mode: "inventory" }).ok,
  false
);
assert.equal(assertProductionBackupTarget({ mode: "dry-run" }).ok, true);

const safePath = safeLocalObjectPath("/tmp/out", "bucket-a", "../../customer.pdf");
assert.match(safePath, /^\/tmp\/out\/objects\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.bin$/);
assert.doesNotMatch(safePath, /\.\.\//);

const source = fs.readFileSync(
  path.join(root, "scripts/backup/production-storage-backup.mjs"),
  "utf8"
);
for (const forbidden of [
  ".createBucket(",
  ".upload(",
  ".move(",
  ".copy(",
  ".remove(",
  ".deleteBucket(",
]) {
  assert.equal(source.includes(forbidden), false, `source mutation forbidden: ${forbidden}`);
}
assert.match(source, /\.listBuckets\(\)/);
assert.match(source, /\.list\(prefix,/);
assert.match(source, /\.download\(item\.path\)/);

const uploader = fs.readFileSync(
  path.join(root, "scripts/backup/upload-production-immutable-s3.mjs"),
  "utf8"
);
assert.doesNotMatch(uploader, /delete-object|delete-bucket|BypassGovernance|PutObjectRetention/);
assert.match(
  uploader,
  /\$\{PRODUCTION_S3_PREFIX\}\/\$\{date\}\/\$\{runId\}/
);
assert.match(uploader, /COMPLIANCE/);

const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/production-storage-backup.yml"),
  "utf8"
);
assert.match(workflow, /environment:\s*production-backup/);
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /^\s*schedule:/m);
assert.match(workflow, /PRODUCTION_SUPABASE_URL/);
assert.match(workflow, /PRODUCTION_SUPABASE_SERVICE_ROLE_KEY/);
assert.match(workflow, /id-token:\s*write/);
assert.doesNotMatch(workflow, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
assert.doesNotMatch(workflow, /security\/staging-hardening/);

console.log("PASS  production Storage backup static guards");
