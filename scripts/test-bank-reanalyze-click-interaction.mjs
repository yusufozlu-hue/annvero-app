/**
 * Interaction + unit tests for "Yeni hesap planıyla yeniden analiz et" click path.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-reanalyze-click-interaction.mjs
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
  claimReanalyzeClick,
  releaseReanalyzeClick,
  REANALYZE_CLICK_BUSY_TOAST,
} = await import("../src/utils/bankReanalyzeClick.js");

const { runReanalyzeButtonClick } = await import(
  "../src/components/BankReanalyzeWithNewPlanButton.js"
);

await test("claimReanalyzeClick: loading is first sync step before busy check", () => {
  const lockRef = { current: false };
  let loading = false;
  const setIsReanalyzing = (v) => {
    loading = v;
  };
  const claim = claimReanalyzeClick({
    lockRef,
    isReanalyzing: false,
    isJobBusy: true,
    pipelineRunning: false,
    setIsReanalyzing,
  });
  assert.equal(loading, true, "loading must flip true synchronously");
  assert.equal(lockRef.current, true);
  assert.equal(claim.ok, false);
  assert.equal(claim.reason, "job_busy");
  releaseReanalyzeClick({ lockRef, setIsReanalyzing });
  assert.equal(loading, false);
  assert.equal(lockRef.current, false);
});

await test("claimReanalyzeClick: second claim is in_flight (single flight)", () => {
  const lockRef = { current: false };
  let loading = false;
  const setIsReanalyzing = (v) => {
    loading = v;
  };
  const first = claimReanalyzeClick({
    lockRef,
    isReanalyzing: false,
    isJobBusy: false,
    setIsReanalyzing,
  });
  assert.equal(first.ok, true);
  assert.equal(loading, true);
  const second = claimReanalyzeClick({
    lockRef,
    isReanalyzing: true,
    isJobBusy: false,
    setIsReanalyzing,
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "in_flight");
  releaseReanalyzeClick({ lockRef, setIsReanalyzing });
});

await test("claimReanalyzeClick: heals orphan lock when UI idle", () => {
  const lockRef = { current: true };
  let loading = false;
  const setIsReanalyzing = (v) => {
    loading = v;
  };
  const claim = claimReanalyzeClick({
    lockRef,
    isReanalyzing: false,
    isJobBusy: false,
    pipelineRunning: false,
    setIsReanalyzing,
  });
  assert.equal(claim.ok, true);
  assert.equal(claim.healedOrphanLock, true);
  assert.equal(loading, true);
  assert.ok(REANALYZE_CLICK_BUSY_TOAST.length > 10);
  releaseReanalyzeClick({ lockRef, setIsReanalyzing });
});

await test("source wiring: card + workbench + no premature isReanalyzing clear", () => {
  const oneClick = fs.readFileSync(
    path.join(
      rootDir,
      "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
    ),
    "utf8"
  );
  const workbench = fs.readFileSync(
    path.join(
      rootDir,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  const buttonSrc = fs.readFileSync(
    path.join(rootDir, "src/components/BankReanalyzeWithNewPlanButton.js"),
    "utf8"
  );
  assert.match(oneClick, /BankReanalyzeWithNewPlanButton/);
  assert.match(workbench, /claimReanalyzeClick/);
  assert.match(workbench, /releaseReanalyzeClick/);
  assert.match(workbench, /Reanalyze kilidi handleReanalyzeWithNewPlan/);
  assert.match(buttonSrc, /runReanalyzeButtonClick/);
  assert.match(buttonSrc, /setLocalReanalyzeBusy\(true\)/);
  assert.ok(
    !/setPipelineResult\(result\);\s*\n\s*setPipelinePhaseSafe\(PIPELINE_PHASES\.READY_FOR_EXPORT\);\s*\n\s*reanalyzeOptionsRef\.current = null;\s*\n\s*setIsReanalyzing\(false\);/.test(
      workbench
    ),
    "must not clear isReanalyzing before pipeline finally"
  );
});

/**
 * Gerçek buton click handler + parent claim zinciri (React mount gerekmez).
 * Aynı tick: local busy; callback 1 kez; ikinci click yeni istek yok; success/error.
 */
await test("interaction: click → same-tick loading, one callback, double-click blocked", async () => {
  let localBusy = false;
  let parentBusy = false;
  const lockRef = { current: false };
  let calls = 0;
  let release;
  const gate = new Promise((r) => {
    release = r;
  });

  const parentHandler = async () => {
    const claim = claimReanalyzeClick({
      lockRef,
      isReanalyzing: parentBusy,
      isJobBusy: false,
      setIsReanalyzing: (v) => {
        parentBusy = v;
      },
    });
    if (!claim.ok) return;
    try {
      calls += 1;
      await gate;
    } finally {
      releaseReanalyzeClick({
        lockRef,
        setIsReanalyzing: (v) => {
          parentBusy = v;
        },
      });
    }
  };

  const uiBusy = () => localBusy || parentBusy;

  const first = runReanalyzeButtonClick({
    reanalyzeBusy: uiBusy(),
    isExporting: false,
    setLocalReanalyzeBusy: (v) => {
      localBusy = v;
    },
    onReanalyzeWithNewPlan: parentHandler,
    event: { preventDefault() {}, stopPropagation() {} },
  });

  // Aynı tick: local busy set BEFORE await
  assert.equal(localBusy, true, "local loading same tick");
  assert.equal(parentBusy, true, "parent loading same tick");
  assert.equal(first.started, true);
  assert.equal(calls, 1);

  // İkinci tıklama — disabled/busy path
  const second = runReanalyzeButtonClick({
    reanalyzeBusy: uiBusy(),
    isExporting: false,
    setLocalReanalyzeBusy: (v) => {
      localBusy = v;
    },
    onReanalyzeWithNewPlan: parentHandler,
    event: { preventDefault() {}, stopPropagation() {} },
  });
  assert.equal(second.started, false);
  assert.equal(calls, 1, "second click must not start new request");

  release();
  await first.promise;
  assert.equal(parentBusy, false);
});

await test("interaction: error clears loading", async () => {
  let localBusy = false;
  let parentBusy = false;
  const lockRef = { current: false };
  let errMsg = "";

  const parentHandler = async () => {
    const claim = claimReanalyzeClick({
      lockRef,
      isReanalyzing: parentBusy,
      isJobBusy: false,
      setIsReanalyzing: (v) => {
        parentBusy = v;
      },
    });
    if (!claim.ok) return;
    try {
      throw new Error("plan yüklenemedi");
    } catch (err) {
      errMsg = err.message;
      throw err;
    } finally {
      releaseReanalyzeClick({
        lockRef,
        setIsReanalyzing: (v) => {
          parentBusy = v;
        },
      });
    }
  };

  const result = runReanalyzeButtonClick({
    reanalyzeBusy: false,
    isExporting: false,
    setLocalReanalyzeBusy: (v) => {
      localBusy = v;
    },
    onReanalyzeWithNewPlan: parentHandler,
    event: { preventDefault() {}, stopPropagation() {} },
  });
  assert.equal(localBusy, true);
  await result.promise.catch(() => {});
  assert.equal(errMsg, "plan yüklenemedi");
  assert.equal(parentBusy, false);
  assert.equal(localBusy, false, "local busy cleared after rejection");
});

await test("interaction: success clears loading", async () => {
  let localBusy = false;
  let parentBusy = false;
  const lockRef = { current: false };
  let ok = false;

  const parentHandler = async () => {
    claimReanalyzeClick({
      lockRef,
      isReanalyzing: false,
      isJobBusy: false,
      setIsReanalyzing: (v) => {
        parentBusy = v;
      },
    });
    try {
      ok = true;
    } finally {
      releaseReanalyzeClick({
        lockRef,
        setIsReanalyzing: (v) => {
          parentBusy = v;
        },
      });
    }
  };

  const result = runReanalyzeButtonClick({
    reanalyzeBusy: false,
    isExporting: false,
    setLocalReanalyzeBusy: (v) => {
      localBusy = v;
    },
    onReanalyzeWithNewPlan: parentHandler,
    event: { preventDefault() {}, stopPropagation() {} },
  });
  await result.promise;
  assert.equal(ok, true);
  assert.equal(parentBusy, false);
  assert.equal(localBusy, false);
});

await test("interaction: orphan lock heal then single request", async () => {
  const lockRef = { current: true };
  let parentBusy = false;
  let calls = 0;
  const claim = claimReanalyzeClick({
    lockRef,
    isReanalyzing: false,
    isJobBusy: false,
    pipelineRunning: false,
    setIsReanalyzing: (v) => {
      parentBusy = v;
    },
  });
  assert.equal(claim.ok, true);
  assert.equal(claim.healedOrphanLock, true);
  calls += 1;
  assert.equal(calls, 1);
  assert.equal(parentBusy, true);
  releaseReanalyzeClick({
    lockRef,
    setIsReanalyzing: (v) => {
      parentBusy = v;
    },
  });
});

console.log("\nAll bank-reanalyze-click interaction tests finished.");
