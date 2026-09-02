/**
 * Close-race + BANK_PRODUCT memory policy hotfix.
 * Run: node --import ./scripts/_alias-loader.mjs --test ./scripts/test-missing-apply-close-race.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergePipelineResultAfterMissingApply,
  buildFinalPipelineResultAfterMissingApply,
  shouldStartMissingApplyReanalyzeJob,
  shouldSkipCloseParentPatch,
  shouldPersistLegacyCariMemoryForGroup,
  buildMissingApplyUserMessage,
  shouldRestoreLastGoodMissingApplyResult,
  shouldAcceptMissingApplyParentSync,
} from "@/src/utils/missingAccountApplyParentSync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const PREV = {
  duplicate: true,
  movementCount: 12,
  lucaRowCount: 24,
  autoMatchedCount: 5,
  uniqueUnresolvedMovements: 7,
  missingCount: 7,
  reviewRequired: true,
  openingBalance: 0,
  statementClosingBalance: 0,
  totalDebit: 177879.3,
  totalCredit: 177879.3,
  reconciliationDelta: 0,
  driveArchived: true,
  fromCanonicalSnapshot: true,
  canAutoApprove: false,
};

test("A: apply finalize → close sync READY; no full reanalyze when missing=0", () => {
  const patch = {
    missingCount: 0,
    autoMatchedCount: 12,
    uniqueUnresolvedMovements: 0,
    unresolvedMovementCount: 0,
  };
  const final = buildFinalPipelineResultAfterMissingApply(PREV, {
    pipelinePatch: patch,
    lucaRowCount: 24,
    movementCount: 12,
    applyGeneration: 1,
  });
  assert.equal(final.autoMatchedCount, 12);
  assert.equal(final.uniqueUnresolvedMovements, 0);
  assert.equal(final.missingCount, 0);
  assert.equal(final.reviewRequired, false);
  assert.equal(final.canAutoApprove, true);
  assert.equal(final.missingApplyFinalized, true);
  assert.equal(final.openingBalance, 0);
  assert.equal(final.driveArchived, true);
  assert.equal(final.reconciliationDelta, 0);

  assert.equal(
    shouldStartMissingApplyReanalyzeJob({
      companyMappingChanged: true,
      alreadyRunning: false,
      companyId: "c1",
      remainingMissingCount: 0,
    }),
    false,
    "eksik 0 iken full pipeline başlatma"
  );
});

test("B: close while analysis running → skip hybrid patch", () => {
  assert.equal(
    shouldSkipCloseParentPatch({
      pipelineRunning: true,
      isReanalyzing: false,
    }),
    true
  );
  assert.equal(
    shouldSkipCloseParentPatch({
      pipelineRunning: false,
      isReanalyzing: true,
    }),
    true
  );
  assert.equal(
    shouldSkipCloseParentPatch({
      missingApplyOwnerActive: true,
    }),
    true
  );
  assert.equal(
    shouldSkipCloseParentPatch({
      pipelineRunning: false,
      isReanalyzing: false,
      missingApplyOwnerActive: false,
    }),
    false
  );
});

test("C: double close generation — stale sync rejected", () => {
  assert.equal(
    shouldAcceptMissingApplyParentSync({
      applyGeneration: 1,
      activeGeneration: 2,
    }),
    false
  );
  assert.equal(
    shouldAcceptMissingApplyParentSync({
      applyGeneration: 2,
      activeGeneration: 2,
    }),
    true
  );
});

test("D: contract completeness — balance + archive preserved", () => {
  const merged = mergePipelineResultAfterMissingApply(PREV, {
    pipelinePatch: {
      missingCount: 0,
      autoMatchedCount: 12,
      uniqueUnresolvedMovements: 0,
    },
    lucaRowCount: 24,
    movementCount: 12,
  });
  assert.equal(merged.movementCount, 12);
  assert.equal(merged.lucaRowCount, 24);
  assert.equal(merged.totalDebit, 177879.3);
  assert.equal(merged.totalCredit, 177879.3);
  assert.equal(merged.statementClosingBalance, 0);
  assert.equal(merged.fromCanonicalSnapshot, true);
  assert.equal(merged.duplicate, true);
});

test("E: BANK_PRODUCT_CURRENCY memory policy + success message", () => {
  assert.equal(
    shouldPersistLegacyCariMemoryForGroup({
      vadeliOnboardingStep: "STATEMENT_102",
      mappingScopeDefault: "BANK_PRODUCT_CURRENCY",
    }),
    false
  );
  assert.equal(
    shouldPersistLegacyCariMemoryForGroup({
      vadeliOnboardingStep: "STATEMENT_102",
    }),
    false
  );
  assert.equal(
    shouldPersistLegacyCariMemoryForGroup({
      vadeliOnboardingStep: "",
    }),
    true
  );

  const ok = buildMissingApplyUserMessage({
    updatedCount: 7,
    accountCode: "102.01.037",
    beforeMissing: 7,
    afterMissing: 0,
    isBankProductCurrency: true,
    productMappingSaved: true,
    legacyLearnFailed: true, // ignored for product scope
  });
  assert.equal(ok.tone, "success");
  assert.match(ok.message, /7 işlem 102\.01\.037/);
  assert.match(ok.message, /Eksik 7 → 0/);
  assert.match(ok.message, /ortak 102 kuralı firma için kaydedildi/);
  assert.doesNotMatch(ok.message, /hafızası kaydı başarısız/);

  const failMap = buildMissingApplyUserMessage({
    updatedCount: 7,
    accountCode: "102.01.037",
    beforeMissing: 7,
    afterMissing: 0,
    isBankProductCurrency: true,
    productMappingFailed: true,
  });
  assert.equal(failMap.tone, "warning");
  assert.match(failMap.message, /ortak hesap tercihi kaydedilemedi/);
});

test("F: production counter shape 12/0/0", () => {
  const final = buildFinalPipelineResultAfterMissingApply(PREV, {
    pipelinePatch: {
      missingCount: 0,
      autoMatchedCount: 12,
      uniqueUnresolvedMovements: 0,
      unresolvedMovementCount: 0,
    },
    movementCount: 12,
    lucaRowCount: 24,
  });
  assert.equal(final.movementCount, 12);
  assert.equal(final.autoMatchedCount, 12);
  assert.equal(final.uniqueUnresolvedMovements, 0);
  assert.equal(final.missingCount, 0);
  assert.equal(final.reconciliationDelta, 0);
});

test("G: missing_apply failure restores last good", () => {
  assert.equal(
    shouldRestoreLastGoodMissingApplyResult({
      reason: "missing_apply",
      hasLastGood: true,
    }),
    true
  );
  assert.equal(
    shouldRestoreLastGoodMissingApplyResult({
      reason: "manual",
      hasLastGood: true,
    }),
    false
  );
});

test("wiring: workbench close-race guards", () => {
  const src = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(src, /shouldSkipCloseParentPatch/);
  assert.match(src, /buildFinalPipelineResultAfterMissingApply/);
  assert.match(src, /shouldPersistLegacyCariMemoryForGroup/);
  assert.match(src, /buildMissingApplyUserMessage/);
  assert.match(src, /lastGoodMissingApplyResultRef/);
  assert.match(src, /remainingMissingCount/);
  assert.match(src, /finalizeReady/);
});
