/**
 * BALANCE_MISMATCH review UI + companyId+contentHash dedup sözleşmesi.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-balance-mismatch-review.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  BALANCE_MISMATCH,
  reconcileStatementBalances,
} = await import("@/src/utils/bankBalanceReconcile.js");
const {
  BALANCE_MISMATCH_UI_MESSAGE,
  DUPLICATE_CONTENT,
  buildBalanceMismatchReviewPayload,
  buildSafeMovementPreviewRows,
  findPriorJobByContentHash,
  maskBankMovementDescription,
} = await import("@/src/utils/bankBalanceMismatchReview.js");
const {
  DUPLICATE_STATEMENT_UI_MESSAGE,
  DUPLICATE_CONTENT: DEDUP_CODE,
} = await import("@/src/utils/bankStatementDedup.js");
const {
  buildIdempotencyKey,
  buildV1ResultSummary,
  decideTerminalStatus,
  V1_JOB_STATE,
} = await import("@/src/utils/annveroV1Orchestration.js");
const { buildSafeV1PersistPayload } = await import(
  "@/src/utils/annveroV1SafePersist.js"
);
const { createBankStatementSourceCheckpoint } = await import(
  "@/src/utils/bankStatementSourceCheckpoint.js"
);
const { parseBankStatementPdf } = await import(
  "@/src/utils/bankStatementPdf.js"
);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

test("mask hides IBAN and long digits", () => {
  const masked = maskBankMovementDescription(
    "EFT TR33 0006 1005 1978 6457 8413 26 ODEME 12345678901"
  );
  assert.ok(!/TR33/i.test(masked));
  assert.ok(!/12345678901/.test(masked));
  assert.match(masked, /TR\*\*/);
});

test("safe movement preview caps at 5 and masks description", () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    date: `0${i + 1}.01.2026`,
    description: `Havale TR00 1111 2222 3333 4444 5555 66 ${i}`,
    debit_amount: i % 2 === 0 ? 100 + i : 0,
    credit_amount: i % 2 === 1 ? 50 + i : 0,
    balance: 1000 + i,
    page: 1,
    line: i + 1,
  }));
  const preview = buildSafeMovementPreviewRows(rows, 5);
  assert.equal(preview.length, 5);
  assert.ok(preview.every((r) => !/TR00/i.test(r.description)));
  const payload = buildBalanceMismatchReviewPayload({
    balance: {
      openingBalance: 1000,
      closingBalance: 900,
      credits: 50,
      debits: 200,
      expectedClosing: 850,
      delta: -50,
      code: BALANCE_MISMATCH,
    },
    movements: rows,
    contentHash: "abc",
  });
  assert.equal(payload.movementCount, 7);
  assert.equal(payload.hasMoreMovements, true);
  assert.equal(payload.code, BALANCE_MISMATCH);
  assert.equal(payload.reviewRequired, true);
  assert.equal(payload.message, BALANCE_MISMATCH_UI_MESSAGE);
  assert.equal(payload.reconciliationDelta, -50);
  assert.equal(payload.terminalStatus, V1_JOB_STATE.REVIEW_REQUIRED);
});

test("BALANCE_MISMATCH persist enters dedup scope via idempotency key", () => {
  const companyId = "84384297-270c-47cd-ac5a-d693ba80b84a";
  const contentHash = "deadbeefcafebabe";
  const key = buildIdempotencyKey({ companyId, contentHash });
  const summary = buildV1ResultSummary({
    movementCount: 5,
    lucaRowCount: 0,
    terminalStatus: V1_JOB_STATE.REVIEW_REQUIRED,
    contentHash,
    reviewRequired: true,
    canAutoApprove: false,
    balanceMismatch: true,
    balanceCode: BALANCE_MISMATCH,
  });
  assert.equal(summary.reviewRequired, true);
  assert.equal(summary.balanceMismatch, true);
  assert.equal(
    decideTerminalStatus({ reviewRequired: true }),
    V1_JOB_STATE.REVIEW_REQUIRED
  );
  const payload = buildSafeV1PersistPayload({
    companyId,
    jobId: "job_review_1",
    idempotencyKey: key,
    summary,
  });
  assert.equal(payload.metadata.terminal_status, V1_JOB_STATE.REVIEW_REQUIRED);
  assert.equal(payload.metadata.review_required, true);
  assert.equal(payload.metadata.balance_mismatch, true);
  assert.equal(payload.metadata.movement_count, 5);
  assert.equal(payload.metadata.content_hash_present, true);
  assert.equal(payload.metadata.idempotency_key, key);

  const prior = findPriorJobByContentHash(
    [
      {
        id: "audit-1",
        companyId,
        metadata: {
          idempotency_key: key,
          terminal_status: V1_JOB_STATE.REVIEW_REQUIRED,
          balance_mismatch: true,
          movement_count: 5,
        },
      },
    ],
    { companyId, contentHash, idempotencyKey: key }
  );
  assert.ok(prior);
  assert.equal(prior.id, "audit-1");
});

test("tenant isolation: same hash different company is not duplicate", () => {
  const hash = "samehash123";
  const keyA = buildIdempotencyKey({ companyId: "company-a", contentHash: hash });
  const keyB = buildIdempotencyKey({ companyId: "company-b", contentHash: hash });
  assert.notEqual(keyA, keyB);
  const prior = findPriorJobByContentHash(
    [
      {
        id: "a1",
        companyId: "company-a",
        metadata: { idempotency_key: keyA },
      },
    ],
    { companyId: "company-b", contentHash: hash, idempotencyKey: keyB }
  );
  assert.equal(prior, null);
});

test("duplicate UI message + code", () => {
  assert.equal(DUPLICATE_STATEMENT_UI_MESSAGE, "Mükerrer ekstre — yeniden işlenmedi");
  assert.equal(DUPLICATE_CONTENT, "DUPLICATE_CONTENT");
  assert.equal(DEDUP_CODE, "DUPLICATE_CONTENT");
});

test("result card source mentions balance mismatch fields", () => {
  const ui = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
    ),
    "utf8"
  );
  assert.match(ui, /Bakiye uyuşmazlığı — otomatik fiş üretilmedi, inceleme gerekli/);
  assert.match(ui, /bank-balance-mismatch-movement-preview/);
  assert.match(ui, /Tüm hareketleri incele/);
  assert.match(ui, /Mutabakat farkı/);
  assert.ok(!ui.includes("Güvenli Yeniden Dene") || ui.includes("!isBalanceMismatch"));
});

const PDF_PATH =
  process.env.ANNVERO_REAL_PDF_PATH ||
  path.resolve(
    process.env.USERPROFILE || process.env.HOME || "",
    "Desktop",
    "00158018033466201.pdf"
  );

if (fs.existsSync(PDF_PATH)) {
  const buf = fs.readFileSync(PDF_PATH);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = await parseBankStatementPdf(ab, {
    selectedBank: "VAKIFBANK",
    companyId: "84384297-270c-47cd-ac5a-d693ba80b84a",
  });
  assert.ok((parsed.transactions || []).length >= 5, "txCount>=5");
  assert.equal(parsed.code, BALANCE_MISMATCH);
  assert.equal(parsed.balance?.reviewRequired, true);
  const payload = buildBalanceMismatchReviewPayload({
    balance: parsed.balance,
    movements: parsed.transactions,
    contentHash: "redacted",
  });
  assert.equal(payload.movementCount, (parsed.transactions || []).length);
  assert.ok(payload.movementPreview.length <= 5);
  assert.ok(payload.reconciliationDelta != null);
  const cp = await createBankStatementSourceCheckpoint(
    new File([buf], "00158018033466201.pdf", { type: "application/pdf" })
  );
  assert.ok(cp.contentHash);
  const key1 = buildIdempotencyKey({
    companyId: "c1",
    contentHash: cp.contentHash,
  });
  const key2 = buildIdempotencyKey({
    companyId: "c1",
    contentHash: cp.contentHash,
  });
  assert.equal(key1, key2);
  console.log(
    JSON.stringify({
      path: "real-pdf",
      txCount: payload.movementCount,
      code: parsed.code,
      reviewRequired: true,
      extractPath: parsed.extractDiagnostics?.extractPath || null,
      ocrUsed: Boolean(parsed.ocrUsed),
      contentHashPresent: true,
      deltaPresent: payload.reconciliationDelta != null,
    })
  );
  console.log("PASS  real PDF → txCount + BALANCE_MISMATCH review payload");
} else {
  console.log("SKIP  real PDF (missing on disk)");
}

console.log("All balance-mismatch review checks passed.");
