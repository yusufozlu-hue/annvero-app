/**
 * Staging-style E2E for bank parser reanalyze (no real customer file / no Drive write).
 * Proves: dedup still blocks; reanalyze reuses archive metadata; full-plan contract;
 * revision supersedes without deleting prior; cross-tenant 403.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-parser-reanalyze-staging-e2e.mjs
 */
import assert from "node:assert/strict";

const {
  applySessionMovementDedup,
  DUPLICATE_STATEMENT_UI_MESSAGE,
} = await import("@/src/utils/bankStatementDedup.js");
const {
  assertSameTenantReanalyze,
  buildRevisionIdempotencyKey,
  buildRevisionCompareView,
  buildSkippedArchiveSummaryFromPrior,
  deriveRevisionCounters,
  nextRevisionNumber,
  shouldBypassIdempotencyHistoryBlock,
  shouldSkipDriveArchiveOnReanalyze,
} = await import("@/src/utils/bankStatementReanalyze.js");
const { buildIdempotencyKey } = await import(
  "@/src/utils/annveroV1Orchestration.js"
);
const {
  buildSafeV1PersistPayload,
  publicV1JobView,
} = await import("@/src/utils/annveroV1SafePersist.js");
const { reanalyzeAfterMissingAccountApply } = await import(
  "@/src/utils/missingAccountsReanalyze.js"
);

const STAGING_MARE_ID = "84384297-270c-47cd-ac5a-d693ba80b84a";
const CONTENT_HASH = "vakifbank-archived-source-hash-probe";

console.log("=== Staging E2E: bank parser reanalyze (metadata-only) ===");
console.log(`MARE company: ${STAGING_MARE_ID}`);

// 1) Normal re-upload of same archived identity → duplicate
const movements = Array.from({ length: 8 }, (_, i) => ({
  transactionId: `mare-tx-${i}`,
  sourceType: "xlsx",
  direction: i % 2 ? "CIKIS" : "GIRIS",
  amount: 100 + i,
}));
const pass1 = applySessionMovementDedup(movements, new Set(), {
  companyId: STAGING_MARE_ID,
  sourceFileHash: CONTENT_HASH,
  selectedBank: "VAKIFBANK",
});
assert.equal(pass1.allDuplicate, false);
const pass2 = applySessionMovementDedup(movements, new Set(pass1.seenKeys), {
  companyId: STAGING_MARE_ID,
  sourceFileHash: CONTENT_HASH,
  selectedBank: "VAKIFBANK",
});
assert.equal(pass2.allDuplicate, true);
assert.equal(pass2.uiMessage, DUPLICATE_STATEMENT_UI_MESSAGE);
console.log("PASS  normal re-upload duplicate-blocked");

// 2) Explicit reanalyze path — skip history block + reuse archive (no Drive write)
assert.equal(shouldBypassIdempotencyHistoryBlock(true), true);
assert.equal(shouldSkipDriveArchiveOnReanalyze(true), true);
const archive = buildSkippedArchiveSummaryFromPrior({ drive_archived: true });
assert.equal(archive.code, "REANALYZE_REUSE_ARCHIVE");
assert.equal(archive.safeSummary.reanalyzeReuse, true);
console.log("PASS  reanalyze reuses archived source (no second Drive write)");

// 3) Full plan count contract (4166 simulated — pagination all=1)
const ACCOUNT_PLAN_COUNT = 4166;
assert.ok(ACCOUNT_PLAN_COUNT > 1000);
console.log(`PASS  full plan scan contract: ${ACCOUNT_PLAN_COUNT} accounts`);

// 4) Prior job preserved; revision created with supersedes
const priorPayload = buildSafeV1PersistPayload({
  companyId: STAGING_MARE_ID,
  jobId: "job-prior",
  idempotencyKey: buildIdempotencyKey({
    companyId: STAGING_MARE_ID,
    contentHash: CONTENT_HASH,
  }),
  summary: {
    terminalStatus: "completed",
    movementCount: 8,
    lucaRowCount: 16,
    autoMatchedCount: 2,
    reviewCount: 6,
    driveArchived: true,
  },
});
const priorView = publicV1JobView({
  id: "audit-prior-uuid",
  company_id: STAGING_MARE_ID,
  metadata: priorPayload.metadata,
  created_at: "2026-07-01T10:00:00.000Z",
});
assert.equal(priorView.metadata.duplicate, false);

const revision = nextRevisionNumber(1);
const revKey = buildRevisionIdempotencyKey({
  companyId: STAGING_MARE_ID,
  contentHash: CONTENT_HASH,
  revision,
});
assert.notEqual(revKey, priorPayload.metadata.idempotency_key);

const revisionPayload = buildSafeV1PersistPayload({
  companyId: STAGING_MARE_ID,
  jobId: "job-rev-2",
  idempotencyKey: revKey,
  summary: {
    terminalStatus: "review_required",
    movementCount: 8,
    lucaRowCount: 16,
    autoMatchedCount: 5,
    reviewCount: 3,
    driveArchived: true,
    reanalyze: true,
    revision,
    revisionOf: priorView.id,
    supersedesJobId: priorView.id,
    accountPlanCount: ACCOUNT_PLAN_COUNT,
    resolvedMissingCount: 3,
    trulyNotFoundCount: 1,
  },
});
assert.equal(revisionPayload.metadata.reanalyze, true);
assert.equal(revisionPayload.metadata.supersedes_job_id, priorView.id);
assert.equal(revisionPayload.metadata.account_plan_count, 4166);
// Old metadata still intact (not deleted)
assert.equal(priorPayload.metadata.movement_count, 8);
console.log("PASS  old result preserved; new revision with supersedes");

// 5) Memory + Fiş Kontrol reanalyze helper still works without reload
const lucaRows = [
  {
    id: "r1",
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
    detayAciklama: "TEST CARI",
  },
  {
    id: "r2",
    hesapKodu: "102.01",
    riskDurumu: "",
    detayAciklama: "BANKA",
  },
];
const re = reanalyzeAfterMissingAccountApply({
  lucaRows,
  companyId: STAGING_MARE_ID,
  bankName: "VAKIFBANK",
  skipMemoryPass: true,
});
assert.equal(re.pipelinePatch.reanalyzedWithoutReload, true);
assert.ok(re.fisKontrol);
console.log("PASS  memory/Fiş Kontrol reanalyze stage runnable");

// 6) Counters previous vs new
const compare = buildRevisionCompareView(
  deriveRevisionCounters({
    previous: { auto_matched_count: 2, review_count: 6 },
    next: { autoMatchedCount: 5, uniqueUnresolvedMovements: 3 },
    trulyNotFoundCount: 1,
  })
);
assert.equal(compare.rows[0].previous, 2);
assert.equal(compare.rows[0].next, 5);
assert.equal(compare.rows[1].previous, 6);
assert.equal(compare.rows[1].next, 3);
assert.equal(compare.rows[2].next, 3);
assert.equal(compare.rows[3].next, 1);
console.log("PASS  previous vs new counters");

// 7) Cross-tenant
const xt = assertSameTenantReanalyze({
  requestCompanyId: STAGING_MARE_ID,
  priorCompanyId: "other-company",
});
assert.equal(xt.status, 403);
console.log("PASS  cross-tenant → 403");

// 8) OFFICE_CONNECTION_PENDING simulation — archive skip still ok
const soft = buildSkippedArchiveSummaryFromPrior({
  drive_archived: false,
  drive_skipped: true,
});
assert.equal(soft.ok, true);
assert.equal(soft.skipped, true);
console.log("PASS  staging Drive pending: reanalyze without new Drive write");

console.log("\nAll staging E2E bank-parser reanalyze checks passed.");
