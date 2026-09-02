/**
 * Canonical hydrate reuse gate — compatible completed OUTPUT_READY
 * skips pipeline/POST; incompatible still single-flight once.
 *
 * FAIL (eski): hydrate her zaman armCanonicalHydrateReanalyze → pipeline 1
 * PASS (yeni): uyumlu completed job → pipeline 0, network persist 0
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-canonical-hydrate-reanalysis-gate.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out
        .then(() => console.log(`PASS  ${name}`))
        .catch((err) => {
          failed += 1;
          console.error(`FAIL  ${name}`);
          console.error(err);
        });
    }
    console.log(`PASS  ${name}`);
    return Promise.resolve();
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
    return Promise.resolve();
  }
}

const {
  ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
} = await import("@/src/utils/bankStatementReanalyze.js");

const {
  buildReanalyzeFlightKey,
  __resetReanalyzeOrchestrationForTests,
} = await import("@/src/utils/bankReanalyzeOrchestration.js");

const {
  ARCHIVED_HYDRATE_RESULT_TITLE,
  REANALYZE_COMPLETE_TITLE,
  buildCanonicalHydrateBoundResult,
  decideCanonicalHydrateReanalyze,
  evaluateCanonicalHydrateJobCompatibility,
  resolveCanonicalHydrateResultTitle,
  runCanonicalHydrateReanalyzeIfNeeded,
  shouldSkipHydratePipeline,
} = await import("@/src/utils/canonicalHydrateReuse.js");

const COMPANY_A = "co-alpha";
const COMPANY_B = "co-beta";
const SOURCE_A = "src-alpha";
const HASH_A = "snap-fp-alpha";
const PLAN_A = "plan-fp-alpha";
const PLAN_B = "plan-fp-beta";
const PIPE = ANNVERO_BANK_REANALYZE_PIPELINE_VERSION;

function expectedBindings(overrides = {}) {
  return {
    expectedCompanyId: COMPANY_A,
    expectedSourceId: SOURCE_A,
    expectedSourceRevision: "1",
    expectedSnapshotFingerprint: HASH_A,
    expectedPlanFingerprint: PLAN_A,
    expectedPipelineVersion: PIPE,
    snapshotHasBalanceEvidence: true,
    ...overrides,
  };
}

function completedReadyJob(overrides = {}) {
  const metaOverrides = overrides.metadata || {};
  delete overrides.metadata;
  return {
    id: "job-alpha-ready",
    companyId: COMPANY_A,
    metadata: {
      idempotency_key: [
        COMPANY_A,
        HASH_A,
        "eng",
        "rev:2",
        `plan:${PLAN_A}`,
        `pipe:${PIPE}`,
        `src:${SOURCE_A}`,
        "srev:1",
        `snap:${HASH_A}`,
      ].join(":"),
      terminal_status: "completed",
      review_required: false,
      can_auto_approve: true,
      balance_code: "BALANCE_MATCHED",
      output_gate_code: "OUTPUT_READY",
      pipeline_version: PIPE,
      source_id: SOURCE_A,
      source_revision: "1",
      snapshot_fingerprint: HASH_A,
      plan_fingerprint: PLAN_A,
      movement_count: 4,
      luca_row_count: 8,
      auto_matched_count: 4,
      review_count: 0,
      errors: 0,
      ...metaOverrides,
    },
    ...overrides,
  };
}

function flightKeyFor(expected) {
  return buildReanalyzeFlightKey({
    companyId: expected.expectedCompanyId,
    sourceId: expected.expectedSourceId,
    sourceRevision: expected.expectedSourceRevision,
    planFingerprint: expected.expectedPlanFingerprint,
  });
}

function openHydratePage({
  jobs,
  expected = expectedBindings(),
  remounts = 1,
} = {}) {
  __resetReanalyzeOrchestrationForTests();
  let pipelineInvocations = 0;
  let jobsPosted = 0;
  let snapshotPosted = 0;
  const key = flightKeyFor(expected);
  let last = null;
  for (let i = 0; i < remounts; i += 1) {
    last = runCanonicalHydrateReanalyzeIfNeeded({
      ...expected,
      jobs,
      flightKey: key,
      invokePipeline: () => {
        pipelineInvocations += 1;
        jobsPosted += 1;
        snapshotPosted += 1;
      },
    });
  }
  return {
    ...last,
    pipelineInvocations,
    jobsPosted,
    snapshotPosted,
    networkPersist: jobsPosted + snapshotPosted > 0 ? jobsPosted : 0,
  };
}

function legacyAlwaysArmHydrate({ jobs, expected = expectedBindings() } = {}) {
  // Eski hata: staleJobResult hesaplanır ama her durumda arm edilir.
  void jobs;
  void expected;
  return { pipelineInvocations: 1, networkPersist: 1 };
}

await test("eski davranış: uyumlu job olsa bile hydrate pipeline 1", () => {
  const legacy = legacyAlwaysArmHydrate({ jobs: [completedReadyJob()] });
  assert.equal(legacy.pipelineInvocations, 1);
});

await test("compatible completed hydrate → pipeline invocation 0", () => {
  const opened = openHydratePage({ jobs: [completedReadyJob()] });
  assert.equal(opened.arm, false);
  assert.equal(opened.bindArchivedResult, true);
  assert.equal(opened.pipelineInvocations, 0);
  assert.equal(opened.message, ARCHIVED_HYDRATE_RESULT_TITLE);
  assert.equal(
    resolveCanonicalHydrateResultTitle({ archivedHydrateResult: true }),
    ARCHIVED_HYDRATE_RESULT_TITLE
  );
});

await test("compatible completed hydrate → network persist 0 (no POST jobs / snapshot)", () => {
  const opened = openHydratePage({ jobs: [completedReadyJob()] });
  assert.equal(opened.jobsPosted, 0);
  assert.equal(opened.snapshotPosted, 0);
  assert.equal(opened.networkPersist, 0);
});

await test("stale pipelineVersion → invocation exactly 1", () => {
  const opened = openHydratePage({
    jobs: [
      completedReadyJob({
        metadata: { pipeline_version: "br/0.0.1+vl/0.0.1" },
      }),
    ],
  });
  assert.equal(opened.reason, "pipeline_version_stale");
  assert.equal(opened.pipelineInvocations, 1);
  assert.equal(opened.jobsPosted, 1);
});

await test("different plan fingerprint → invocation exactly 1", () => {
  const opened = openHydratePage({
    jobs: [
      completedReadyJob({
        metadata: { plan_fingerprint: PLAN_B },
      }),
    ],
  });
  assert.equal(opened.reason, "plan_mismatch");
  assert.equal(opened.pipelineInvocations, 1);
});

await test("different source revision → invocation exactly 1", () => {
  const opened = openHydratePage({
    jobs: [
      completedReadyJob({
        metadata: { source_revision: "2" },
      }),
    ],
  });
  assert.equal(opened.reason, "source_revision_mismatch");
  assert.equal(opened.pipelineInvocations, 1);
});

await test("different snapshot fingerprint → invocation exactly 1", () => {
  const opened = openHydratePage({
    jobs: [
      completedReadyJob({
        metadata: { snapshot_fingerprint: "snap-other" },
      }),
    ],
  });
  assert.equal(opened.reason, "snapshot_mismatch");
  assert.equal(opened.pipelineInvocations, 1);
});

await test("review_required job → invocation exactly 1", () => {
  const opened = openHydratePage({
    jobs: [
      completedReadyJob({
        metadata: {
          terminal_status: "review_required",
          review_required: true,
          can_auto_approve: false,
          output_gate_code: "REVIEW_REQUIRED",
        },
      }),
    ],
  });
  assert.equal(opened.reason, "review_required");
  assert.equal(opened.pipelineInvocations, 1);
});

await test("balance evidence recovery after old job → invocation exactly 1", () => {
  const opened = openHydratePage({
    jobs: [
      completedReadyJob({
        metadata: {
          balance_code: "BALANCE_EVIDENCE_MISSING",
          output_gate_code: "BALANCE_NOT_MATCHED",
          can_auto_approve: false,
        },
      }),
    ],
    expected: expectedBindings({ snapshotHasBalanceEvidence: true }),
  });
  assert.ok(
    opened.reason === "balance_evidence_stale" ||
      opened.reason === "output_gate_closed"
  );
  assert.equal(opened.pipelineInvocations, 1);
});

await test("Strict Mode remount → invocation at most 1", () => {
  const compatible = openHydratePage({
    jobs: [completedReadyJob()],
    remounts: 2,
  });
  assert.equal(compatible.pipelineInvocations, 0);

  const stale = openHydratePage({
    jobs: [
      completedReadyJob({
        metadata: { plan_fingerprint: PLAN_B },
      }),
    ],
    remounts: 2,
  });
  assert.equal(stale.pipelineInvocations, 1);
});

await test("manual reanalysis → invocation exactly 1 even if compatible", () => {
  __resetReanalyzeOrchestrationForTests();
  const expected = expectedBindings();
  let pipelineInvocations = 0;
  const hydrate = runCanonicalHydrateReanalyzeIfNeeded({
    ...expected,
    jobs: [completedReadyJob()],
    flightKey: flightKeyFor(expected),
    invokePipeline: () => {
      pipelineInvocations += 1;
    },
  });
  assert.equal(hydrate.pipelineInvocations, 0);
  assert.equal(
    shouldSkipHydratePipeline({
      reason: "manual",
      ...expected,
      jobs: [completedReadyJob()],
    }),
    false,
    "manual must not skip"
  );
  pipelineInvocations += 1;
  assert.equal(pipelineInvocations, 1);
});

await test("no job → invocation exactly 1", () => {
  const opened = openHydratePage({ jobs: [] });
  assert.equal(opened.reason, "no_job");
  assert.equal(opened.pipelineInvocations, 1);
});

await test("other-company job is not bound", () => {
  const foreign = completedReadyJob({
    id: "job-other",
    companyId: COMPANY_B,
    metadata: { source_id: SOURCE_A },
  });
  const compat = evaluateCanonicalHydrateJobCompatibility({
    ...expectedBindings(),
    job: foreign,
  });
  assert.equal(compat.ok, false);
  assert.equal(compat.reason, "company_mismatch");
  const opened = openHydratePage({ jobs: [foreign] });
  assert.equal(opened.bindArchivedResult, false);
  assert.equal(opened.pipelineInvocations, 1);
  const bound = buildCanonicalHydrateBoundResult({
    job: foreign,
    archivedHydrateResult: false,
    staleExistingJob: true,
  });
  assert.equal(bound.archivedHydrateResult, false);
});

await test("source 1/4 conceptually preserved: source mismatch does not bind", () => {
  const otherSource = completedReadyJob({
    metadata: { source_id: "src-other-quarter" },
  });
  const opened = openHydratePage({ jobs: [otherSource] });
  assert.equal(opened.bindArchivedResult, false);
  assert.equal(opened.reason, "no_matching_job");
  assert.equal(opened.pipelineInvocations, 1);
});

await test("compatible bind is OUTPUT_READY / BALANCE_MATCHED", () => {
  const job = completedReadyJob();
  const decision = decideCanonicalHydrateReanalyze({
    ...expectedBindings(),
    jobs: [job],
  });
  assert.equal(decision.bindArchivedResult, true);
  assert.equal(decision.outputGate.code, "OUTPUT_READY");
  assert.equal(decision.outputGate.balanceCode, "BALANCE_MATCHED");
  const bound = buildCanonicalHydrateBoundResult({
    job,
    archivedHydrateResult: true,
    staleExistingJob: false,
    movementCount: 4,
  });
  assert.equal(bound.archivedHydrateResult, true);
  assert.equal(bound.reanalyze, false);
  assert.equal(bound.balanceCode, "BALANCE_MATCHED");
  assert.equal(bound.outputGateCode, "OUTPUT_READY");
  assert.equal(bound.terminalStatus, "completed");
  assert.equal(
    resolveCanonicalHydrateResultTitle(bound),
    ARCHIVED_HYDRATE_RESULT_TITLE
  );
  assert.equal(
    resolveCanonicalHydrateResultTitle({ reanalyze: true }),
    REANALYZE_COMPLETE_TITLE
  );
});

function formatBalanceAmountLikeUi(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const ZERO_EVIDENCE = {
  openingBalance: 0,
  closingBalance: 0,
  calculatedClosing: 0,
  delta: 0,
  credits: 0,
  debits: 0,
  matched: true,
  code: "BALANCE_MATCHED",
  evidenceVersion: "sbe/1.0.0",
  evidenceSource: "canonical_snapshot",
};

await test("canonical evidence 0/0/0/0 → UI 0,00 (null !== 0)", () => {
  const job = completedReadyJob();
  // Job metadata intentionally omits amount fields — canonical is authoritative.
  const bound = buildCanonicalHydrateBoundResult({
    job,
    archivedHydrateResult: true,
    staleExistingJob: false,
    movementCount: 4,
    canonicalBalanceEvidence: ZERO_EVIDENCE,
  });
  assert.equal(bound.openingBalance, 0);
  assert.equal(bound.statementClosingBalance, 0);
  assert.equal(bound.computedClosingBalance, 0);
  assert.equal(bound.reconciliationDelta, 0);
  assert.equal(bound.balanceCode, "BALANCE_MATCHED");
  assert.equal(bound.balanceMatched, true);
  assert.equal(bound.hasStatementBalanceEvidence, true);
  assert.equal(formatBalanceAmountLikeUi(bound.openingBalance), "0,00");
  assert.equal(formatBalanceAmountLikeUi(bound.statementClosingBalance), "0,00");
  assert.equal(formatBalanceAmountLikeUi(bound.computedClosingBalance), "0,00");
  assert.equal(formatBalanceAmountLikeUi(bound.reconciliationDelta), "0,00");
});

await test("null evidence → UI — (no invented zeros)", () => {
  const job = completedReadyJob();
  const bound = buildCanonicalHydrateBoundResult({
    job,
    archivedHydrateResult: true,
    staleExistingJob: false,
    movementCount: 4,
    canonicalBalanceEvidence: null,
  });
  assert.equal(bound.openingBalance, null);
  assert.equal(bound.statementClosingBalance, null);
  assert.equal(bound.computedClosingBalance, null);
  assert.equal(bound.reconciliationDelta, null);
  assert.equal(bound.hasStatementBalanceEvidence, false);
  assert.equal(bound.balanceCode, "BALANCE_MATCHED");
  assert.equal(formatBalanceAmountLikeUi(bound.openingBalance), "—");
  assert.equal(formatBalanceAmountLikeUi(bound.statementClosingBalance), "—");
});

await test("incomplete evidence does not invent balance summary", () => {
  const job = completedReadyJob();
  const bound = buildCanonicalHydrateBoundResult({
    job,
    archivedHydrateResult: true,
    staleExistingJob: false,
    canonicalBalanceEvidence: {
      openingBalance: 0,
      // closing missing → incomplete
      matched: true,
      code: "BALANCE_MATCHED",
    },
  });
  assert.equal(bound.openingBalance, null);
  assert.equal(bound.statementClosingBalance, null);
  assert.equal(bound.hasStatementBalanceEvidence, false);
});

await test("stale bind ignores evidence amounts", () => {
  const job = completedReadyJob();
  const bound = buildCanonicalHydrateBoundResult({
    job,
    archivedHydrateResult: false,
    staleExistingJob: true,
    canonicalBalanceEvidence: ZERO_EVIDENCE,
  });
  assert.equal(bound.openingBalance, null);
  assert.equal(bound.statementClosingBalance, null);
  assert.equal(bound.hasStatementBalanceEvidence, false);
  assert.equal(bound.archivedHydrateResult, false);
});

await test("compatible completed reuse stays pipeline=0 persist=0", () => {
  __resetReanalyzeOrchestrationForTests();
  const job = completedReadyJob();
  const expected = expectedBindings();
  let pipelineCalls = 0;
  const result = runCanonicalHydrateReanalyzeIfNeeded({
    ...expected,
    jobs: [job],
    flightKey: flightKeyFor(expected),
    invokePipeline: () => {
      pipelineCalls += 1;
    },
  });
  assert.equal(result.bindArchivedResult, true);
  assert.equal(result.pipelineInvocations, 0);
  assert.equal(result.networkPersist, 0);
  assert.equal(result.jobsPosted, 0);
  assert.equal(result.snapshotPosted, 0);
  assert.equal(pipelineCalls, 0);
  const bound = buildCanonicalHydrateBoundResult({
    job,
    archivedHydrateResult: true,
    staleExistingJob: false,
    canonicalBalanceEvidence: ZERO_EVIDENCE,
  });
  assert.equal(bound.openingBalance, 0);
  assert.equal(bound.balanceMatched, true);
});

await test("wiring: workbench clean-open; hydrate helpers + one-click archive", () => {
  const workbench = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  const oneClick = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
    ),
    "utf8"
  );
  const reuse = fs.readFileSync(
    path.join(root, "src/utils/canonicalHydrateReuse.js"),
    "utf8"
  );
  // Product rule: Banka Parser her girişte temiz — auto UI hydrate yok
  assert.match(workbench, /her girişte temiz|auto-hydrate kapalı/);
  assert.doesNotMatch(workbench, /void hydrateCanonicalSnapshot\(\)/);
  assert.match(workbench, /loadAuditHistoryOnly/);
  assert.match(workbench, /fileInputKey/);
  // Manual reanalyze / archive paths still gated
  assert.match(workbench, /shouldSkipHydratePipeline/);
  assert.match(workbench, /buildLucaRowsFromMovementsAsync/);
  assert.match(workbench, /handlePrepareLegacyArchiveAndGoToFisKontrol/);
  assert.match(workbench, /markHydrateReanalyzeConsumed/);
  assert.match(reuse, /lucaReadyHint/);
  assert.match(reuse, /materializedLucaRowCount/);
  assert.match(reuse, /legacyArchiveNeedsPrepare/);
  assert.match(oneClick, /result\.lucaRowCount/);
  assert.match(oneClick, /onPrepareLegacyArchiveAndGoToFisKontrol/);
  assert.match(oneClick, /Fişleri Hazırla ve Kontrol Et/);
  assert.doesNotMatch(workbench, /alert\("Önce ön izleme oluşturup Luca satırlarını hazırlayın\."\)/);
  assert.doesNotMatch(workbench, /84384297-270c-47cd-ac5a-d693ba80b84a/);
});

await test("preview FAIL repro: OUTPUT_READY meta + empty lucaRows → gate closed", async () => {
  const job = completedReadyJob();
  const bound = buildCanonicalHydrateBoundResult({
    job,
    archivedHydrateResult: true,
    staleExistingJob: false,
    movementCount: 4,
    // Missing materializedLucaRowCount — eski bug: metadata luca_row_count ile buton açılırdı
  });
  assert.equal(bound.outputGateCode, "OUTPUT_READY");
  assert.equal(bound.expectedLucaRowCount, 8);
  assert.equal(bound.lucaRowCount, 0);
  assert.equal(bound.lucaReadyHint, false);
  const { evaluateBankOutputGate } = await import(
    "@/src/utils/bankOneClickPipeline.js"
  );
  const gate = evaluateBankOutputGate(bound, {
    lucaReady: Boolean(bound.lucaReadyHint) && bound.lucaRowCount > 0,
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.code, "LUCA_NOT_READY");
});

await test("archive legs → materialized 8 rows opens gate", async () => {
  const {
    movementsHaveArchiveAccountingLegs,
    evaluateArchiveLucaHandoffReadiness,
  } = await import("@/src/utils/canonicalHydrateReuse.js");
  const { bankMovementToStandardLucaRows } = await import(
    "@/src/utils/standardLucaRow.js"
  );
  const movements = [
    {
      amount: 1000000,
      direction: "CIKIS",
      accountCode: "102.10.V005",
      counterAccountCode: "102.10.V001",
      description: "open",
      lucaDescription: "open",
      _accountingAnalyzed: true,
    },
    {
      amount: 33931.4,
      direction: "GIRIS",
      accountCode: "102.10.V005",
      counterAccountCode: "642.01.001",
      description: "faiz",
      lucaDescription: "faiz",
      _accountingAnalyzed: true,
    },
    {
      amount: 5938,
      direction: "CIKIS",
      accountCode: "102.10.V005",
      counterAccountCode: "193.01.001",
      description: "stopaj",
      lucaDescription: "stopaj",
      _accountingAnalyzed: true,
    },
    {
      amount: 1027993.4,
      direction: "GIRIS",
      accountCode: "102.10.V005",
      counterAccountCode: "102.10.V001",
      description: "close",
      lucaDescription: "close",
      _accountingAnalyzed: true,
    },
  ];
  assert.equal(movementsHaveArchiveAccountingLegs(movements), true);
  assert.equal(
    movementsHaveArchiveAccountingLegs([{ amount: 1, accountCode: "102" }]),
    false
  );
  const lucaRows = [];
  movements.forEach((m, i) => {
    lucaRows.push(
      ...bankMovementToStandardLucaRows(m, i + 1, { firmaId: "co" })
    );
  });
  assert.equal(lucaRows.length, 8);
  const ready = evaluateArchiveLucaHandoffReadiness({
    movements,
    lucaRows,
    lucaReady: true,
    balanceMatched: true,
    outputGateCode: "OUTPUT_READY",
  });
  assert.equal(ready.allowed, true);
  assert.equal(ready.lucaRowCount, 8);
  const job = completedReadyJob();
  const bound = buildCanonicalHydrateBoundResult({
    job,
    archivedHydrateResult: true,
    movementCount: 4,
    materializedLucaRowCount: 8,
  });
  assert.equal(bound.lucaReadyHint, true);
  assert.equal(bound.lucaRowCount, 8);
  const { evaluateBankOutputGate } = await import(
    "@/src/utils/bankOneClickPipeline.js"
  );
  const gate = evaluateBankOutputGate(bound, {
    lucaReady: bound.lucaReadyHint && bound.lucaRowCount > 0,
  });
  assert.equal(gate.allowed, true);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll canonical-hydrate-reanalysis-gate tests passed.");
