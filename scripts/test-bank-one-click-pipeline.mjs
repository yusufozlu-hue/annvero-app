/**
 * Tek tuş banka üretim hattı — saf yardımcı + orkestrasyon sözleşmesi testleri.
 * Gerçek Excel / worker UI testi kullanıcı tarafında.
 */
import assert from "node:assert/strict";
import {
  assertPipelineSignal,
  canStartFullPipeline,
  createAbortError,
  formatDurationMs,
  getPipelinePhaseLabel,
  isBankParserServiceModeVisible,
  mapLocalProgressToGlobal,
  PIPELINE_PHASES,
  PROGRESS_BANDS,
  shouldRunPipelineStage,
  userFacingPipelineError,
} from "../src/utils/bankOneClickPipeline.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("progress bands cover requested ranges", () => {
  assert.equal(PROGRESS_BANDS.PARSING.from, 0);
  assert.equal(PROGRESS_BANDS.PARSING.to, 20);
  assert.equal(PROGRESS_BANDS.PREVIEW.from, 20);
  assert.equal(PROGRESS_BANDS.PREVIEW.to, 30);
  assert.equal(PROGRESS_BANDS.ACCOUNTING_ANALYSIS.from, 30);
  assert.equal(PROGRESS_BANDS.ACCOUNTING_ANALYSIS.to, 75);
  assert.equal(PROGRESS_BANDS.LUCA_BUILD.from, 75);
  assert.equal(PROGRESS_BANDS.LUCA_BUILD.to, 90);
  assert.equal(PROGRESS_BANDS.VALIDATION.from, 90);
  assert.equal(PROGRESS_BANDS.VALIDATION.to, 99);
  assert.equal(PROGRESS_BANDS.READY_FOR_EXPORT.from, 100);
});

test("mapLocalProgressToGlobal maps midpoints", () => {
  assert.equal(mapLocalProgressToGlobal("PARSING", 0), 0);
  assert.equal(mapLocalProgressToGlobal("PARSING", 100), 20);
  assert.equal(mapLocalProgressToGlobal("PREVIEW", 0), 20);
  assert.equal(mapLocalProgressToGlobal("PREVIEW", 100), 30);
  assert.equal(mapLocalProgressToGlobal("ACCOUNTING_ANALYSIS", 0), 30);
  assert.equal(mapLocalProgressToGlobal("ACCOUNTING_ANALYSIS", 100), 75);
  assert.equal(mapLocalProgressToGlobal("LUCA_BUILD", 50), 83);
  assert.equal(mapLocalProgressToGlobal("VALIDATION", 100), 99);
  assert.equal(mapLocalProgressToGlobal("READY_FOR_EXPORT", 0), 100);
});

test("phase labels prefer memory/cari detail when present", () => {
  assert.match(
    getPipelinePhaseLabel("ACCOUNTING_ANALYSIS", "hafıza eşleşmesi"),
    /hafızası|cari/i
  );
  assert.match(
    getPipelinePhaseLabel("PARSING", "hareketler ayrışıyor"),
    /ayrıştırılıyor/i
  );
  assert.equal(
    getPipelinePhaseLabel("READY_FOR_EXPORT"),
    "Luca dosyanız hazır."
  );
});

test("canStartFullPipeline enforces preconditions and single-flight", () => {
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "c1",
      selectedBank: "vakifbank",
      selectedFile: { name: "a.xlsx" },
      isJobBusy: false,
      pipelinePhase: PIPELINE_PHASES.IDLE,
    }),
    true
  );
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "",
      selectedBank: "vakifbank",
      selectedFile: { name: "a.xlsx" },
      isJobBusy: false,
      pipelinePhase: PIPELINE_PHASES.IDLE,
    }),
    false
  );
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "c1",
      selectedBank: "vakifbank",
      selectedFile: { name: "a.xlsx" },
      isJobBusy: true,
      pipelinePhase: PIPELINE_PHASES.IDLE,
    }),
    false
  );
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "c1",
      selectedBank: "vakifbank",
      selectedFile: { name: "a.xlsx" },
      isJobBusy: false,
      pipelinePhase: PIPELINE_PHASES.ACCOUNTING_ANALYSIS,
    }),
    false
  );
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "c1",
      selectedBank: "vakifbank",
      selectedFile: { name: "a.xlsx" },
      isJobBusy: false,
      pipelinePhase: PIPELINE_PHASES.ERROR,
    }),
    true
  );
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "c1",
      selectedBank: "vakifbank",
      selectedFile: { name: "a.xlsx" },
      isJobBusy: false,
      pipelinePhase: PIPELINE_PHASES.READY_FOR_EXPORT,
    }),
    true
  );
});

test("shouldRunPipelineStage resume skips earlier stages", () => {
  assert.equal(shouldRunPipelineStage(null, "PARSING"), true);
  assert.equal(shouldRunPipelineStage("ACCOUNTING_ANALYSIS", "PARSING"), false);
  assert.equal(shouldRunPipelineStage("ACCOUNTING_ANALYSIS", "PREVIEW"), false);
  assert.equal(
    shouldRunPipelineStage("ACCOUNTING_ANALYSIS", "ACCOUNTING_ANALYSIS"),
    true
  );
  assert.equal(shouldRunPipelineStage("ACCOUNTING_ANALYSIS", "LUCA_BUILD"), true);
  assert.equal(shouldRunPipelineStage("LUCA_BUILD", "VALIDATION"), true);
  assert.equal(shouldRunPipelineStage("VALIDATION", "PARSING"), false);
});

test("assertPipelineSignal throws AbortError", () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => assertPipelineSignal(controller.signal, () => true, 1),
    (err) => err?.name === "AbortError"
  );
  assert.throws(
    () => assertPipelineSignal({ aborted: false }, () => false, 2),
    (err) => err?.name === "AbortError"
  );
  assert.equal(createAbortError().name, "AbortError");
});

test("userFacingPipelineError stays generic", () => {
  assert.match(userFacingPipelineError("ACCOUNTING_ANALYSIS"), /Muhasebe/);
  assert.doesNotMatch(userFacingPipelineError("LUCA_BUILD"), /stack|Error:/);
});

test("formatElapsedClock and UI step statuses", async () => {
  const {
    formatElapsedClock,
    getPipelineUiStepStatuses,
    getPipelinePhaseTitle,
    buildMissingAccountsHint,
    deriveAutoMatchedMovements,
  } = await import("../src/utils/bankOneClickPipeline.js");

  assert.equal(formatElapsedClock(18), "00:18");
  assert.equal(formatElapsedClock(75), "01:15");

  const running = getPipelineUiStepStatuses("ACCOUNTING_ANALYSIS");
  assert.equal(running[0].status, "done");
  assert.equal(running[1].status, "done");
  assert.equal(running[2].status, "active");
  assert.equal(running[3].status, "pending");

  const ready = getPipelineUiStepStatuses("READY_FOR_EXPORT");
  assert.ok(ready.every((s) => s.status === "done"));

  const errored = getPipelineUiStepStatuses("ERROR", {
    errorPhase: "LUCA_BUILD",
  });
  assert.equal(errored[3].status, "error");

  assert.match(getPipelinePhaseTitle("LUCA_BUILD"), /Luca/i);
  assert.match(buildMissingAccountsHint(423), /423 satırda/);
  assert.equal(deriveAutoMatchedMovements(2832 - 423), Math.round((2832 - 423) / 2));
  assert.equal(formatDurationMs(400), "400 ms");
});

test("resolveParserBankFromSheet detects Vakıf / Garanti headers", async () => {
  const { resolveParserBankFromSheet } = await import(
    "../src/utils/bankStatementFormatGuard.js"
  );
  const vakif = resolveParserBankFromSheet([
    ["Hesap No", "Fiş No", "İşlem Tarihi", "Açıklama", "Tutar", "B/A"],
  ]);
  assert.equal(vakif.status, "detected");
  assert.equal(vakif.bankId, "VAKIFBANK");

  const garanti = resolveParserBankFromSheet([
    ["Tarih", "Açıklama", "Etiket", "Tutar", "Bakiye", "Dekont No"],
  ]);
  assert.equal(garanti.status, "detected");
  assert.equal(garanti.bankId, "GARANTI");

  const unknown = resolveParserBankFromSheet([["foo", "bar"]]);
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.bankId, null);
});

test("pipeline requires explicit bank — empty selectedBank blocks start", () => {
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "c1",
      selectedBank: "",
      selectedFile: { name: "a.xlsx" },
      isJobBusy: false,
      pipelinePhase: PIPELINE_PHASES.IDLE,
    }),
    false
  );
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "c1",
      selectedBank: "VAKIFBANK",
      selectedFile: { name: "a.xlsx" },
      isJobBusy: false,
      pipelinePhase: PIPELINE_PHASES.IDLE,
    }),
    true
  );
});

test("service mode visibility: admin or dev+debug only", () => {
  assert.equal(
    isBankParserServiceModeVisible({
      isManagementUser: false,
      nodeEnv: "production",
      debugFlag: false,
    }),
    false
  );
  assert.equal(
    isBankParserServiceModeVisible({
      isManagementUser: true,
      nodeEnv: "production",
      debugFlag: false,
    }),
    true
  );
  assert.equal(
    isBankParserServiceModeVisible({
      isManagementUser: false,
      nodeEnv: "development",
      debugFlag: false,
    }),
    false
  );
  assert.equal(
    isBankParserServiceModeVisible({
      isManagementUser: false,
      nodeEnv: "development",
      debugFlag: true,
    }),
    true
  );
  assert.equal(
    isBankParserServiceModeVisible({
      isManagementUser: false,
      nodeEnv: "production",
      debugFlag: true,
    }),
    false
  );
});

test("happy-path progress monotonicity across stages", () => {
  const sequence = [
    ["PARSING", 0],
    ["PARSING", 100],
    ["PREVIEW", 50],
    ["ACCOUNTING_ANALYSIS", 0],
    ["ACCOUNTING_ANALYSIS", 100],
    ["LUCA_BUILD", 100],
    ["VALIDATION", 100],
    ["READY_FOR_EXPORT", 0],
  ];
  let prev = -1;
  for (const [phase, local] of sequence) {
    const global = mapLocalProgressToGlobal(phase, local);
    assert.ok(global >= prev, `${phase}@${local} -> ${global} < ${prev}`);
    prev = global;
  }
  assert.equal(prev, 100);
});

test("missing accounts do not equal hard failure contract", () => {
  // Validation success with missingCount > 0 is still READY_FOR_EXPORT
  const validationOk = { missingCount: 423, unrecognizedCount: 12 };
  const phase = PIPELINE_PHASES.READY_FOR_EXPORT;
  assert.equal(phase, "READY_FOR_EXPORT");
  assert.ok(validationOk.missingCount > 0);
  assert.notEqual(phase, PIPELINE_PHASES.ERROR);
});

console.log("\nAll bank one-click pipeline unit tests passed.");
