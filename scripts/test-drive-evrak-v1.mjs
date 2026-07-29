/**
 * Drive Evrak V1 — reconcile batch, lease, cron auth static checks.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-drive-evrak-v1.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECONCILE_MAX_COMPANIES_PER_RUN,
  RECONCILE_TIME_BUDGET_MS,
  reconcileTimeRemaining,
  sliceReconcileBatch,
} from "@/src/utils/cloudStorage/reconcileBatch.js";
import {
  classifySyncFailure,
  formatSyncRetryError,
  isSyncRetryDue,
  parseSyncRetryState,
  SYNC_RETRY_PREFIX,
} from "@/src/utils/cloudStorage/syncRetry.js";
import { acquireCompanySyncLease, SYNC_LEASE_STALE_MS } from "@/src/utils/cloudStorage/syncLease.js";
import { FOLDER_STRUCTURE_VERSION } from "@/src/utils/cloudStorage/types.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result
        .then(() => console.log(`PASS ${name}`))
        .catch((error) => {
          console.error(`FAIL ${name}`);
          console.error(error);
          process.exitCode = 1;
        });
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

await test("reconcileBatch: cursor + time budget", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const first = sliceReconcileBatch(ids, { limit: 2 });
  assert.deepEqual(first.batch, ["a", "b"]);
  assert.equal(first.nextCursor, "b");
  const second = sliceReconcileBatch(ids, { cursor: "b", limit: 2 });
  assert.deepEqual(second.batch, ["c", "d"]);
  assert.equal(RECONCILE_MAX_COMPANIES_PER_RUN, 8);
  assert.ok(RECONCILE_TIME_BUDGET_MS < 60_000);
  const start = Date.now() - 1000;
  assert.ok(reconcileTimeRemaining(start) < RECONCILE_TIME_BUDGET_MS);
});

await test("syncRetry: due-state parse + timing", () => {
  const dueAt = Date.now() - 1000;
  const err = formatSyncRetryError(2, dueAt);
  assert.ok(err.startsWith(SYNC_RETRY_PREFIX));
  const state = parseSyncRetryState(err);
  assert.equal(state.attempt, 2);
  assert.ok(isSyncRetryDue(err));
  assert.equal(classifySyncFailure({ code: "SYNC_LEASE_BUSY" }).retryable, true);
});

await test("static: vercel cron + reconcile auth + lease in sync motor", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.ok(Array.isArray(vercel.crons));
  assert.ok(
    vercel.crons.some(
      (c) => c.path === "/api/google-drive/reconcile" && c.schedule === "0 * * * *"
    )
  );

  const reconcileSrc = fs.readFileSync(
    path.join(root, "app/api/google-drive/reconcile/route.js"),
    "utf8"
  );
  assert.ok(reconcileSrc.includes("timingSafeEqual"));
  assert.ok(reconcileSrc.includes("CRON_SECRET"));
  assert.ok(reconcileSrc.includes("enqueueSyncRetry"));
  assert.ok(reconcileSrc.includes("sliceReconcileBatch"));

  const syncSrc = fs.readFileSync(
    path.join(root, "src/utils/cloudStorage/runCompanyDriveSync.js"),
    "utf8"
  );
  assert.ok(syncSrc.includes("acquireCompanySyncLease"));

  const companiesSrc = fs.readFileSync(
    path.join(root, "app/api/companies/route.js"),
    "utf8"
  );
  assert.ok(companiesSrc.includes("PROVISION_QUEUED"));
  assert.ok(companiesSrc.includes("void (async"));

  assert.equal(FOLDER_STRUCTURE_VERSION, "v2");
});

await test("syncLease: stale ms tanımlı", () => {
  assert.ok(SYNC_LEASE_STALE_MS >= 60_000);
  assert.equal(typeof acquireCompanySyncLease, "function");
});

console.log("test-drive-evrak-v1 done");
