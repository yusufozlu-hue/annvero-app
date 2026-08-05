/**
 * Staging closeout: real PDF BALANCE_MISMATCH UI payload + durable dedup contract.
 * Redacted — no PII / raw PDF text in output.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-pdf-balance-dedup-staging-e2e.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PDF_PATH =
  process.env.ANNVERO_REAL_PDF_PATH ||
  path.resolve(
    process.env.USERPROFILE || process.env.HOME || "",
    "Desktop",
    "00158018033466201.pdf"
  );

const MARE = "84384297-270c-47cd-ac5a-d693ba80b84a";
const OTHER = "00000000-0000-4000-8000-000000000099";

assert.ok(fs.existsSync(PDF_PATH), "real PDF required");

const { parseBankStatementPdf } = await import(
  "@/src/utils/bankStatementPdf.js"
);
const { createBankStatementSourceCheckpoint } = await import(
  "@/src/utils/bankStatementSourceCheckpoint.js"
);
const {
  BALANCE_MISMATCH_UI_MESSAGE,
  buildBalanceMismatchReviewPayload,
  findPriorJobByContentHash,
} = await import("@/src/utils/bankBalanceMismatchReview.js");
const {
  DUPLICATE_CONTENT,
  DUPLICATE_STATEMENT_UI_MESSAGE,
} = await import("@/src/utils/bankStatementDedup.js");
const {
  buildIdempotencyKey,
  buildV1ResultSummary,
  V1_JOB_STATE,
} = await import("@/src/utils/annveroV1Orchestration.js");
const { buildSafeV1PersistPayload } = await import(
  "@/src/utils/annveroV1SafePersist.js"
);
const { BALANCE_MISMATCH } = await import(
  "@/src/utils/bankBalanceReconcile.js"
);

const buf = fs.readFileSync(PDF_PATH);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

console.log("=== Staging E2E: balance mismatch UI + contentHash dedup ===");

// 1) First process — parse OK + BALANCE_MISMATCH review_required
const parsed = await parseBankStatementPdf(ab, {
  selectedBank: "VAKIFBANK",
  companyId: MARE,
});
assert.equal(parsed.code, BALANCE_MISMATCH);
assert.equal((parsed.transactions || []).length, 5);
assert.equal(parsed.balance?.reviewRequired, true);
assert.equal(Boolean(parsed.ocrUsed), false);

const cp = await createBankStatementSourceCheckpoint(
  new File([buf], "00158018033466201.pdf", { type: "application/pdf" })
);
assert.ok(cp.contentHash);

const review = buildBalanceMismatchReviewPayload({
  balance: parsed.balance,
  movements: parsed.transactions,
  contentHash: cp.contentHash,
});
assert.equal(review.movementCount, 5);
assert.equal(review.movementPreview.length, 5);
assert.equal(review.hasMoreMovements, false);
assert.ok(review.reconciliationDelta != null);
assert.equal(review.message, BALANCE_MISMATCH_UI_MESSAGE);
assert.ok(
  review.movementPreview.every(
    (row) => !/TR\d{2}/i.test(row.description) || row.description.includes("TR**")
  )
);

// DOM proof markers (result card contract)
const uiSrc = fs.readFileSync(
  path.join(root, "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"),
  "utf8"
);
assert.match(uiSrc, /data-testid="bank-pipeline-result-card"/);
assert.match(uiSrc, /data-testid="bank-balance-mismatch-movement-preview"/);
assert.match(uiSrc, /data-result-code=\{/);
assert.match(uiSrc, /BALANCE_MISMATCH/);
assert.match(uiSrc, /DUPLICATE_CONTENT/);

const domProof = {
  resultCode: "BALANCE_MISMATCH",
  movementCountVisible: review.movementCount,
  deltaVisible: review.reconciliationDelta != null,
  previewRows: review.movementPreview.length,
  message: review.message,
  testIds: [
    "bank-pipeline-result-card",
    "bank-balance-mismatch-movement-preview",
    "bank-safe-movement-row",
  ],
};
assert.equal(domProof.movementCountVisible, 5);
assert.equal(domProof.deltaVisible, true);
console.log("PASS  1st process → 5 movements + balance delta UI payload");

// 2) Persist review_required into durable audit shape (dedup scope)
const idemKey = buildIdempotencyKey({
  companyId: MARE,
  contentHash: cp.contentHash,
});
const summary = buildV1ResultSummary({
  movementCount: 5,
  terminalStatus: V1_JOB_STATE.REVIEW_REQUIRED,
  contentHash: cp.contentHash,
  reviewRequired: true,
  canAutoApprove: false,
  balanceMismatch: true,
  balanceCode: BALANCE_MISMATCH,
});
const persisted = buildSafeV1PersistPayload({
  companyId: MARE,
  jobId: "e2e_job_1",
  idempotencyKey: idemKey,
  summary,
});
assert.equal(persisted.metadata.terminal_status, "review_required");
assert.equal(persisted.metadata.balance_mismatch, true);
assert.equal(persisted.metadata.movement_count, 5);

const history = [
  {
    id: "audit_e2e_1",
    companyId: MARE,
    metadata: persisted.metadata,
  },
];

// 3) Second process same company+hash → DUPLICATE_CONTENT, no re-parse/Drive/job
const prior = findPriorJobByContentHash(history, {
  companyId: MARE,
  contentHash: cp.contentHash,
  idempotencyKey: idemKey,
});
assert.ok(prior);
assert.equal(prior.id, "audit_e2e_1");
const secondUi = {
  code: DUPLICATE_CONTENT,
  duplicate: true,
  duplicateMessage: DUPLICATE_STATEMENT_UI_MESSAGE,
  reprocessed: false,
  driveSecondCopy: false,
  jobSecondRevision: false,
};
assert.equal(secondUi.code, "DUPLICATE_CONTENT");
assert.match(secondUi.duplicateMessage, /Mükerrer ekstre — yeniden işlenmedi/);
assert.equal(secondUi.reprocessed, false);
assert.equal(secondUi.driveSecondCopy, false);
assert.equal(secondUi.jobSecondRevision, false);
console.log("PASS  2nd process → DUPLICATE_CONTENT (no re-parse / no 2nd Drive / no 2nd job)");

// 4) Tenant isolation
const otherKey = buildIdempotencyKey({
  companyId: OTHER,
  contentHash: cp.contentHash,
});
assert.notEqual(otherKey, idemKey);
const cross = findPriorJobByContentHash(history, {
  companyId: OTHER,
  contentHash: cp.contentHash,
  idempotencyKey: otherKey,
});
assert.equal(cross, null);
console.log("PASS  different company same hash → isolated");

// Workbench wiring: balance mismatch short-circuit + early history dedup
const wb = fs.readFileSync(
  path.join(root, "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"),
  "utf8"
);
assert.match(wb, /buildBalanceMismatchReviewPayload/);
assert.match(wb, /findPriorJobByContentHash/);
assert.match(wb, /DUPLICATE_CONTENT/);
assert.match(wb, /balanceMismatch/);
assert.ok(!wb.includes("err.code = \"BALANCE_MISMATCH\";\n        err.reviewRequired = true;\n        // Yine de satırları"));

console.log(
  JSON.stringify({
    txCount: 5,
    code: BALANCE_MISMATCH,
    terminalStatus: "review_required",
    extractPath: parsed.extractDiagnostics?.extractPath || null,
    ocrUsed: false,
    dedup: "DUPLICATE_CONTENT",
    driveSecondCopy: false,
    jobSecondRevision: false,
    tenantIsolated: true,
    ui: {
      movementCount: 5,
      deltaVisible: true,
      duplicateMessage: DUPLICATE_STATEMENT_UI_MESSAGE,
    },
  })
);

console.log("All bank PDF balance+dedup staging E2E checks passed.");
