/**
 * PR #77: missing-apply → parent sync + reanalyze lock lifecycle.
 * Run: node --import ./scripts/_alias-loader.mjs --test ./scripts/test-missing-apply-reanalyze-lifecycle.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergePipelineResultAfterMissingApply,
  shouldAcceptMissingApplyParentSync,
  shouldStartMissingApplyReanalyzeJob,
  resolveMissingApplyReanalyzeBusyFeedback,
} from "@/src/utils/missingAccountApplyParentSync.js";
import {
  claimReanalyzeClick,
  releaseReanalyzeClick,
  attachReanalyzeFlightPromise,
  completeReanalyzeFlight,
  failReanalyzeFlight,
  buildReanalyzeFlightKey,
  clearAllReanalyzeFlights,
  healStaleReanalyzeFlights,
  isLiveReanalyzeFlight,
  __resetReanalyzeOrchestrationForTests,
} from "@/src/utils/bankReanalyzeClick.js";
import {
  reanalyzeAfterMissingAccountApply,
  buildPipelinePatchFromReanalyze,
} from "@/src/utils/missingAccountsReanalyze.js";
import { BANK_JOB_STATE, createInitialBankJobState } from "@/src/utils/bankJobStateMachine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function makeLock() {
  return { current: false };
}

test("A: apply patch → parent merge; success/failure/abort clear locks", async () => {
  __resetReanalyzeOrchestrationForTests();
  const lockRef = makeLock();
  let isReanalyzing = false;
  const setIsReanalyzing = (v) => {
    isReanalyzing = v;
  };

  const prev = {
    duplicate: true,
    autoMatchedCount: 5,
    uniqueUnresolvedMovements: 7,
    missingCount: 7,
    movementCount: 12,
    reviewRequired: true,
  };
  const patch = buildPipelinePatchFromReanalyze({
    missingReport: {
      missingCount: 0,
      uniqueUnresolvedMovements: 0,
      uniqueMatchedMovements: 12,
      readyCount: 12,
    },
    fisKontrol: { passed: 12, warnings: 0, errors: 0 },
  });
  const merged = mergePipelineResultAfterMissingApply(prev, {
    pipelinePatch: patch,
    lucaRowCount: 24,
    revisionCompare: { rows: [{ key: "auto", previous: 5, next: 12 }] },
    applyGeneration: 1,
  });
  assert.equal(merged.duplicate, true, "mükerrer etiketi korunur");
  assert.equal(merged.autoMatchedCount, 12);
  assert.equal(merged.uniqueUnresolvedMovements, 0);
  assert.equal(merged.missingCount, 0);
  assert.equal(merged.reviewRequired, false);
  assert.equal(merged.movementCount, 12);

  const flightKey = buildReanalyzeFlightKey({
    companyId: "c1",
    sourceId: "s1",
    sourceRevision: 1,
    planFingerprint: "p1",
  });
  const claim = claimReanalyzeClick({
    lockRef,
    isReanalyzing,
    isJobBusy: false,
    pipelineRunning: false,
    setIsReanalyzing,
    flightKey,
    owner: "missing_apply",
    companyId: "c1",
  });
  assert.equal(claim.ok, true);
  assert.equal(isReanalyzing, true);
  assert.equal(lockRef.current, true);

  let resolveFn;
  const promise = new Promise((r) => {
    resolveFn = r;
  });
  attachReanalyzeFlightPromise(flightKey, promise);
  completeReanalyzeFlight(flightKey, { ok: true });
  resolveFn({ ok: true });
  await promise;
  releaseReanalyzeClick({ lockRef, setIsReanalyzing });
  assert.equal(isReanalyzing, false);
  assert.equal(lockRef.current, false);

  // failure path
  const claim2 = claimReanalyzeClick({
    lockRef,
    isReanalyzing,
    isJobBusy: false,
    setIsReanalyzing,
    flightKey: flightKey + "|2",
    owner: "missing_apply",
    companyId: "c1",
  });
  assert.equal(claim2.ok, true);
  failReanalyzeFlight(flightKey + "|2", { failed: true });
  releaseReanalyzeClick({ lockRef, setIsReanalyzing });
  assert.equal(lockRef.current, false);

  // abort-like: promise'siz running → heal
  claimReanalyzeClick({
    lockRef,
    isReanalyzing: false,
    isJobBusy: false,
    setIsReanalyzing,
    flightKey: flightKey + "|3",
    companyId: "c1",
  });
  // no attach → stale
  const healed = healStaleReanalyzeFlights({ companyId: "c1" });
  assert.ok(healed.healed >= 1);
  releaseReanalyzeClick({ lockRef, setIsReanalyzing });
  assert.equal(lockRef.current, false);
});

test("B: modal close sync — parent eski 7 incelemeyi tutmaz", () => {
  const prev = {
    autoMatchedCount: 5,
    uniqueUnresolvedMovements: 7,
    missingCount: 7,
    movementCount: 12,
  };
  const next = mergePipelineResultAfterMissingApply(prev, {
    pipelinePatch: {
      autoMatchedCount: 12,
      uniqueUnresolvedMovements: 0,
      unresolvedMovementCount: 0,
      missingCount: 0,
    },
    lucaRowCount: 24,
  });
  assert.equal(next.autoMatchedCount, 12);
  assert.equal(next.uniqueUnresolvedMovements, 0);
  assert.equal(next.missingCount, 0);
  assert.equal(
    shouldAcceptMissingApplyParentSync({
      applyGeneration: 2,
      activeGeneration: 2,
    }),
    true
  );
  assert.equal(
    shouldAcceptMissingApplyParentSync({
      applyGeneration: 1,
      activeGeneration: 2,
    }),
    false
  );
});

test("C: double click — ikinci job yok; kırmızı busy toast yok", () => {
  __resetReanalyzeOrchestrationForTests();
  const lockRef = makeLock();
  let isReanalyzing = false;
  const setIsReanalyzing = (v) => {
    isReanalyzing = v;
  };
  const flightKey = buildReanalyzeFlightKey({
    companyId: "c1",
    sourceId: "s1",
    planFingerprint: "p",
  });
  const first = claimReanalyzeClick({
    lockRef,
    isReanalyzing,
    isJobBusy: false,
    setIsReanalyzing,
    flightKey,
    owner: "missing_apply",
    companyId: "c1",
  });
  assert.equal(first.ok, true);
  attachReanalyzeFlightPromise(flightKey, Promise.resolve());
  const second = claimReanalyzeClick({
    lockRef,
    isReanalyzing: true,
    isJobBusy: false,
    setIsReanalyzing,
    flightKey,
    owner: "manual",
    companyId: "c1",
  });
  assert.equal(second.ok, false);
  assert.ok(
    second.reason === "join_in_flight" || second.reason === "in_flight"
  );
  const feedback = resolveMissingApplyReanalyzeBusyFeedback({
    reason: "manual",
    claimReason: second.reason,
    isLiveBusy: true,
  });
  assert.equal(feedback.level, "info");
  assert.match(feedback.message, /tamamlanıyor/i);
  assert.notEqual(feedback.level, "error");
  completeReanalyzeFlight(flightKey);
  releaseReanalyzeClick({ lockRef, setIsReanalyzing });
});

test("D: stale completed lock yeni manuel analizi engellemez; canlı iş engeller", () => {
  __resetReanalyzeOrchestrationForTests();
  const lockRef = makeLock();
  lockRef.current = true;
  let isReanalyzing = false;
  const setIsReanalyzing = (v) => {
    isReanalyzing = v;
  };
  const flightKey = buildReanalyzeFlightKey({
    companyId: "c1",
    sourceId: "s1",
    planFingerprint: "stale",
  });
  // completed flight leftover
  claimReanalyzeClick({
    lockRef: makeLock(),
    isReanalyzing: false,
    isJobBusy: false,
    setIsReanalyzing: () => {},
    flightKey,
    companyId: "c1",
  });
  completeReanalyzeFlight(flightKey);
  const claim = claimReanalyzeClick({
    lockRef,
    isReanalyzing: false,
    isJobBusy: false,
    pipelineRunning: false,
    setIsReanalyzing,
    flightKey: flightKey + "|new",
    companyId: "c1",
    bankJobBlocking: true,
    reactJobBusy: false,
    resetBankJobState: () => {},
  });
  assert.equal(claim.ok, true, "stale lock healed");
  releaseReanalyzeClick({ lockRef, setIsReanalyzing });

  const liveKey = buildReanalyzeFlightKey({
    companyId: "c1",
    sourceId: "s2",
    planFingerprint: "live",
  });
  const liveClaim = claimReanalyzeClick({
    lockRef,
    isReanalyzing: false,
    isJobBusy: false,
    setIsReanalyzing,
    flightKey: liveKey,
    companyId: "c1",
  });
  assert.equal(liveClaim.ok, true);
  attachReanalyzeFlightPromise(liveKey, new Promise(() => {}));
  assert.equal(isLiveReanalyzeFlight({ status: "running", promise: Promise.resolve() }), true);

  const blocked = claimReanalyzeClick({
    lockRef,
    isReanalyzing: true,
    isJobBusy: false,
    setIsReanalyzing,
    flightKey: liveKey,
    companyId: "c1",
  });
  assert.equal(blocked.ok, false);
  clearAllReanalyzeFlights();
  releaseReanalyzeClick({ lockRef, setIsReanalyzing });
});

test("E: clean-open wiring korunur", () => {
  const workbench = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(workbench, /her girişte temiz|auto-hydrate kapalı/);
  assert.doesNotMatch(workbench, /void hydrateCanonicalSnapshot\(\)/);
  assert.match(workbench, /fileInputKey/);
  assert.match(workbench, /syncParentAfterMissingApply/);
  assert.match(workbench, /handleCloseCariResolutionCenter/);
  assert.match(workbench, /missing_apply/);
});

test("F: reanalyzeAfterMissingAccountApply pipelinePatch counters", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `r${i}`,
    hesapKodu: i < 12 ? "102.01.037" : "",
    riskDurumu: "",
    borc: 1,
    alacak: 0,
  }));
  const re = reanalyzeAfterMissingAccountApply({
    lucaRows: rows,
    companyId: "c1",
    skipMemoryPass: true,
  });
  assert.equal(re.pipelinePatch.missingCount, 0);
  assert.ok(re.pipelinePatch.autoMatchedCount >= 0);
  assert.equal(re.pipelinePatch.reanalyzedWithoutReload, true);
});

test("shouldStartMissingApplyReanalyzeJob guards", () => {
  assert.equal(
    shouldStartMissingApplyReanalyzeJob({
      companyMappingChanged: true,
      alreadyRunning: false,
      companyId: "c1",
      remainingMissingCount: 3,
    }),
    true
  );
  assert.equal(
    shouldStartMissingApplyReanalyzeJob({
      companyMappingChanged: true,
      alreadyRunning: false,
      companyId: "c1",
      remainingMissingCount: 0,
    }),
    false,
    "eksik 0 iken full reanalyze / Son kontroller yarışı başlatılmaz"
  );
  assert.equal(
    shouldStartMissingApplyReanalyzeJob({
      companyMappingChanged: true,
      alreadyRunning: true,
      companyId: "c1",
      remainingMissingCount: 3,
    }),
    false
  );
  assert.equal(
    shouldStartMissingApplyReanalyzeJob({
      companyMappingChanged: false,
      alreadyRunning: false,
      companyId: "c1",
      remainingMissingCount: 3,
    }),
    false
  );
});
