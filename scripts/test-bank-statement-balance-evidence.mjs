/**
 * Statement balance evidence — canonical persist/hydrate + recovery binding.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-statement-balance-evidence.mjs
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

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${error.message}`);
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  BALANCE_EVIDENCE_MISSING,
  BALANCE_MATCHED,
  normalizeBankBalanceForOutputGate,
  reconcileStatementBalances,
  resolveBalanceInputForOutputGate,
} = await import("@/src/utils/bankBalanceReconcile.js");

const {
  STATEMENT_BALANCE_EVIDENCE_KEY,
  balanceEvidenceToReconcileHints,
  buildStatementBalanceEvidenceFromReconcile,
  extractStatementBalanceEvidenceFromSafeSummary,
  mergeStatementBalanceEvidenceIntoSafeSummary,
  recoverStatementBalanceEvidence,
  sanitizeStatementBalanceEvidence,
} = await import("@/src/utils/bankStatementBalanceEvidence.js");

const {
  buildSnapshotMovementsFromRows,
  sanitizeIncomingSnapshotBody,
  snapshotMovementsToLegacyRows,
} = await import("@/src/utils/bankCanonicalSnapshot.js");

const { buildParserOnlyMovement } = await import(
  "@/src/utils/bankMovementMapper.js"
);

const { evaluateBankOutputGate } = await import(
  "@/src/utils/bankOneClickPipeline.js"
);

const { buildV1ResultSummary } = await import(
  "@/src/utils/annveroV1Orchestration.js"
);
const { buildSafeV1PersistPayload } = await import(
  "@/src/utils/annveroV1SafePersist.js"
);

const mareRows = () => [
  {
    date: "2025-01-02",
    description: "VADELI",
    amount: 1018500,
    direction: "GIRIS",
    bakiye: 1018500,
    balance: 1018500,
  },
  {
    date: "2025-01-03",
    description: "FAIZ",
    amount: 33931.4,
    direction: "GIRIS",
    bakiye: 1052431.4,
    balance: 1052431.4,
  },
  {
    date: "2025-01-03",
    description: "STOPAJ",
    amount: -5938,
    direction: "CIKIS",
    bakiye: 1046493.4,
    balance: 1046493.4,
  },
  {
    date: "2025-01-03",
    description: "KAPANIS",
    amount: -1046493.4,
    direction: "CIKIS",
    bakiye: 0,
    balance: 0,
  },
];

test("zero opening/closing preserved (null ≠ 0)", () => {
  const reconciled = reconcileStatementBalances(mareRows(), {
    openingBalance: 0,
    closingBalance: 0,
  });
  assert.equal(reconciled.code, BALANCE_MATCHED);
  assert.equal(reconciled.openingBalance, 0);
  assert.equal(reconciled.closingBalance, 0);
  assert.equal(reconciled.delta, 0);

  const evidence = buildStatementBalanceEvidenceFromReconcile(reconciled, {
    contentHash: "abc",
  });
  assert.ok(evidence);
  assert.equal(evidence.openingBalance, 0);
  assert.equal(evidence.closingBalance, 0);

  const roundTrip = sanitizeStatementBalanceEvidence(
    JSON.parse(JSON.stringify(evidence))
  );
  assert.equal(roundTrip.openingBalance, 0);
  assert.equal(roundTrip.closingBalance, 0);

  const nullish = buildStatementBalanceEvidenceFromReconcile({
    code: BALANCE_MATCHED,
    matched: true,
    openingBalance: null,
    closingBalance: null,
    delta: 0,
  });
  assert.equal(nullish, null);
});

test("canonical safeSummary serialize/hydrate keeps zeros", () => {
  const reconciled = reconcileStatementBalances(mareRows(), {
    openingBalance: 0,
    closingBalance: 0,
  });
  const evidence = buildStatementBalanceEvidenceFromReconcile(reconciled, {
    contentHash: "hash-mare",
  });
  const safe = mergeStatementBalanceEvidenceIntoSafeSummary(
    { movementCount: 4, parseMode: "pdf" },
    evidence
  );
  const body = sanitizeIncomingSnapshotBody({
    companyId: "84384297-270c-47cd-ac5a-d693ba80b84a",
    contentHash: "hash-mare",
    fileName: "00158018033466201.pdf",
    sourceType: "pdf",
    movements: buildSnapshotMovementsFromRows(mareRows()),
    safeSummary: safe,
  });
  const stored = body.source.safe_summary[STATEMENT_BALANCE_EVIDENCE_KEY];
  assert.equal(stored.openingBalance, 0);
  assert.equal(stored.closingBalance, 0);
  assert.equal(stored.code, BALANCE_MATCHED);

  const extracted = extractStatementBalanceEvidenceFromSafeSummary(
    body.source.safe_summary
  );
  assert.equal(extracted.openingBalance, 0);
  assert.equal(extracted.closingBalance, 0);

  const legacy = snapshotMovementsToLegacyRows(
    body.movements.map((m, i) => ({ ...m, sort_index: i }))
  );
  const hydrate = reconcileStatementBalances(
    legacy,
    balanceEvidenceToReconcileHints(extracted)
  );
  assert.equal(hydrate.code, BALANCE_MATCHED);
  assert.equal(hydrate.openingBalance, 0);
  assert.equal(hydrate.closingBalance, 0);

  const gateIn = resolveBalanceInputForOutputGate({
    balanceResult: hydrate,
    parsingStage: {
      balanceCode: hydrate.code,
      balanceMatched: true,
      balanceDelta: hydrate.delta,
      openingBalance: hydrate.openingBalance,
      closingBalance: hydrate.closingBalance,
    },
  });
  assert.equal(gateIn.balanceCode, BALANCE_MATCHED);
  const gate = evaluateBankOutputGate(
    {
      ...gateIn,
      canAutoApprove: true,
      reviewRequired: false,
      errors: 0,
      uniqueUnresolvedMovements: 0,
    },
    { lucaReady: true }
  );
  assert.equal(gate.allowed, true);
  assert.equal(gate.code, "OUTPUT_READY");
});

test("legacy snapshot without evidence → BALANCE_EVIDENCE_MISSING", () => {
  const rowsNoBal = mareRows().map((row) => {
    const copy = { ...row };
    delete copy.bakiye;
    delete copy.balance;
    return copy;
  });
  const hydrate = reconcileStatementBalances(rowsNoBal, {});
  assert.equal(hydrate.code, BALANCE_EVIDENCE_MISSING);
  const norm = normalizeBankBalanceForOutputGate({
    balanceCode: hydrate.code,
    balanceMatched: false,
    delta: hydrate.delta,
    openingBalance: hydrate.openingBalance,
    closingBalance: hydrate.closingBalance,
  });
  assert.equal(norm.balanceCode, BALANCE_EVIDENCE_MISSING);
  const gate = evaluateBankOutputGate(
    {
      ...norm,
      canAutoApprove: true,
      reviewRequired: false,
      errors: 0,
      uniqueUnresolvedMovements: 0,
    },
    { lucaReady: true }
  );
  assert.equal(gate.allowed, false);
  assert.equal(gate.code, "BALANCE_NOT_MATCHED");
});

test("4/4 alone does not open gate without balance evidence", () => {
  const gate = evaluateBankOutputGate(
    {
      balanceCode: BALANCE_EVIDENCE_MISSING,
      balanceMatched: false,
      canAutoApprove: true,
      reviewRequired: false,
      errors: 0,
      uniqueUnresolvedMovements: 0,
      // accounting 4/4 is not a gate input — only uniqueUnresolved=0
    },
    { lucaReady: true }
  );
  assert.equal(gate.allowed, false);
});

test("recovery accepts same-source metadata; rejects wrong hash/revision", () => {
  const evidence = buildStatementBalanceEvidenceFromReconcile(
    reconcileStatementBalances(mareRows(), {
      openingBalance: 0,
      closingBalance: 0,
    }),
    { contentHash: "h1" }
  );
  const ok = recoverStatementBalanceEvidence({
    expectedBinding: {
      companyId: "c1",
      sourceId: "s1",
      contentHash: "h1",
      revision: 14,
    },
    candidateBinding: {
      companyId: "c1",
      sourceId: "s1",
      contentHash: "h1",
      revision: 14,
    },
    candidateEvidence: evidence,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.evidence.openingBalance, 0);

  const badHash = recoverStatementBalanceEvidence({
    expectedBinding: {
      companyId: "c1",
      sourceId: "s1",
      contentHash: "h1",
      revision: 14,
    },
    candidateBinding: {
      companyId: "c1",
      sourceId: "s1",
      contentHash: "OTHER",
      revision: 14,
    },
    candidateEvidence: evidence,
  });
  assert.equal(badHash.ok, false);
  assert.equal(badHash.code, "CONTENT_HASH_MISMATCH");

  const badRev = recoverStatementBalanceEvidence({
    expectedBinding: {
      companyId: "c1",
      sourceId: "s1",
      contentHash: "h1",
      revision: 14,
    },
    candidateBinding: {
      companyId: "c1",
      sourceId: "s1",
      contentHash: "h1",
      revision: 99,
    },
    candidateEvidence: evidence,
  });
  assert.equal(badRev.ok, false);
  assert.equal(badRev.code, "REVISION_MISMATCH");
});

test("parser-only movement keeps zero balance for snapshot", () => {
  const mov = buildParserOnlyMovement(
    { aciklama: "x", tutar: 10, yon: "CIKIS", tarih: "01.01.2025", bakiye: 0 },
    {},
    0
  );
  assert.equal(mov.bakiye, 0);
  assert.equal(mov.balance, 0);
  const snap = buildSnapshotMovementsFromRows([mov]);
  assert.equal(snap[0].balance, 0);
});

test("V1 summary + safe persist keep opening/closing 0", () => {
  const summary = buildV1ResultSummary({
    movementCount: 4,
    balanceCode: BALANCE_MATCHED,
    balanceMismatch: false,
    openingBalance: 0,
    closingBalance: 0,
    balanceDelta: 0,
    expectedClosing: 0,
    balanceEvidenceSource: "running_balance",
    contentHash: "h",
  });
  assert.equal(summary.openingBalance, 0);
  assert.equal(summary.closingBalance, 0);
  const payload = buildSafeV1PersistPayload({
    companyId: "c1",
    jobId: "j1",
    idempotencyKey: "k",
    summary,
  });
  assert.equal(payload.metadata.opening_balance, 0);
  assert.equal(payload.metadata.closing_balance, 0);
  assert.equal(payload.metadata.balance_code, BALANCE_MATCHED);
});

test("null balances are not coerced to 0 in V1 persist", () => {
  const summary = buildV1ResultSummary({
    movementCount: 4,
    balanceCode: BALANCE_EVIDENCE_MISSING,
    openingBalance: null,
    closingBalance: null,
  });
  assert.equal(summary.openingBalance, null);
  const payload = buildSafeV1PersistPayload({
    companyId: "c1",
    jobId: "j1",
    idempotencyKey: "k",
    summary,
  });
  assert.equal(payload.metadata.opening_balance, undefined);
  assert.equal(payload.metadata.closing_balance, undefined);
});

await testAsync("real MARE PDF parse → evidence 0/0 (if fixture present)", async () => {
  const candidates = [
    process.env.ANNVERO_REAL_PDF_PATH,
    path.join(
      process.env.USERPROFILE || "",
      "Desktop",
      "Aysu Masaüstü",
      "00158018033466201.pdf"
    ),
    path.join(
      process.env.USERPROFILE || "",
      "Desktop",
      "00158018033466201.pdf"
    ),
  ].filter(Boolean);
  const pdfPath = candidates.find((p) => fs.existsSync(p));
  if (!pdfPath) {
    console.log("SKIP  real MARE PDF fixture not found on disk");
    return;
  }
  const { parseBankStatementPdf } = await import(
    "@/src/utils/bankStatementPdf.js"
  );
  const buf = fs.readFileSync(pdfPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = await parseBankStatementPdf(ab, {
    selectedBank: "VAKIFBANK",
    companyId: "84384297-270c-47cd-ac5a-d693ba80b84a",
  });
  assert.equal(parsed.balance?.code, BALANCE_MATCHED);
  assert.equal(parsed.balance?.openingBalance, 0);
  assert.equal(parsed.balance?.closingBalance, 0);
  assert.equal(parsed.balance?.delta, 0);

  const evidence = buildStatementBalanceEvidenceFromReconcile(parsed.balance, {
    contentHash: "fixture",
  });
  assert.ok(evidence);
  assert.equal(evidence.openingBalance, 0);
  assert.equal(evidence.closingBalance, 0);

  // PDF ≡ hydrate via evidence
  const previewMovements = (parsed.transactions || []).map((row, i) =>
    buildParserOnlyMovement(row, { selectedBank: "VAKIFBANK" }, i)
  );
  const snapMovements = buildSnapshotMovementsFromRows(previewMovements);
  assert.ok(snapMovements.every((m) => m.balance != null));
  const legacy = snapshotMovementsToLegacyRows(
    snapMovements.map((m, i) => ({ ...m, sort_index: i }))
  );
  const hydrate = reconcileStatementBalances(
    legacy,
    balanceEvidenceToReconcileHints(evidence)
  );
  assert.equal(hydrate.code, BALANCE_MATCHED);
  assert.equal(hydrate.openingBalance, parsed.balance.openingBalance);
  assert.equal(hydrate.closingBalance, parsed.balance.closingBalance);

  const pdfGate = resolveBalanceInputForOutputGate({
    balanceResult: parsed.balance,
  });
  const hydrateGate = resolveBalanceInputForOutputGate({
    balanceResult: hydrate,
  });
  assert.equal(pdfGate.balanceCode, hydrateGate.balanceCode);
  assert.equal(pdfGate.balanceMatched, hydrateGate.balanceMatched);
});

// Workbench wiring smoke
test("BankParserWorkbench wires statement balance evidence helpers", () => {
  const src = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(src, /mergeStatementBalanceEvidenceIntoSafeSummary/);
  assert.match(src, /extractStatementBalanceEvidenceFromSafeSummary/);
  assert.match(src, /balanceEvidenceToReconcileHints/);
  assert.match(src, /recoverStatementBalanceEvidence/);
  assert.match(src, /canonicalBalanceEvidenceRef/);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll statement balance evidence checks passed.");
