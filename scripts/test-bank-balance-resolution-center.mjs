import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  BALANCE_MATCHED,
  BALANCE_MISMATCH,
  MISSING_CLOSING_BALANCE,
  MISSING_OPENING_BALANCE,
  reconcileStatementBalances,
} = await import("@/src/utils/bankBalanceReconcile.js");
const {
  applyBalanceResolution,
  buildBalanceResolutionRows,
  buildInitialBalanceResolutionDraft,
  canApplyBalanceResolution,
} = await import("@/src/utils/bankBalanceResolution.js");
const {
  extractBalanceHintsFromText,
  parseBankStatementPdf,
  parsePdfMovementLines,
} = await import("@/src/utils/bankStatementPdf.js");
const { buildSafeV1PersistPayload } = await import(
  "@/src/utils/annveroV1SafePersist.js"
);
const {
  buildRevisionIdempotencyKey,
  assertSameTenantReanalyze,
} = await import("@/src/utils/bankStatementReanalyze.js");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

const movements = [
  {
    transactionDate: "01.01.2026",
    description: "Güvenli test girişi",
    amount: 100,
    direction: "GIRIS",
    balance: 100,
    sourcePage: 1,
    sourceRow: 10,
  },
  {
    transactionDate: "02.01.2026",
    description: "Güvenli test çıkışı",
    amount: -25,
    direction: "CIKIS",
    balance: 75,
    sourcePage: 1,
    sourceRow: 11,
  },
];

test("null/empty balance never coerces to zero", () => {
  const missingClosing = reconcileStatementBalances(
    [{ amount: 100, balance: null }],
    { openingBalance: 0, closingBalance: null }
  );
  assert.equal(missingClosing.code, MISSING_CLOSING_BALANCE);
  assert.equal(missingClosing.closingBalance, null);
  assert.equal(missingClosing.reviewRequired, true);
  assert.equal(missingClosing.matched, false);

  const missingOpening = reconcileStatementBalances(
    [{ amount: 100, balance: null }],
    { openingBalance: "", closingBalance: 100 }
  );
  assert.equal(missingOpening.code, MISSING_OPENING_BALANCE);
  assert.equal(missingOpening.openingBalance, null);
});

test("generic Bakiye header cannot invent closing balance", () => {
  const hints = extractBalanceHintsFromText(
    "Bakiye 0,00\n01.01.2026 Test 100,00"
  );
  assert.equal(hints.openingBalance, null);
  assert.equal(hints.closingBalance, null);
});

test("explicit balance labels preserve safe page/line evidence", () => {
  const hints = extractBalanceHintsFromText(
    "--- page 2 ---\nAçılış Bakiyesi: 10,00\nKapanış Bakiyesi: 25,00"
  );
  assert.equal(hints.openingBalance, 10);
  assert.equal(hints.closingBalance, 25);
  assert.deepEqual(hints.openingEvidence, {
    source: "explicit_label",
    sourcePage: 2,
    sourceLine: 1,
    confidence: 0.98,
  });
  assert.equal(hints.closingEvidence.sourceLine, 2);
});

test("running balance uses first and last valid movement evidence", () => {
  const result = reconcileStatementBalances(movements, {});
  assert.equal(result.code, BALANCE_MATCHED);
  assert.equal(result.openingEvidence.sourceLine, 10);
  assert.equal(result.closingEvidence.sourceLine, 11);
  assert.equal(result.closingBalance, 75);
});

test("apply stays disabled without a real change and explicit approval", () => {
  const originalRows = buildBalanceResolutionRows(movements);
  const draft = buildInitialBalanceResolutionDraft({
    balance: { openingBalance: 0, closingBalance: 75 },
    movements,
  });
  assert.equal(
    canApplyBalanceResolution({
      draft,
      originalBalance: { openingBalance: 0, closingBalance: 75 },
      originalRows,
    }).allowed,
    false
  );
  draft.rows[1].included = false;
  assert.equal(
    canApplyBalanceResolution({
      draft,
      originalBalance: { openingBalance: 0, closingBalance: 75 },
      originalRows,
    }).allowed,
    false
  );
  draft.userConfirmed = true;
  assert.equal(
    canApplyBalanceResolution({
      draft,
      originalBalance: { openingBalance: 0, closingBalance: 75 },
      originalRows,
    }).allowed,
    true
  );
});

test("movement include/exclude recalculates without fake movement", () => {
  const draft = buildInitialBalanceResolutionDraft({
    balance: { openingBalance: 0, closingBalance: 100 },
    movements,
  });
  draft.rows[1].included = false;
  draft.userConfirmed = true;
  const result = applyBalanceResolution({
    movements,
    draft,
    originalBalance: { openingBalance: 0, closingBalance: 75 },
  });
  assert.equal(result.correctedMovements.length, 1);
  assert.equal(result.balance.code, BALANCE_MATCHED);
  assert.equal(result.changeCount, 2); // kapanış + hariç bırakma
});

test("direction correction recalculates debit/credit", () => {
  const draft = buildInitialBalanceResolutionDraft({
    balance: { openingBalance: 0, closingBalance: 125 },
    movements,
  });
  draft.rows[1].direction = "credit";
  draft.userConfirmed = true;
  const result = applyBalanceResolution({
    movements,
    draft,
    originalBalance: { openingBalance: 0, closingBalance: 75 },
  });
  assert.equal(result.balance.code, BALANCE_MATCHED);
  assert.equal(result.balance.credits, 125);
  assert.equal(result.balance.debits, 0);
});

test("unmatched approved correction remains review-only", () => {
  const draft = buildInitialBalanceResolutionDraft({
    balance: { openingBalance: 0, closingBalance: 80 },
    movements,
  });
  draft.userConfirmed = true;
  const result = applyBalanceResolution({
    movements,
    draft,
    originalBalance: { openingBalance: 0, closingBalance: 75 },
  });
  assert.equal(result.balance.code, BALANCE_MISMATCH);
  assert.equal(result.matched, false);
});

test("resolution revision persists safe audit fields and supersedes", () => {
  const key = buildRevisionIdempotencyKey({
    companyId: "company-a",
    contentHash: "safe-hash",
    revision: 2,
  });
  const payload = buildSafeV1PersistPayload({
    companyId: "company-a",
    jobId: "revision-2",
    idempotencyKey: key,
    summary: {
      terminalStatus: "review_required",
      reanalyze: true,
      revision: 2,
      revisionOf: "prior-job",
      supersedesJobId: "prior-job",
      balanceResolutionApplied: true,
      balanceResolutionChangeCount: 2,
      balanceResolutionLearned: false,
    },
  });
  assert.match(payload.metadata.idempotency_key, /:rev:2$/);
  assert.equal(payload.metadata.revision_of, "prior-job");
  assert.equal(payload.metadata.supersedes_job_id, "prior-job");
  assert.equal(payload.metadata.balance_resolution_applied, true);
  assert.equal(payload.metadata.balance_resolution_change_count, 2);
  assert.equal(payload.metadata.balance_resolution_learned, false);
  assert.doesNotMatch(JSON.stringify(payload), /iban|drive.?id|raw|token/i);
});

test("cross-tenant resolution revision is forbidden", () => {
  const denied = assertSameTenantReanalyze({
    requestCompanyId: "company-a",
    priorCompanyId: "company-b",
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.equal(denied.code, "CROSS_TENANT_FORBIDDEN");
});

test("VakıfBank flexible columns parse real running balance rows", () => {
  const parsed = parsePdfMovementLines(
    [
      "01.01.2026 Güvenli işlem 100,00 100,00 açıklama devamı",
      "02.01.2026 Güvenli işlem -25,00 75,00 açıklama devamı",
      "Ara toplam 75,00",
      "Devreden bakiye 75,00",
    ].join("\n"),
    { selectedBank: "VAKIFBANK", companyId: "test-company" }
  );
  assert.equal(parsed.transactions.length, 2);
  assert.equal(parsed.transactions[1].balance, 75);
  assert.equal(parsed.transactions[1].amount, -25);
});

test("resolution center UI exposes review/apply/undo and gated Fiş Kontrol", () => {
  const center = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BalanceMismatchResolutionCenter.jsx"
    ),
    "utf8"
  );
  const resultCard = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
    ),
    "utf8"
  );
  assert.match(center, /Bakiye Uyuşmazlığı Çözüm Merkezi/);
  assert.match(center, /bank-balance-resolution-undo/);
  assert.match(center, /bank-balance-resolution-apply/);
  assert.match(center, /userConfirmed/);
  assert.match(resultCard, /bank-open-balance-resolution-center/);
  assert.match(
    resultCard,
    /onGoToFisKontrol[\s\S]{0,180}disabled=\{!outputGate\.allowed\}/
  );
  const workbench = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(workbench, /balanceResolutionRef\.current = null/);
  assert.match(workbench, /setIsBalanceResolving\(false\)/);
  assert.match(workbench, /resumeFrom:\s*V1_JOB_STATE\.APPLYING_CORE/);
});

const realPdf = path.resolve(
  process.env.USERPROFILE || process.env.HOME || "",
  "Desktop",
  "00158018033466201.pdf"
);
if (fs.existsSync(realPdf)) {
  const buffer = fs.readFileSync(realPdf);
  const parsed = await parseBankStatementPdf(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    { selectedBank: "VAKIFBANK", companyId: "safe-local-test" }
  );
  assert.equal(parsed.transactions.length, 4);
  assert.equal(parsed.balance.code, BALANCE_MATCHED);
  assert.equal(parsed.balance.openingBalance, 0);
  assert.equal(parsed.balance.closingBalance, 0);
  assert.equal(parsed.balance.openingEvidence.sourceLine, 10);
  assert.equal(parsed.balance.closingEvidence.sourceLine, 17);
  console.log(
    JSON.stringify({
      path: "real-pdf-safe",
      movementCount: parsed.transactions.length,
      balanceCode: parsed.balance.code,
      opening: parsed.balance.openingBalance,
      closing: parsed.balance.closingBalance,
      openingSource: {
        page: parsed.balance.openingEvidence.sourcePage,
        line: parsed.balance.openingEvidence.sourceLine,
      },
      closingSource: {
        page: parsed.balance.closingEvidence.sourcePage,
        line: parsed.balance.closingEvidence.sourceLine,
      },
    })
  );
  console.log("PASS  real VakıfBank PDF → true movements + source evidence");
}

console.log("All balance resolution center checks passed.");
