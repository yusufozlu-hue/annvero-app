/**
 * Bank Parser reanalyze / revision — dedup ayrımı, full plan, supersedes, tenant.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-parser-reanalyze.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${error.message}`);
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  DUPLICATE_STATEMENT_UI_MESSAGE,
  applySessionMovementDedup,
} = await import("@/src/utils/bankStatementDedup.js");

const {
  REANALYZE_BUTTON_LABEL,
  assertSameTenantReanalyze,
  buildRevisionCompareView,
  buildRevisionIdempotencyKey,
  buildSkippedArchiveSummaryFromPrior,
  countTrulyNotFoundFromGroups,
  deriveRevisionCounters,
  extractAnalysisCounters,
  nextRevisionNumber,
  shouldBypassIdempotencyHistoryBlock,
  shouldBypassSessionDedupBlock,
  shouldSkipDriveArchiveOnReanalyze,
} = await import("@/src/utils/bankStatementReanalyze.js");

const { buildIdempotencyKey } = await import(
  "@/src/utils/annveroV1Orchestration.js"
);

const {
  buildSafeV1PersistPayload,
  sanitizeIncomingV1JobBody,
  V1_SAFE_METADATA_KEYS,
} = await import("@/src/utils/annveroV1SafePersist.js");

const { shouldDefaultCariAutoLearn } = await import(
  "@/src/utils/cariMissingResolutionGroups.js"
);

test("normal re-upload still duplicate-blocked by session dedup", () => {
  const rows = [
    {
      transactionId: "tx-a",
      sourceType: "xlsx",
      direction: "GIRIS",
      amount: 10,
    },
    {
      transactionId: "tx-b",
      sourceType: "xlsx",
      direction: "CIKIS",
      amount: 20,
    },
  ];
  const first = applySessionMovementDedup(rows, new Set(), {
    companyId: "c1",
    sourceFileHash: "hash1",
  });
  assert.equal(first.allDuplicate, false);
  const keys = new Set(first.seenKeys);
  const second = applySessionMovementDedup(rows, keys, {
    companyId: "c1",
    sourceFileHash: "hash1",
  });
  assert.equal(second.allDuplicate, true);
  assert.equal(second.uiMessage, DUPLICATE_STATEMENT_UI_MESSAGE);
  assert.equal(shouldBypassSessionDedupBlock(false), false);
  assert.equal(shouldBypassIdempotencyHistoryBlock(false), false);
});

test("explicit reanalyze bypasses session/history blocks but not normal path", () => {
  assert.equal(shouldBypassSessionDedupBlock(true), true);
  assert.equal(shouldBypassIdempotencyHistoryBlock(true), true);
  assert.equal(shouldSkipDriveArchiveOnReanalyze(true), true);
  assert.equal(shouldSkipDriveArchiveOnReanalyze(false), false);
});

test("reanalyze reuses archive — no second Drive/source copy", () => {
  const archive = buildSkippedArchiveSummaryFromPrior({
    drive_archived: true,
  });
  assert.equal(archive.ok, true);
  assert.equal(archive.skipped, true);
  assert.equal(archive.duplicate, true);
  assert.equal(archive.code, "REANALYZE_REUSE_ARCHIVE");
  assert.equal(archive.safeSummary.reanalyzeReuse, true);
  assert.equal(archive.safeSummary.archived, true);
});

test("revision idempotency key differs from base so old result preserved", () => {
  const base = buildIdempotencyKey({
    companyId: "mare",
    contentHash: "abc",
  });
  const rev2 = buildRevisionIdempotencyKey({
    companyId: "mare",
    contentHash: "abc",
    revision: 2,
  });
  const rev3 = buildRevisionIdempotencyKey({
    companyId: "mare",
    contentHash: "abc",
    revision: 3,
  });
  assert.notEqual(base, rev2);
  assert.notEqual(rev2, rev3);
  assert.ok(rev2.endsWith(":rev:2"));
  assert.equal(nextRevisionNumber(1), 2);
  assert.equal(nextRevisionNumber(2), 3);
});

test("persist payload keeps supersedes / revision audit fields", () => {
  const payload = buildSafeV1PersistPayload({
    companyId: "c1",
    jobId: "job-new",
    idempotencyKey: "annvero-v1:c1:hash:v:rev:2",
    summary: {
      terminalStatus: "completed",
      movementCount: 12,
      reanalyze: true,
      revision: 2,
      revisionOf: "prior-id",
      supersedesJobId: "prior-id",
      accountPlanCount: 4166,
      resolvedMissingCount: 40,
      trulyNotFoundCount: 3,
    },
  });
  assert.equal(payload.metadata.reanalyze, true);
  assert.equal(payload.metadata.revision, 2);
  assert.equal(payload.metadata.supersedes_job_id, "prior-id");
  assert.equal(payload.metadata.revision_of, "prior-id");
  assert.equal(payload.metadata.account_plan_count, 4166);
  assert.ok(V1_SAFE_METADATA_KEYS.includes("supersedes_job_id"));
  assert.ok(V1_SAFE_METADATA_KEYS.includes("account_plan_count"));
});

test("sanitize accepts reanalyze revisionOf flags", () => {
  const body = sanitizeIncomingV1JobBody({
    companyId: "c1",
    action: "persist",
    reanalyze: true,
    revisionOf: "prior-xyz",
    revision: 2,
    supersedesJobId: "prior-xyz",
    summary: { terminalStatus: "completed", movementCount: 1 },
  });
  assert.equal(body.reanalyze, true);
  assert.equal(body.revisionOf, "prior-xyz");
  assert.equal(body.revision, 2);
});

test("cross-tenant reanalyze → 403", () => {
  const ok = assertSameTenantReanalyze({
    requestCompanyId: "a",
    priorCompanyId: "a",
  });
  assert.equal(ok.ok, true);
  const bad = assertSameTenantReanalyze({
    requestCompanyId: "a",
    priorCompanyId: "b",
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 403);
  assert.equal(bad.code, "CROSS_TENANT_FORBIDDEN");
});

test("previous vs new counters: auto-matched, review, resolved, truly not found", () => {
  const compare = deriveRevisionCounters({
    previous: {
      auto_matched_count: 10,
      review_count: 50,
    },
    next: {
      autoMatchedCount: 45,
      uniqueUnresolvedMovements: 12,
    },
    trulyNotFoundCount: 4,
  });
  assert.equal(compare.previous.autoMatched, 10);
  assert.equal(compare.previous.remainingReview, 50);
  assert.equal(compare.next.autoMatched, 45);
  assert.equal(compare.next.remainingReview, 12);
  assert.equal(compare.resolvedMissing, 38);
  assert.equal(compare.trulyNotFound, 4);
  const view = buildRevisionCompareView(compare);
  assert.equal(view.rows.length, 4);
  assert.equal(view.rows[0].key, "autoMatched");
  assert.equal(view.rows[3].key, "trulyNotFound");
});

test("truly not found from unresolved groups without suggestion", () => {
  const n = countTrulyNotFoundFromGroups([
    { count: 3, suggestedAccount: "", partyUnresolved: true },
    { count: 2, suggestedAccount: "120.01", partyUnresolved: false },
    { rowIds: ["a", "b"], suggestedAccount: "", partyUnresolvedForced: true },
  ]);
  assert.equal(n, 5);
});

test("learn default ON when leaf account selected; Uygula needs account", () => {
  assert.equal(
    shouldDefaultCariAutoLearn({ accountCode: "120.01.001" }),
    true
  );
  assert.equal(shouldDefaultCariAutoLearn({ accountCode: "" }), false);
});

test("UI button label + duplicate card wiring present", () => {
  assert.equal(
    REANALYZE_BUTTON_LABEL,
    "Yeni hesap planıyla yeniden analiz et"
  );
  const oneClick = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
    ),
    "utf8"
  );
  assert.match(oneClick, /Yeni hesap planıyla yeniden analiz et/);
  assert.match(oneClick, /onReanalyzeWithNewPlan/);
  assert.match(oneClick, /revisionCompare/);
  assert.match(oneClick, /Önceki vs yeni analiz/);

  const workbench = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(workbench, /handleReanalyzeWithNewPlan/);
  assert.match(workbench, /fetchFullActiveAccountPlan/);
  assert.match(workbench, /shouldSkipDriveArchiveOnReanalyze/);
  assert.match(workbench, /buildRevisionIdempotencyKey/);
  assert.match(workbench, /ANNVERO_COMPANY_CHANGED_EVENT/);
  assert.match(workbench, /duplicatePriorJobRef/);

  const jobsRoute = fs.readFileSync(
    path.join(root, "app/api/annvero-v1/jobs/route.js"),
    "utf8"
  );
  assert.match(jobsRoute, /CROSS_TENANT_FORBIDDEN/);
  assert.match(jobsRoute, /supersedes_job_id/);
  assert.match(jobsRoute, /incoming\.reanalyze/);
});

test("full plan helper still uses all=1 pagination contract", () => {
  const api = fs.readFileSync(
    path.join(root, "src/utils/accountPlanApi.js"),
    "utf8"
  );
  assert.match(api, /fetchFullActiveAccountPlan/);
  assert.match(api, /all:\s*true/);
  const route = fs.readFileSync(
    path.join(root, "app/api/account-plans/route.js"),
    "utf8"
  );
  assert.match(route, /wantAll/);
  assert.match(route, /all"\) === "1"/);
});

test("extractAnalysisCounters reads snake_case metadata", () => {
  const c = extractAnalysisCounters({
    metadata: {
      auto_matched_count: 7,
      review_count: 9,
      account_plan_count: 4166,
    },
  });
  assert.equal(c.autoMatched, 7);
  assert.equal(c.remainingReview, 9);
  assert.equal(c.accountPlanCount, 4166);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll bank-parser reanalyze tests passed.");
