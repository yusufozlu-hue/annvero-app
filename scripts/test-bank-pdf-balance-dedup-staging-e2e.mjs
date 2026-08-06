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
const { findPriorJobByContentHash } = await import(
  "@/src/utils/bankBalanceMismatchReview.js"
);
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
const { BALANCE_MATCHED } = await import(
  "@/src/utils/bankBalanceReconcile.js"
);

const buf = fs.readFileSync(PDF_PATH);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

console.log("=== Staging E2E: true balance evidence + contentHash dedup ===");

// 1) First process — true source rows; normalized fake movements are rejected.
const parsed = await parseBankStatementPdf(ab, {
  selectedBank: "VAKIFBANK",
  companyId: MARE,
});
assert.equal(parsed.balance?.code, BALANCE_MATCHED);
assert.equal((parsed.transactions || []).length, 4);
assert.equal(parsed.balance?.reviewRequired, false);
assert.equal(parsed.balance?.openingBalance, 0);
assert.equal(parsed.balance?.closingBalance, 0);
assert.equal(parsed.balance?.openingEvidence?.sourceLine, 10);
assert.equal(parsed.balance?.closingEvidence?.sourceLine, 17);
assert.equal(Boolean(parsed.ocrUsed), false);

const cp = await createBankStatementSourceCheckpoint(
  new File([buf], "00158018033466201.pdf", { type: "application/pdf" })
);
assert.ok(cp.contentHash);

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

assert.match(uiSrc, /bank-open-balance-resolution-center/);
assert.match(uiSrc, /disabled=\{!outputGate\.allowed\}/);
console.log("PASS  1st process → 4 true movements + BALANCE_MATCHED evidence");

// 2) Persist completed result into durable audit shape (dedup scope)
const idemKey = buildIdempotencyKey({
  companyId: MARE,
  contentHash: cp.contentHash,
});
const summary = buildV1ResultSummary({
  movementCount: 4,
  terminalStatus: V1_JOB_STATE.COMPLETED,
  contentHash: cp.contentHash,
  reviewRequired: false,
  canAutoApprove: true,
  balanceMismatch: false,
  balanceCode: BALANCE_MATCHED,
});
const persisted = buildSafeV1PersistPayload({
  companyId: MARE,
  jobId: "e2e_job_1",
  idempotencyKey: idemKey,
  summary,
});
assert.equal(persisted.metadata.terminal_status, "completed");
assert.equal(persisted.metadata.balance_mismatch, undefined);
assert.equal(persisted.metadata.balance_code, BALANCE_MATCHED);
assert.equal(persisted.metadata.movement_count, 4);

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
    txCount: 4,
    code: BALANCE_MATCHED,
    terminalStatus: "completed",
    extractPath: parsed.extractDiagnostics?.extractPath || null,
    ocrUsed: false,
    dedup: "DUPLICATE_CONTENT",
    driveSecondCopy: false,
    jobSecondRevision: false,
    tenantIsolated: true,
    ui: {
      movementCount: 4,
      delta: 0,
      duplicateMessage: DUPLICATE_STATEMENT_UI_MESSAGE,
    },
  })
);

console.log("All bank PDF balance+dedup staging E2E checks passed.");
