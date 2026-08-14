/**
 * Single-flight reanalyze orchestration: hydrate+manual race, Strict Mode,
 * triple click, 409 follow, success binding, error+retry, unmount/remount.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-reanalyze-orchestration.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out
        .then(() => console.log(`PASS  ${name}`))
        .catch((err) => {
          console.error(`FAIL  ${name}`);
          console.error(err);
          process.exitCode = 1;
        });
    }
    console.log(`PASS  ${name}`);
    return Promise.resolve();
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
    return Promise.resolve();
  }
}

const {
  buildReanalyzeFlightKey,
  attachReanalyzeFlightPromise,
  completeReanalyzeFlight,
  failReanalyzeFlight,
  claimReanalyzeClick,
  releaseReanalyzeClick,
  armCanonicalHydrateReanalyze,
  consumeCanonicalHydrateReanalyze,
  resolveReanalyzeButtonMode,
  shouldFollowExistingJobOnConflict,
  __resetReanalyzeOrchestrationForTests,
} = await import("../src/utils/bankReanalyzeOrchestration.js");

const { buildRevisionIdempotencyKey } = await import(
  "../src/utils/bankStatementReanalyze.js"
);

const { runReanalyzeButtonClick } = await import(
  "../src/components/BankReanalyzeWithNewPlanButton.js"
);

await test("flight key includes source+revision+plan", () => {
  __resetReanalyzeOrchestrationForTests();
  const a = buildReanalyzeFlightKey({
    companyId: "c1",
    sourceId: "s1",
    sourceRevision: 1,
    planFingerprint: "pfpA",
  });
  const b = buildReanalyzeFlightKey({
    companyId: "c1",
    sourceId: "s1",
    sourceRevision: 1,
    planFingerprint: "pfpB",
  });
  assert.notEqual(a, b);
  assert.match(a, /c1\|s1\|1\|pfpA/);
});

await test("hydrate consume is single-use (Strict Mode double effect)", () => {
  __resetReanalyzeOrchestrationForTests();
  const key = buildReanalyzeFlightKey({
    companyId: "c",
    sourceId: "s",
    sourceRevision: 1,
    planFingerprint: "p",
  });
  const arm1 = armCanonicalHydrateReanalyze(key);
  assert.equal(arm1.armed, true);
  assert.equal(consumeCanonicalHydrateReanalyze(key), true);
  assert.equal(consumeCanonicalHydrateReanalyze(key), false, "second effect");
  const arm2 = armCanonicalHydrateReanalyze(key);
  assert.equal(arm2.armed, false);
  assert.equal(arm2.alreadyConsumed, true);
});

await test("auto hydrate + manual click race → one start, one join", async () => {
  __resetReanalyzeOrchestrationForTests();
  const key = buildReanalyzeFlightKey({
    companyId: "c",
    sourceId: "s",
    sourceRevision: 1,
    planFingerprint: "p",
  });
  let starts = 0;
  let jobsPosted = 0;

  const startOnce = async (reason) => {
    const lockRef = { current: false };
    let loading = false;
    const claim = claimReanalyzeClick({
      lockRef,
      isReanalyzing: false,
      isJobBusy: false,
      setIsReanalyzing: (v) => {
        loading = v;
      },
      flightKey: key,
      owner: reason,
    });
    if (!claim.ok) {
      if (claim.reason === "join_in_flight" && claim.flight?.promise) {
        await claim.flight.promise;
        return { joined: true, loading };
      }
      return { joined: false, ok: false, reason: claim.reason };
    }
    starts += 1;
    const run = (async () => {
      jobsPosted += 1;
      await new Promise((r) => setTimeout(r, 20));
      completeReanalyzeFlight(key, { ok: true });
      releaseReanalyzeClick({
        lockRef,
        setIsReanalyzing: (v) => {
          loading = v;
        },
      });
    })();
    attachReanalyzeFlightPromise(key, run);
    await run;
    return { started: true, loading: false };
  };

  const [hydrate, manual] = await Promise.all([
    startOnce("hydrate"),
    startOnce("manual"),
  ]);
  assert.equal(starts, 1, "exactly one owner");
  assert.equal(jobsPosted, 1, "POST jobs analog = 1");
  assert.ok(hydrate.started || manual.started);
  assert.ok(hydrate.joined || manual.joined);
});

await test("triple fast click → one flight", async () => {
  __resetReanalyzeOrchestrationForTests();
  const key = "c|s|1|p";
  let calls = 0;
  let releaseGate;
  const gate = new Promise((r) => {
    releaseGate = r;
  });
  const lockRef = { current: false };
  let parentBusy = false;

  const parent = async () => {
    const claim = claimReanalyzeClick({
      lockRef,
      isReanalyzing: parentBusy,
      isJobBusy: false,
      setIsReanalyzing: (v) => {
        parentBusy = v;
      },
      flightKey: key,
    });
    if (!claim.ok) {
      if (claim.reason === "join_in_flight" && claim.flight?.promise) {
        await claim.flight.promise;
      }
      return;
    }
    calls += 1;
    const run = (async () => {
      await gate;
      completeReanalyzeFlight(key);
      releaseReanalyzeClick({
        lockRef,
        setIsReanalyzing: (v) => {
          parentBusy = v;
        },
      });
    })();
    attachReanalyzeFlightPromise(key, run);
    await run;
  };

  let localBusy = false;
  const click = () =>
    runReanalyzeButtonClick({
      reanalyzeBusy: localBusy || parentBusy,
      isExporting: false,
      setLocalReanalyzeBusy: (v) => {
        localBusy = v;
      },
      onReanalyzeWithNewPlan: parent,
      event: { preventDefault() {}, stopPropagation() {} },
      allowStart: true,
    });

  const a = click();
  const b = click();
  const c = click();
  assert.equal(a.started, true);
  assert.equal(b.started, false);
  assert.equal(c.started, false);
  assert.equal(calls, 1);
  releaseGate();
  await a.promise;
});

await test("409 existing-job follow helper", () => {
  assert.equal(
    shouldFollowExistingJobOnConflict({
      status: 409,
      code: "COMPANY_JOB_ACTIVE",
    }),
    true
  );
  assert.equal(
    shouldFollowExistingJobOnConflict({ message: "zaten aktif bir işlem var" }),
    true
  );
  assert.equal(shouldFollowExistingJobOnConflict({ status: 500 }), false);
});

await test("button modes: loading / retry / hidden after success", () => {
  assert.equal(
    resolveReanalyzeButtonMode({
      hasResultSurface: true,
      isReanalyzing: true,
      fromCanonicalSnapshot: true,
    }),
    "loading"
  );
  assert.equal(
    resolveReanalyzeButtonMode({
      hasResultSurface: true,
      reanalyzeFailed: true,
    }),
    "retry"
  );
  assert.equal(
    resolveReanalyzeButtonMode({
      hasResultSurface: true,
      fromCanonicalSnapshot: true,
      isReanalyzing: false,
      reanalyzeFailed: false,
    }),
    "hidden",
    "success hydrate must not invite manual click"
  );
  assert.equal(
    resolveReanalyzeButtonMode({
      hasResultSurface: true,
      isDuplicate: true,
    }),
    "ready"
  );
});

await test("error + retry releases lock and allows second start", async () => {
  __resetReanalyzeOrchestrationForTests();
  const key = "c|s|1|retry";
  const lockRef = { current: false };
  let busy = false;
  const first = claimReanalyzeClick({
    lockRef,
    isReanalyzing: false,
    isJobBusy: false,
    setIsReanalyzing: (v) => {
      busy = v;
    },
    flightKey: key,
  });
  assert.equal(first.ok, true);
  failReanalyzeFlight(key, { failed: true });
  releaseReanalyzeClick({
    lockRef,
    setIsReanalyzing: (v) => {
      busy = v;
    },
  });
  assert.equal(busy, false);
  assert.equal(lockRef.current, false);
  const second = claimReanalyzeClick({
    lockRef,
    isReanalyzing: false,
    isJobBusy: false,
    setIsReanalyzing: (v) => {
      busy = v;
    },
    flightKey: key,
  });
  assert.equal(second.ok, true, "retry after fail must start");
  releaseReanalyzeClick({
    lockRef,
    setIsReanalyzing: (v) => {
      busy = v;
    },
  });
  completeReanalyzeFlight(key);
});

await test("unmount/remount: module flight survives (no second start)", async () => {
  __resetReanalyzeOrchestrationForTests();
  const key = "c|s|1|persist";
  let releaseGate;
  const gate = new Promise((r) => {
    releaseGate = r;
  });
  const lockA = { current: false };
  const claimA = claimReanalyzeClick({
    lockRef: lockA,
    isReanalyzing: false,
    isJobBusy: false,
    setIsReanalyzing: () => {},
    flightKey: key,
  });
  assert.equal(claimA.ok, true);
  const run = (async () => {
    await gate;
    completeReanalyzeFlight(key);
  })();
  attachReanalyzeFlightPromise(key, run);

  // remount: new lockRef, same module map
  const lockB = { current: false };
  const claimB = claimReanalyzeClick({
    lockRef: lockB,
    isReanalyzing: false,
    isJobBusy: false,
    setIsReanalyzing: () => {},
    flightKey: key,
  });
  assert.equal(claimB.ok, false);
  assert.equal(claimB.reason, "join_in_flight");
  releaseGate();
  await claimB.flight.promise;
});

await test("revision idempotency key includes plan + pipeline version", () => {
  const k = buildRevisionIdempotencyKey({
    companyId: "c",
    contentHash: "h",
    revision: 2,
    planFingerprint: "abc123",
    sourceId: "src1",
    sourceRevision: 14,
    snapshotFingerprint: "h",
  });
  assert.match(k, /:rev:2:plan:abc123/);
  assert.match(k, /:pipe:/);
  assert.match(k, /:src:src1/);
  assert.match(k, /:srev:14/);
  assert.match(k, /:snap:h/);

  const stale = buildRevisionIdempotencyKey({
    companyId: "c",
    contentHash: "h",
    revision: 2,
    planFingerprint: "abc123",
    pipelineVersion: "br/0.0.1+vl/0.0.1",
  });
  assert.notEqual(k, stale);
});

await test("source wiring: workbench uses orchestration + preserve card", () => {
  const workbench = fs.readFileSync(
    path.join(
      rootDir,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  const jobsRoute = fs.readFileSync(
    path.join(rootDir, "app/api/annvero-v1/jobs/route.js"),
    "utf8"
  );
  assert.match(workbench, /consumeCanonicalHydrateReanalyze/);
  assert.match(workbench, /attachReanalyzeFlightPromise/);
  assert.match(workbench, /shouldFollowExistingJobOnConflict/);
  assert.match(workbench, /planFingerprint/);
  assert.match(workbench, /ANNVERO_BANK_REANALYZE_PIPELINE_VERSION/);
  assert.match(workbench, /isCompatibleExistingReanalyzeJob/);
  assert.match(workbench, /isHydrateJobResultStale/);
  assert.match(workbench, /staleExistingJob/);
  assert.match(workbench, /persistAuditWarning/);
  assert.match(
    workbench,
    /Reanalyze \/ snapshot: kart ve dosya bilgisi pipeline bitene kadar korunur/
  );
  assert.match(workbench, /Reanalyze kilidi handleReanalyzeWithNewPlan/);
  assert.match(jobsRoute, /existingJob:\s*true/);
  assert.match(jobsRoute, /compatibleExistingJob/);
  assert.match(jobsRoute, /evaluateV1PersistIdempotencyDecision/);
  assert.match(jobsRoute, /SOURCE_NOT_IN_COMPANY/);
  assert.match(jobsRoute, /idempotency_key/);
  assert.doesNotMatch(jobsRoute, /force\s*[:=]\s*true/);
});

console.log("\nAll bank-reanalyze-orchestration tests finished.");
