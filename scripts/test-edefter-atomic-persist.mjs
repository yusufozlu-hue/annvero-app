/**
 * E-Defter atomic persist — A–L matrix + legacy FAIL proof + perf.
 * Run:
 *   node --import ./scripts/_alias-loader.mjs ./scripts/test-edefter-atomic-persist.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildEdefterPersistIdempotencyKey,
  callEdefterAtomicPersistRpc,
  EDEFTER_ATOMIC_PERSIST_RPC,
  EDEFTER_ATOMIC_PERSIST_UI_ERROR,
  legacyMultiStepPersistSpy,
  measureFindingsPayload,
  simulateAtomicPersistTransaction,
} from "@/src/utils/eDefterAtomicPersist.js";
import {
  assertEdefterPersistIdentityGate,
  EDEFTER_IDENTITY_STATUS,
  EDEFTER_TEST_ONLY_IDENTITIES as ID,
  IDENTITY_CONFIRMATION,
} from "@/src/utils/eDefterCompanyIdentityGate.js";

const root = process.cwd();
const stats = {
  legacyLeftoverRuns: 0,
  atomicSuccess: 0,
  atomicRollback: 0,
  rpcCalls: 0,
  identityBlocked: 0,
};

function synthRun(over = {}) {
  return {
    company_id: "co-a",
    period: "2026/05",
    status: "completed",
    engine_version: "3.1.0-test",
    source_fingerprint: "fp-synth-a",
    journal_fingerprint: "j-a",
    ledger_fingerprint: "l-a",
    document_types: ["Muavin"],
    document_count: 1,
    row_count: 2,
    opening_balance_summary: {},
    closing_balance_summary: {},
    reconciliation_status: "skipped",
    reconciliation_summary: {},
    severity_counts: { critical: 0 },
    result_summary: {
      overall_sonuc: "Uygun",
      identity_status: EDEFTER_IDENTITY_STATUS.MATCHED,
      identity_verified: true,
      identity_user_confirmed: false,
      identity_confirmation: IDENTITY_CONFIRMATION.AUTO_MATCHED,
    },
    ...over,
  };
}

function synthFindings(n = 2) {
  return Array.from({ length: n }, (_, i) => ({
    code: `C${i}`,
    severity: "warning",
    category: "TEST",
    safe_reference: `r${i}`,
    summary: `anon ${i}`,
    occurrence_count: 1,
    resolution_status: "open",
  }));
}

console.log("0) OLD FAIL proof: findings fail leaves leftover run");
{
  const legacy = legacyMultiStepPersistSpy({
    run: synthRun(),
    findings: synthFindings(3),
    failAt: "finding:1",
  });
  assert.equal(legacy.ok, false);
  assert.equal(legacy.leftoverRun, true, "legacy leaves run row");
  assert.ok(legacy.store.runs.length === 1);
  assert.ok(legacy.leftoverFindings >= 1, "partial findings may exist");
  assert.equal(legacy.created, true, "legacy risk: created-like leftover");
  stats.legacyLeftoverRuns += 1;
  console.log("PASS old FAIL", {
    leftoverRun: legacy.leftoverRun,
    leftoverFindings: legacy.leftoverFindings,
    note: "run insert ok + finding fail ⇒ durable partial row (non-atomic)",
  });
}

console.log("A) atomic success → created=true, counts match");
{
  const r = simulateAtomicPersistTransaction({
    run: synthRun(),
    findings: synthFindings(3),
  });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.equal(r.findingCount, 3);
  assert.equal(r.store.runs.length, 1);
  assert.equal(r.store.findings.length, 3);
  assert.equal(r.store.audits.length, 1);
  stats.atomicSuccess += 1;
  stats.rpcCalls += r.counters.rpcCalls;
  console.log("PASS A");
}

console.log("B) run insert fail → 0/0/0");
{
  const r = simulateAtomicPersistTransaction({
    run: synthRun({ source_fingerprint: "fp-b" }),
    findings: synthFindings(2),
    failAt: "run",
  });
  assert.equal(r.ok, false);
  assert.equal(r.created, false);
  assert.equal(r.store.runs.length, 0);
  assert.equal(r.store.findings.length, 0);
  assert.equal(r.store.audits.length, 0);
  stats.atomicRollback += 1;
  console.log("PASS B");
}

console.log("C) finding 1 ok, finding 2 fail → rollback 0/0/0");
{
  const r = simulateAtomicPersistTransaction({
    run: synthRun({ source_fingerprint: "fp-c" }),
    findings: synthFindings(3),
    failAt: "finding:1",
  });
  assert.equal(r.ok, false);
  assert.equal(r.created, false);
  assert.equal(r.leftoverRun, false);
  assert.equal(r.store.runs.length, 0);
  assert.equal(r.store.findings.length, 0);
  assert.equal(r.store.audits.length, 0);
  stats.atomicRollback += 1;
  console.log("PASS C");
}

console.log("D) audit fail → rollback 0/0/0");
{
  const r = simulateAtomicPersistTransaction({
    run: synthRun({ source_fingerprint: "fp-d" }),
    findings: synthFindings(1),
    failAt: "audit",
  });
  assert.equal(r.ok, false);
  assert.equal(r.store.runs.length, 0);
  assert.equal(r.store.findings.length, 0);
  assert.equal(r.store.audits.length, 0);
  stats.atomicRollback += 1;
  console.log("PASS D");
}

console.log("E) retry → tek run, tam findings, tek audit (idempotent)");
{
  const store = { runs: [], findings: [], audits: [] };
  const first = simulateAtomicPersistTransaction({
    store,
    run: synthRun({ source_fingerprint: "fp-e" }),
    findings: synthFindings(4),
  });
  const second = simulateAtomicPersistTransaction({
    store,
    run: synthRun({ source_fingerprint: "fp-e" }),
    findings: synthFindings(4),
    retry: true,
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.reused, true);
  assert.equal(store.runs.filter((x) => x.status === "completed").length, 1);
  assert.equal(store.findings.length, 4);
  assert.ok(store.audits.length >= 2);
  stats.atomicSuccess += 1;
  console.log("PASS E");
}

console.log("F) double click / concurrent → tek run");
{
  const store = { runs: [], findings: [], audits: [] };
  const run = synthRun({ source_fingerprint: "fp-f" });
  const findings = synthFindings(2);
  const a = simulateAtomicPersistTransaction({ store, run, findings });
  const b = simulateAtomicPersistTransaction({ store, run, findings });
  assert.equal(a.created, true);
  assert.equal(b.reused, true);
  assert.equal(store.runs.length, 1);
  console.log("PASS F");
}

console.log("G) başka company aynı fingerprint → izole");
{
  const store = { runs: [], findings: [], audits: [] };
  simulateAtomicPersistTransaction({
    store,
    run: synthRun({ company_id: "co-a", source_fingerprint: "fp-shared" }),
    findings: synthFindings(1),
  });
  simulateAtomicPersistTransaction({
    store,
    run: synthRun({ company_id: "co-b", source_fingerprint: "fp-shared" }),
    findings: synthFindings(1),
  });
  assert.equal(store.runs.length, 2);
  assert.equal(store.runs.filter((r) => r.company_id === "co-a").length, 1);
  assert.equal(store.runs.filter((r) => r.company_id === "co-b").length, 1);
  console.log("PASS G");
}

console.log("H/I) identity blocked / excel unconfirmed → RPC 0");
{
  let rpcCalls = 0;
  const gateOrSkip = (summary, types) => {
    try {
      assertEdefterPersistIdentityGate({
        resultSummary: summary,
        documentTypes: types,
      });
      rpcCalls += 1;
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(
    gateOrSkip(
      {
        identity_status: EDEFTER_IDENTITY_STATUS.MISMATCH,
        identity_verified: false,
        identity_user_confirmed: false,
        identity_confirmation: IDENTITY_CONFIRMATION.BLOCKED,
      },
      ["XML/ZIP"]
    ),
    false
  );
  assert.equal(
    gateOrSkip(
      {
        identity_status: EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW,
        identity_verified: false,
        identity_user_confirmed: false,
        identity_confirmation: IDENTITY_CONFIRMATION.UNVERIFIED,
      },
      ["Muavin"]
    ),
    false
  );
  assert.equal(rpcCalls, 0);
  stats.identityBlocked += 2;
  console.log("PASS H/I");
}

console.log("J) malformed/PII → reject; UI error has no SQL/VKN");
{
  assert.ok(!EDEFTER_ATOMIC_PERSIST_UI_ERROR.includes("SQL"));
  assert.ok(!EDEFTER_ATOMIC_PERSIST_UI_ERROR.includes(ID.VKN_A));
  const fakeRpc = {
    async rpc() {
      return { data: null, error: { message: `relation boom ${ID.VKN_A}`, code: "42P01" } };
    },
  };
  await assert.rejects(
    () =>
      callEdefterAtomicPersistRpc(fakeRpc, {
        run: synthRun(),
        findings: [],
      }),
    (e) =>
      e.message === EDEFTER_ATOMIC_PERSIST_UI_ERROR &&
      !String(e.message).includes(ID.VKN_A) &&
      !String(e.message).includes("relation")
  );
  console.log("PASS J");
}

console.log("K) history contract — completed only in GET route");
{
  const route = fs.readFileSync(
    path.join(root, "app/api/edefter-control/runs/route.js"),
    "utf8"
  );
  assert.match(route, /eq\("status", "completed"\)/);
  assert.match(route, /callEdefterAtomicPersistRpc/);
  assert.doesNotMatch(route, /\.from\(FINDINGS_TABLE\)\s*\.insert/);
  console.log("PASS K");
}

console.log("L) migration 035 contract");
{
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/035_edefter_atomic_control_persist.sql"),
    "utf8"
  );
  assert.match(sql, new RegExp(EDEFTER_ATOMIC_PERSIST_RPC));
  assert.match(sql, /security definer/i);
  assert.match(sql, /grant execute[\s\S]*service_role/i);
  assert.doesNotMatch(sql, /^\s*drop table\b/im);
  assert.doesNotMatch(sql, /^\s*truncate\b/im);
  assert.doesNotMatch(sql, /^\s*delete from\b/im);
  console.log("PASS L");
}

console.log("Idempotency key deterministic + no PII");
{
  const k1 = buildEdefterPersistIdempotencyKey({
    companyId: "co",
    period: "2026/05",
    sourceFingerprint: "fp",
    engineVersion: "3.1.0",
    resultFingerprint: "rf",
  });
  const k2 = buildEdefterPersistIdempotencyKey({
    companyId: "co",
    period: "2026/05",
    sourceFingerprint: "fp",
    engineVersion: "3.1.0",
    resultFingerprint: "rf",
  });
  assert.equal(k1, k2);
  assert.ok(!k1.includes(ID.VKN_A));
  console.log("PASS idempotency key");
}

console.log("Perf: findings payload sizes");
{
  const rows = [0, 10, 1000, 10000].map((n) => measureFindingsPayload(n));
  for (const row of rows) {
    console.log("PERF", row);
  }
  assert.equal(rows[0].bytes, 2);
  assert.ok(rows[3].bytes > rows[2].bytes);
  console.log("PASS perf measures");
}

console.log("\nCOUNTERS", stats);
console.log("All edefter atomic persist checks passed.");
