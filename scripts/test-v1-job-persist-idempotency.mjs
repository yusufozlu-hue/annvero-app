/**
 * V1 job persist idempotency — stale existingJob vs version-uyumlu yeni satır.
 * Production verisine yazmaz; in-memory karar + allowlist + wiring.
 *
 * FAIL (eski): aynı key + terminal_status var → existingJob, yeni OUTPUT_READY yazılmaz.
 * PASS (yeni): result_stale / pipe-stale → aynı istekte 1 yeni job; eski satır korunur.
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
  ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  assertSourceTenantMatch,
  buildRevisionIdempotencyKey,
  evaluateV1PersistIdempotencyDecision,
  isCompatibleExistingReanalyzeJob,
  isHydrateJobResultStale,
} = await import("@/src/utils/bankStatementReanalyze.js");

const { ANNVERO_V1_ENGINE_VERSION, V1_JOB_STATE, buildV1ResultSummary } =
  await import("@/src/utils/annveroV1Orchestration.js");

const { buildSafeV1PersistPayload, V1_SAFE_METADATA_KEYS } = await import(
  "@/src/utils/annveroV1SafePersist.js"
);

const COMPANY = "84384297-270c-47cd-ac5a-d693ba80b84a";
const OTHER_COMPANY = "00000000-0000-0000-0000-000000000099";
const SOURCE = "6c1690b3-dad0-4361-b552-ed86575884de";
const HASH = "ad1e7532eba648be";
const PLAN_FP = "d652977ac49b121412aa8ecab4a4fe54ac8a69816759de62804353c939f07a9a";

function currentKey(overrides = {}) {
  return buildRevisionIdempotencyKey({
    companyId: COMPANY,
    contentHash: HASH,
    revision: 2,
    planFingerprint: PLAN_FP,
    pipelineVersion: ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
    sourceId: SOURCE,
    sourceRevision: 1,
    snapshotFingerprint: HASH,
    ...overrides,
  });
}

function incomingReadySummary(overrides = {}) {
  return buildV1ResultSummary({
    movementCount: 4,
    lucaRowCount: 8,
    autoMatchedCount: 4,
    reviewCount: 0,
    terminalStatus: V1_JOB_STATE.COMPLETED,
    balanceCode: "BALANCE_MATCHED",
    reviewRequired: false,
    canAutoApprove: true,
    outputGateCode: "OUTPUT_READY",
    pipelineVersion: ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
    sourceId: SOURCE,
    sourceRevision: "1",
    planFingerprint: PLAN_FP,
    snapshotFingerprint: HASH,
    engineVersion: ANNVERO_V1_ENGINE_VERSION,
    ...overrides,
  });
}

function staleEvidenceJob(id = "job-stale") {
  const key = currentKey();
  return {
    id,
    company_id: COMPANY,
    metadata: {
      idempotency_key: key,
      terminal_status: V1_JOB_STATE.REVIEW_REQUIRED,
      balance_code: "BALANCE_EVIDENCE_MISSING",
      auto_matched_count: 4,
      review_count: 0,
      engine_version: ANNVERO_V1_ENGINE_VERSION,
      pipeline_version: ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
      source_id: SOURCE,
      source_revision: "1",
      plan_fingerprint: PLAN_FP,
      snapshot_fingerprint: HASH,
    },
    created_at: "2026-08-13T17:25:00.000Z",
  };
}

/** Eski sunucu: key eşit + terminal dolu → uyumlu existingJob */
function legacyKeyTerminalDecision(existingRow, incomingKey) {
  if (!existingRow) {
    return { action: "create", existingJob: false, persisted: true };
  }
  const existingKey = String(existingRow.metadata?.idempotency_key || "").trim();
  const terminal = String(existingRow.metadata?.terminal_status || "").trim();
  const compatible = existingKey === incomingKey && Boolean(terminal);
  if (compatible) {
    return {
      action: "reuse",
      existingJob: true,
      persisted: false,
      compatible: true,
    };
  }
  return { action: "create", existingJob: false, persisted: true };
}

function applyPersist(store, incoming, { useLegacy = false } = {}) {
  const existing =
    [...store]
      .reverse()
      .find(
        (row) =>
          String(row.metadata?.idempotency_key || "") === incoming.key &&
          String(row.company_id || "") === String(incoming.companyId || "")
      ) || null;
  const decision = useLegacy
    ? legacyKeyTerminalDecision(existing, incoming.key)
    : evaluateV1PersistIdempotencyDecision({
        incomingIdempotencyKey: incoming.key,
        incomingCompanyId: incoming.companyId,
        incomingSummary: incoming.summary,
        expectedPipelineVersion: ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
        existingRow: existing,
        incomingLeaseId: incoming.leaseId || "",
        activeLeaseId: incoming.activeLeaseId || "",
      });
  if (decision.action === "deny") {
    return { ...decision, persisted: false, store, created: 0 };
  }
  if (decision.action === "reuse" || decision.action === "join") {
    return {
      ...decision,
      persisted: false,
      store,
      created: 0,
      job: existing,
    };
  }
  const row = {
    id: `job-new-${store.length + 1}`,
    company_id: incoming.companyId,
    metadata: {
      idempotency_key: incoming.key,
      terminal_status: incoming.summary.terminalStatus,
      balance_code: incoming.summary.balanceCode,
      auto_matched_count: incoming.summary.autoMatchedCount,
      review_count: incoming.summary.reviewCount,
      output_gate_code: incoming.summary.outputGateCode,
      engine_version: incoming.summary.engineVersion || ANNVERO_V1_ENGINE_VERSION,
      pipeline_version: incoming.summary.pipelineVersion,
      source_id: incoming.summary.sourceId,
      source_revision: String(incoming.summary.sourceRevision ?? ""),
      plan_fingerprint: incoming.summary.planFingerprint,
      snapshot_fingerprint: incoming.summary.snapshotFingerprint,
    },
    created_at: incoming.createdAt || "2026-08-14T09:00:00.000Z",
  };
  store.push(row);
  return {
    ...decision,
    persisted: true,
    existingJob: false,
    store,
    created: 1,
    job: row,
  };
}

test("FAIL reproduce: eski key+terminal kuralı OUTPUT_READY yazmaz", () => {
  const store = [staleEvidenceJob()];
  const incoming = {
    key: currentKey(),
    companyId: COMPANY,
    summary: incomingReadySummary(),
  };
  const legacy = applyPersist(store, incoming, { useLegacy: true });
  assert.equal(legacy.action, "reuse");
  assert.equal(legacy.existingJob, true);
  assert.equal(legacy.persisted, false);
  assert.equal(store.length, 1);
  assert.equal(store[0].metadata.balance_code, "BALANCE_EVIDENCE_MISSING");
  assert.equal(store[0].metadata.terminal_status, "review_required");
  assert.notEqual(store[0].metadata.output_gate_code, "OUTPUT_READY");
});

test("PASS: stale result → aynı istekte 1 yeni job; eski korunur", () => {
  const store = [staleEvidenceJob("job-old")];
  const incoming = {
    key: currentKey(),
    companyId: COMPANY,
    summary: incomingReadySummary(),
  };
  const first = applyPersist(store, incoming);
  assert.equal(first.action, "create");
  assert.equal(first.reason, "result_stale");
  assert.equal(first.existingJob, false);
  assert.equal(first.persisted, true);
  assert.equal(store.length, 2);
  assert.equal(store[0].id, "job-old");
  assert.equal(store[0].metadata.balance_code, "BALANCE_EVIDENCE_MISSING");
  assert.equal(store[1].metadata.auto_matched_count, 4);
  assert.equal(store[1].metadata.review_count, 0);
  assert.equal(store[1].metadata.balance_code, "BALANCE_MATCHED");
  assert.equal(store[1].metadata.output_gate_code, "OUTPUT_READY");
  assert.equal(store[1].metadata.terminal_status, "completed");

  const retry = applyPersist(store, incoming);
  assert.equal(retry.action, "reuse");
  assert.equal(retry.existingJob, true);
  assert.equal(retry.persisted, false);
  assert.equal(store.length, 2);
  assert.equal(retry.job.id, store[1].id);
});

test("stale pipelineVersion key → lookup miss → 1 yeni job", () => {
  const oldKey = buildRevisionIdempotencyKey({
    companyId: COMPANY,
    contentHash: HASH,
    revision: 2,
    planFingerprint: PLAN_FP,
    pipelineVersion: "br/1.0.0+vl/1.0.0",
    sourceId: SOURCE,
    sourceRevision: 1,
    snapshotFingerprint: HASH,
  });
  const store = [
    {
      id: "job-pipe-old",
      company_id: COMPANY,
      metadata: {
        idempotency_key: oldKey,
        terminal_status: "review_required",
        balance_code: "BALANCE_EVIDENCE_MISSING",
      },
    },
  ];
  const incoming = {
    key: currentKey(),
    companyId: COMPANY,
    summary: incomingReadySummary(),
  };
  assert.notEqual(incoming.key, oldKey);
  const result = applyPersist(store, incoming);
  assert.equal(result.action, "create");
  assert.equal(result.reason, "no_existing");
  assert.equal(store.length, 2);
  assert.equal(store[0].id, "job-pipe-old");
});

test("aynı-version aktif incomplete job → join; yeni satır yok", () => {
  const key = currentKey();
  const store = [
    {
      id: "job-inflight",
      company_id: COMPANY,
      metadata: {
        idempotency_key: key,
        terminal_status: "",
      },
    },
  ];
  const result = applyPersist(store, {
    key,
    companyId: COMPANY,
    summary: incomingReadySummary(),
    leaseId: "lease-b",
    activeLeaseId: "lease-a",
  });
  assert.equal(result.action, "join");
  assert.equal(result.existingJob, true);
  assert.equal(result.persisted, false);
  assert.equal(store.length, 1);
});

test("incomplete + kendi lease → create (uçuşu tamamla)", () => {
  const key = currentKey();
  const store = [
    {
      id: "job-abandoned",
      company_id: COMPANY,
      metadata: { idempotency_key: key, terminal_status: "" },
    },
  ];
  const result = applyPersist(store, {
    key,
    companyId: COMPANY,
    summary: incomingReadySummary(),
    leaseId: "lease-a",
    activeLeaseId: "lease-a",
  });
  assert.equal(result.action, "create");
  assert.equal(result.persisted, true);
  assert.equal(store.length, 2);
});

test("farklı source revision / snapshot / plan → yeni job", () => {
  const cases = [
    { sourceRevision: 2 },
    { snapshotFingerprint: "ffffeeee" },
    { planFingerprint: "bbbbccccdddd" },
  ];
  for (const extra of cases) {
    const store = [staleEvidenceJob()];
    const incoming = {
      key: currentKey(extra),
      companyId: COMPANY,
      summary: incomingReadySummary(extra),
    };
    assert.notEqual(incoming.key, currentKey());
    const result = applyPersist(store, incoming);
    assert.equal(result.action, "create");
    assert.equal(store.length, 2);
  }
});

test("farklı company → erişim reddi", () => {
  const store = [staleEvidenceJob()];
  const decision = evaluateV1PersistIdempotencyDecision({
    incomingIdempotencyKey: currentKey(),
    incomingCompanyId: OTHER_COMPANY,
    incomingSummary: incomingReadySummary(),
    existingRow: store[0],
  });
  assert.equal(decision.action, "deny");
  assert.equal(decision.status, 403);
  assert.equal(decision.code, "CROSS_TENANT_FORBIDDEN");
});

test("source başka firmaya ait → 403", () => {
  const denied = assertSourceTenantMatch({
    requestCompanyId: COMPANY,
    sourceCompanyId: OTHER_COMPANY,
    sourceId: SOURCE,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.equal(denied.code, "SOURCE_NOT_IN_COMPANY");
  const owned = assertSourceTenantMatch({
    requestCompanyId: COMPANY,
    sourceCompanyId: COMPANY,
    sourceId: SOURCE,
  });
  assert.equal(owned.ok, true);
});

test("hydrate: pipe var ama EVIDENCE_MISSING + snapshot evidence → stale", () => {
  const stale = isHydrateJobResultStale({
    existingMetadata: staleEvidenceJob().metadata,
    snapshotHasBalanceEvidence: true,
  });
  assert.equal(stale, true);
  const fresh = isHydrateJobResultStale({
    existingMetadata: {
      idempotency_key: currentKey(),
      terminal_status: "completed",
      balance_code: "BALANCE_MATCHED",
    },
    snapshotHasBalanceEvidence: true,
  });
  assert.equal(fresh, false);
});

test("compatible existing: aynı sonuç → reuse", () => {
  const key = currentKey();
  const compat = isCompatibleExistingReanalyzeJob({
    existingMetadata: {
      idempotency_key: key,
      terminal_status: "completed",
      balance_code: "BALANCE_MATCHED",
      output_gate_code: "OUTPUT_READY",
    },
    expectedIdempotencyKey: key,
    incomingSummary: incomingReadySummary(),
  });
  assert.equal(compat.ok, true);
});

test("persist payload OUTPUT_READY alanlarını saklar; content fingerprint yutulmaz", () => {
  const payload = buildSafeV1PersistPayload({
    companyId: COMPANY,
    jobId: "job-ready",
    idempotencyKey: currentKey(),
    summary: {
      ...incomingReadySummary(),
      planContentFingerprint: PLAN_FP,
      planFingerprint: PLAN_FP,
    },
  });
  assert.equal(payload.metadata.auto_matched_count, 4);
  assert.equal(payload.metadata.review_count, 0);
  assert.equal(payload.metadata.balance_code, "BALANCE_MATCHED");
  assert.equal(payload.metadata.output_gate_code, "OUTPUT_READY");
  assert.equal(payload.metadata.terminal_status, "completed");
  assert.equal(payload.metadata.pipeline_version, ANNVERO_BANK_REANALYZE_PIPELINE_VERSION);
  assert.equal(payload.metadata.plan_fingerprint, PLAN_FP);
  assert.equal(payload.metadata.source_id, SOURCE);
  assert.equal(payload.metadata.plan_content_fingerprint, undefined);
  assert.ok(V1_SAFE_METADATA_KEYS.includes("output_gate_code"));
  assert.ok(V1_SAFE_METADATA_KEYS.includes("pipeline_version"));
});

test("wiring: server tek istekte karar verir; force bypass yok; ikinci persist yok", () => {
  const workbench = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  const jobsRoute = fs.readFileSync(
    path.join(root, "app/api/annvero-v1/jobs/route.js"),
    "utf8"
  );
  const oneClick = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
    ),
    "utf8"
  );

  assert.match(jobsRoute, /evaluateV1PersistIdempotencyDecision/);
  assert.match(jobsRoute, /SOURCE_NOT_IN_COMPANY/);
  assert.match(jobsRoute, /compatibilityReason/);
  assert.match(jobsRoute, /loadOwnedBankSource/);
  assert.doesNotMatch(jobsRoute, /force\s*[:=]\s*true/);
  assert.doesNotMatch(
    jobsRoute,
    /from\(AUDIT_EVENTS_TABLE\)[\s\S]{0,160}\.delete\(/
  );
  assert.match(jobsRoute, /\.eq\("company_id", company\)/);

  assert.match(workbench, /isHydrateJobResultStale/);
  assert.match(workbench, /decideCanonicalHydrateReanalyze/);
  assert.match(workbench, /persistAuditWarning/);
  assert.match(workbench, /outputGateCode: resultSummary\.outputGateCode/);
  assert.match(workbench, /planFingerprint: resultSummary\.planFingerprint/);
  assert.doesNotMatch(workbench, /force:\s*true/);
  const persistCalls = workbench.match(/await persistV1JobSummary\(/g) || [];
  assert.equal(persistCalls.length, 4);
  assert.match(oneClick, /bank-persist-audit-warning/);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll v1-job-persist-idempotency tests passed.");
