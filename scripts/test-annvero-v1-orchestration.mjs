/**
 * ANNVERO V1 orkestrasyon — durum makinesi, lease, Fiş Kontrol, E-Defter, güvenli özet.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-annvero-v1-orchestration.mjs
 */
import assert from "node:assert/strict";

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

const {
  ACCOUNTING_PRIORITY,
  ANNVERO_V1_ENGINE_VERSION,
  V1_CTA_LABEL,
  V1_EDEFTER_STATUS,
  V1_JOB_STATE,
  V1_STAGE_ORDER,
  assertLucaRowExpectation,
  buildIdempotencyKey,
  buildV1ResultSummary,
  canStartV1Pipeline,
  canTransitionV1Job,
  clearV1CompanyScopedState,
  createInitialV1JobState,
  decideTerminalStatus,
  mapLocalProgressToV1,
  mapLegacyPhaseToV1,
  mapV1PhaseToLegacy,
  reconcileEdefterStage,
  releaseCompanyLease,
  resolveRetryFromPhase,
  runDedupStage,
  runVoucherControlStage,
  shouldBlockNewV1Job,
  shouldRunV1Stage,
  transitionV1Job,
  tryAcquireCompanyLease,
  validateV1Inputs,
} = await import("../src/utils/annveroV1Orchestration.js");

const {
  assertNoRawV1Leak,
  buildSafeV1PersistPayload,
  publicV1JobView,
  sanitizeIncomingV1JobBody,
} = await import("../src/utils/annveroV1SafePersist.js");

test("CTA label is İşle ve Kontrol Et", () => {
  assert.equal(V1_CTA_LABEL, "İşle ve Kontrol Et");
});

test("accounting priority order is immutable CORE-first", () => {
  assert.deepEqual([...ACCOUNTING_PRIORITY], [
    "core_mevzuat",
    "company_user_rules",
    "account_memory",
    "system_defaults",
    "review_queue",
  ]);
});

test("canonical stage order matches contract", () => {
  assert.deepEqual([...V1_STAGE_ORDER], [
    "validating",
    "archiving",
    "parsing",
    "deduplicating",
    "applying_core",
    "applying_memory",
    "creating_vouchers",
    "controlling_vouchers",
    "reconciling_edefter",
    "generating_exports",
    "persisting",
  ]);
});

test("state machine allows happy path and rejects illegal jumps", () => {
  let state = createInitialV1JobState();
  assert.equal(state.phase, V1_JOB_STATE.IDLE);
  assert.equal(canTransitionV1Job(V1_JOB_STATE.IDLE, V1_JOB_STATE.VALIDATING), true);
  assert.equal(canTransitionV1Job(V1_JOB_STATE.IDLE, V1_JOB_STATE.PARSING), false);
  state = transitionV1Job(state, V1_JOB_STATE.VALIDATING);
  assert.equal(state.phase, V1_JOB_STATE.VALIDATING);
  assert.equal(state.loading, true);
  state = transitionV1Job(state, V1_JOB_STATE.ARCHIVING);
  state = transitionV1Job(state, V1_JOB_STATE.PARSING);
  const bad = transitionV1Job(state, V1_JOB_STATE.PERSISTING);
  assert.equal(bad.phase, V1_JOB_STATE.FAILED);
});

test("shouldBlockNewV1Job / shouldRunV1Stage / retry from fail stage", () => {
  const busy = createInitialV1JobState({ phase: V1_JOB_STATE.PARSING, loading: true });
  assert.equal(shouldBlockNewV1Job(busy), true);
  assert.equal(shouldRunV1Stage(null, V1_JOB_STATE.PARSING), true);
  assert.equal(shouldRunV1Stage(V1_JOB_STATE.CREATING_VOUCHERS, V1_JOB_STATE.PARSING), false);
  assert.equal(
    shouldRunV1Stage(V1_JOB_STATE.CREATING_VOUCHERS, V1_JOB_STATE.CREATING_VOUCHERS),
    true
  );
  const outputs = {
    [V1_JOB_STATE.VALIDATING]: { ok: true },
    [V1_JOB_STATE.ARCHIVING]: { ok: true },
    [V1_JOB_STATE.PARSING]: { ok: true },
    [V1_JOB_STATE.DEDUPLICATING]: { ok: true },
  };
  assert.equal(
    resolveRetryFromPhase(V1_JOB_STATE.APPLYING_CORE, outputs),
    V1_JOB_STATE.APPLYING_CORE
  );
});

test("company lease single-flight and release", () => {
  let store = new Map();
  const a = tryAcquireCompanyLease(store, {
    companyId: "c1",
    leaseId: "L1",
    now: 1000,
  });
  assert.equal(a.ok, true);
  store = a.store;
  const b = tryAcquireCompanyLease(store, {
    companyId: "c1",
    leaseId: "L2",
    now: 2000,
  });
  assert.equal(b.ok, false);
  assert.equal(b.code, "COMPANY_JOB_ACTIVE");
  store = releaseCompanyLease(store, { companyId: "c1", leaseId: "L1" });
  const c = tryAcquireCompanyLease(store, {
    companyId: "c1",
    leaseId: "L2",
    now: 3000,
  });
  assert.equal(c.ok, true);
});

test("firma değişince state clear", () => {
  const cleared = clearV1CompanyScopedState({
    phase: V1_JOB_STATE.COMPLETED,
    companyId: "old",
    jobId: "j1",
  });
  assert.equal(cleared.phase, V1_JOB_STATE.IDLE);
  assert.equal(cleared.companyId, "");
  assert.equal(cleared.jobId, null);
});

test("progress bands monotonic and complete at 100", () => {
  assert.equal(mapLocalProgressToV1(V1_JOB_STATE.VALIDATING, 0), 0);
  assert.ok(mapLocalProgressToV1(V1_JOB_STATE.PARSING, 100) >= 28);
  assert.equal(mapLocalProgressToV1(V1_JOB_STATE.COMPLETED, 0), 100);
});

test("E-Defter missing → EDEFTER_NOT_AVAILABLE without blocking", () => {
  const r = reconcileEdefterStage({});
  assert.equal(r.code, V1_EDEFTER_STATUS.EDEFTER_NOT_AVAILABLE);
  assert.equal(r.blocksBankFlow, false);
  const na = reconcileEdefterStage({ forceNotApplicable: true });
  assert.equal(na.code, V1_EDEFTER_STATUS.NOT_APPLICABLE);
});

test("1416 movements → 2832 Luca expectation", () => {
  const r = assertLucaRowExpectation(1416, 2832);
  assert.equal(r.ok, true);
  assert.equal(r.expected, 2832);
  assert.equal(r.actual, 2832);
  assert.equal(r.deterministic, true);
});

test("dedup all-duplicate and PDF OCR_REQUIRED", () => {
  const row = {
    tarih: "01.01.2026",
    tutar: 10,
    aciklama: "A TEST HAREKET",
    yon: "GIRIS",
    borc: 10,
    alacak: 0,
  };
  const ctx = { companyId: "c1", selectedBank: "VAKIFBANK" };
  const dup = runDedupStage({
    rows: [row],
    existingKeys: new Set(),
    context: ctx,
  });
  assert.ok((dup.unique || []).length >= 1, "first pass yields unique");
  const firstKeys = new Set(
    (dup.unique || []).map((t) => t.transactionId).filter(Boolean)
  );
  assert.ok(firstKeys.size >= 1, "canonical ids present");
  const again = runDedupStage({
    rows: [row],
    existingKeys: firstKeys,
    context: ctx,
  });
  assert.equal(again.uniqueCount ?? again.unique?.length ?? -1, 0);
  assert.equal(again.allDuplicate, true);

  const ocr = runDedupStage({
    rows: [],
    pdfResult: { code: "OCR_REQUIRED", status: "OCR_REQUIRED", message: "OCR" },
  });
  assert.equal(ocr.code, "OCR_REQUIRED");
  assert.equal(ocr.ok, false);
});

test("voucher control: critical → no auto approve", () => {
  const rows = [
    {
      fisNo: "1",
      fisTarihi: "01.01.2026",
      hesapKodu: "",
      borc: 100,
      alacak: 0,
      detayAciklama: "test",
      guvenSkoru: 40,
    },
    {
      fisNo: "1",
      fisTarihi: "01.01.2026",
      hesapKodu: "102.01",
      borc: 0,
      alacak: 100,
      detayAciklama: "test",
      guvenSkoru: 40,
    },
  ];
  const ctrl = runVoucherControlStage(rows, { companyId: "c1" });
  assert.equal(ctrl.canAutoApprove, false);
  assert.equal(ctrl.reviewRequired, true);
  assert.ok(ctrl.lucaGroupSize === 50);
});

test("terminal status decision", () => {
  assert.equal(decideTerminalStatus({ duplicate: true }), V1_JOB_STATE.DUPLICATE);
  assert.equal(
    decideTerminalStatus({ reviewRequired: true }),
    V1_JOB_STATE.REVIEW_REQUIRED
  );
  assert.equal(decideTerminalStatus({}), V1_JOB_STATE.COMPLETED);
});

test("legacy ↔ V1 phase mapping", () => {
  assert.equal(mapLegacyPhaseToV1("ACCOUNTING_ANALYSIS"), V1_JOB_STATE.APPLYING_CORE);
  assert.equal(mapV1PhaseToLegacy(V1_JOB_STATE.COMPLETED), "READY_FOR_EXPORT");
});

test("canStartV1Pipeline preconditions", () => {
  assert.equal(
    canStartV1Pipeline({
      selectedCompanyId: "c1",
      selectedFile: { name: "a.xlsx" },
      isJobBusy: false,
      pipelinePhase: V1_JOB_STATE.IDLE,
    }),
    true
  );
  assert.equal(
    canStartV1Pipeline({
      selectedCompanyId: "c1",
      selectedFile: { name: "a.xlsx" },
      isJobBusy: true,
      pipelinePhase: V1_JOB_STATE.IDLE,
    }),
    false
  );
});

test("validateV1Inputs Turkish errors", () => {
  assert.equal(validateV1Inputs({}).ok, false);
  assert.match(validateV1Inputs({}).message, /firma/i);
  assert.equal(
    validateV1Inputs({
      companyId: "c1",
      file: { name: "x.xlsx", size: 0 },
    }).code,
    "EMPTY_FILE"
  );
});

test("safe persist strips secrets and forbids raw leak", () => {
  const payload = buildSafeV1PersistPayload({
    companyId: "c1",
    jobId: "j1",
    idempotencyKey: buildIdempotencyKey({ companyId: "c1", contentHash: "abc" }),
    summary: buildV1ResultSummary({
      movementCount: 10,
      lucaRowCount: 20,
      terminalStatus: V1_JOB_STATE.COMPLETED,
      edefter: reconcileEdefterStage({}),
    }),
  });
  assert.equal(payload.entity_type, "annvero_v1_job");
  assert.equal(payload.metadata.engine_version, ANNVERO_V1_ENGINE_VERSION);
  assert.equal(payload.metadata.edefter_code, "EDEFTER_NOT_AVAILABLE");
  assert.ok(!("fileId" in payload.metadata));
  assertNoRawV1Leak(payload);

  assert.throws(() =>
    assertNoRawV1Leak({
      metadata: { fileId: "xyz", access_token: "tok" },
    })
  );

  const incoming = sanitizeIncomingV1JobBody({
    companyId: "c1",
    summary: {
      movementCount: 5,
      iban: "TR00",
      rawXml: "<x/>",
      fileId: "drive-1",
    },
  });
  assert.equal(incoming.summary.movementCount, 5);
  assert.equal(incoming.summary.iban, undefined);
  assert.equal(incoming.summary.rawXml, undefined);

  const view = publicV1JobView({
    id: "1",
    company_id: "c1",
    metadata: payload.metadata,
    created_at: "2026-07-30T00:00:00Z",
  });
  assert.equal(view.companyId, "c1");
  assert.equal(view.metadata.movement_count, 10);
});

test("idempotency key stable", () => {
  const a = buildIdempotencyKey({ companyId: "c1", contentHash: "h1" });
  const b = buildIdempotencyKey({ companyId: "c1", contentHash: "h1" });
  assert.equal(a, b);
  assert.match(a, /^annvero-v1:c1:h1:/);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll ANNVERO V1 orchestration tests passed.");
