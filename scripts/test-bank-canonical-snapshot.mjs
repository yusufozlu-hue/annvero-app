/**
 * Bank canonical snapshot — persistence / fileless reanalyze / PDF–Excel parity.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-canonical-snapshot.mjs
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
  BANK_CANONICAL_SCHEMA_VERSION,
  assertNoRawBankSnapshotLeak,
  assertPdfExcelSnapshotParity,
  buildSnapshotMovementsFromRows,
  canReanalyzeFromCanonicalSnapshot,
  detectSnapshotSourceType,
  movementRowToSnapshotMovement,
  publicBankSnapshotSourceView,
  sanitizeIncomingSnapshotBody,
  snapshotMovementToLegacyRow,
  snapshotMovementsToLegacyRows,
} = await import("@/src/utils/bankCanonicalSnapshot.js");

const { canFilelessReanalyze } = await import(
  "@/src/utils/bankStatementReanalyze.js"
);

const {
  DUPLICATE_SNAPSHOT_ACTION,
  buildDuplicateSnapshotPipelineResult,
  isDuplicateSnapshotUpgradeIdempotent,
  preferSnapshotMovementCount,
  resolveDuplicateSnapshotAction,
} = await import("@/src/utils/bankDuplicateSnapshotUpgrade.js");

const { validateV1Inputs } = await import(
  "@/src/utils/annveroV1Orchestration.js"
);

const { canStartFullPipeline } = await import(
  "@/src/utils/bankOneClickPipeline.js"
);

test("migration 031 present and non-destructive", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/031_bank_statement_canonical_snapshots.sql"),
    "utf8"
  );
  assert.match(sql, /bank_statement_sources/);
  assert.match(sql, /bank_statement_movements/);
  assert.match(sql, /annvero_can_access_company/);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /service_role/);
});

test("API route exists and uses auth + rate limit", () => {
  const src = fs.readFileSync(
    path.join(root, "app/api/bank-statement-snapshots/route.js"),
    "utf8"
  );
  assert.match(src, /requireAuthenticatedApi/);
  assert.match(src, /enforceRateLimit/);
  assert.match(src, /assertNoRawBankSnapshotLeak/);
  assert.match(src, /SOURCE_DELETED/);
  assert.doesNotMatch(src, /base64/);
  assert.doesNotMatch(src, /access_token/);
});

test("detect pdf/excel source types", () => {
  assert.equal(
    detectSnapshotSourceType({ fileName: "a.pdf" }),
    "pdf"
  );
  assert.equal(
    detectSnapshotSourceType({ fileName: "a.xlsx" }),
    "excel"
  );
});

test("movement round-trip preserves sourceMovementId", () => {
  const snap = movementRowToSnapshotMovement(
    {
      id: "mov-faiz-1",
      date: "2026-03-01",
      description: "Vadeli faiz",
      amount: 33931.4,
      direction: "GIRIS",
      classification: "INTEREST",
      sourcePage: 1,
    },
    0
  );
  assert.equal(snap.sourceMovementId, "mov-faiz-1");
  assert.equal(snap.schemaVersion, BANK_CANONICAL_SCHEMA_VERSION);
  const legacy = snapshotMovementToLegacyRow(snap);
  assert.equal(legacy.sourceMovementId, "mov-faiz-1");
  assert.equal(legacy.id, "mov-faiz-1");
  assert.equal(legacy.fromCanonicalSnapshot, true);
});

test("PDF and Excel parity on required fields", () => {
  const pdf = buildSnapshotMovementsFromRows([
    {
      id: "p1",
      date: "2026-01-01",
      description: "PDF faiz",
      amount: 10,
      direction: "GIRIS",
    },
  ]);
  const excel = buildSnapshotMovementsFromRows([
    {
      id: "e1",
      date: "2026-01-01",
      description: "Excel faiz",
      amount: 10,
      direction: "GIRIS",
    },
  ]);
  assert.equal(assertPdfExcelSnapshotParity(pdf, excel), true);
});

test("raw leak guard rejects drive file id / base64", () => {
  assert.throws(() =>
    assertNoRawBankSnapshotLeak({ fileId: "drive-abc", movements: [] })
  );
  assert.throws(() =>
    assertNoRawBankSnapshotLeak({
      payload: "data:application/pdf;base64,AAA",
    })
  );
  assert.equal(assertNoRawBankSnapshotLeak({ contentHash: "abc" }), true);
});

test("sanitize strips forbidden keys and keeps canonical fields", () => {
  const body = sanitizeIncomingSnapshotBody({
    companyId: "c1",
    contentHash: "hash1",
    fileName: "x.pdf",
    detectedBank: "VAKIFBANK",
    movements: [
      {
        id: "m1",
        transactionDate: "2026-01-02",
        description: "Stopaj",
        amount: -5938,
        direction: "CIKIS",
        access_token: "secret",
      },
    ],
    safeSummary: { driveFileId: "should-drop", movementCount: 1 },
  });
  assert.equal(body.source.company_id, "c1");
  assert.equal(body.movements.length, 1);
  assert.equal(body.movements[0].source_movement_id, "m1");
  assert.equal(body.source.safe_summary.driveFileId, undefined);
  assert.equal(body.source.safe_summary.movementCount, 1);
});

test("canReanalyzeFromCanonicalSnapshot blocks deleted / empty", () => {
  assert.equal(
    canReanalyzeFromCanonicalSnapshot({
      source: { status: "deleted" },
      movementCount: 4,
    }).ok,
    false
  );
  assert.equal(
    canReanalyzeFromCanonicalSnapshot({
      source: { status: "active", movementCount: 0 },
      movementCount: 0,
    }).ok,
    false
  );
  assert.equal(
    canReanalyzeFromCanonicalSnapshot({
      source: { status: "active", movementCount: 4 },
      movementCount: 4,
    }).ok,
    true
  );
});

test("fileless reanalyze gate", () => {
  assert.equal(
    canFilelessReanalyze({
      hasFile: false,
      hasCheckpoint: false,
      hasCanonicalSnapshot: true,
    }),
    true
  );
  assert.equal(
    canFilelessReanalyze({
      hasFile: false,
      hasCheckpoint: false,
      hasCanonicalSnapshot: false,
    }),
    false
  );
});

test("validateV1Inputs allows snapshot without file", () => {
  const ok = validateV1Inputs({
    companyId: "c1",
    file: null,
    bankId: "VAKIFBANK",
    fromCanonicalSnapshot: true,
  });
  assert.equal(ok.ok, true);
  const bad = validateV1Inputs({
    companyId: "c1",
    file: null,
    bankId: "VAKIFBANK",
    fromCanonicalSnapshot: false,
  });
  assert.equal(bad.ok, false);
});

test("canStartFullPipeline allows snapshot without file", () => {
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "c1",
      selectedBank: "VAKIFBANK",
      selectedFile: null,
      isJobBusy: false,
      pipelinePhase: "",
      fromCanonicalSnapshot: true,
    }),
    true
  );
});

test("public source view never exposes raw bytes fields", () => {
  const view = publicBankSnapshotSourceView({
    id: "s1",
    company_id: "c1",
    content_hash: "h",
    file_name: "a.pdf",
    mime_type: "application/pdf",
    byte_length: 12,
    detected_bank: "VAKIFBANK",
    source_type: "pdf",
    schema_version: BANK_CANONICAL_SCHEMA_VERSION,
    movement_count: 4,
    status: "active",
    safe_summary: { movementCount: 4 },
  });
  assert.equal(view.movementCount, 4);
  assert.equal(view.contentHash, "h");
  assert.equal("uint8Bytes" in view, false);
  assert.equal("rawPdf" in view, false);
});

test("no backfill: empty movements stay blocked", () => {
  const gate = canReanalyzeFromCanonicalSnapshot({
    source: { status: "active", id: "old-job" },
    movements: [],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, "NO_CANONICAL_MOVEMENTS");
});

test("legacy rows keep resolution binding ids", () => {
  const rows = snapshotMovementsToLegacyRows([
    {
      source_movement_id: "mov-open",
      transaction_date: "2026-01-01",
      description: "Açma",
      amount: 100,
      direction: "GIRIS",
    },
    {
      source_movement_id: "mov-close",
      transaction_date: "2026-01-02",
      description: "Kapatma",
      amount: -100,
      direction: "CIKIS",
    },
  ]);
  assert.equal(rows[0].sourceMovementId, "mov-open");
  assert.equal(rows[1].sourceMovementId, "mov-close");
});

await testAsync("workbench wires snapshot client", async () => {
  const wb = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(wb, /persistBankCanonicalSnapshot/);
  assert.match(wb, /fetchLatestBankCanonicalSnapshot/);
  assert.match(wb, /fetchBankCanonicalSnapshotByHash/);
  assert.match(wb, /fromCanonicalSnapshot/);
  assert.match(wb, /canFilelessReanalyze/);
  assert.match(wb, /canonicalSourceIdRef/);
  assert.match(wb, /bankDuplicateSnapshotUpgrade/);
  assert.match(wb, /resolveDuplicateSnapshotAction/);
  assert.match(wb, /DUPLICATE_SNAPSHOT_ACTION\.UPGRADE/);
  assert.match(wb, /DUPLICATE_SNAPSHOT_ACTION\.RESTORE/);
  assert.match(wb, /snapshotUpgrade:\s*true/);
});

await test("duplicate+no snapshot resolves to upgrade", () => {
  assert.equal(
    resolveDuplicateSnapshotAction({
      hasSnapshotMovements: false,
      hasFileBytes: true,
    }),
    DUPLICATE_SNAPSHOT_ACTION.UPGRADE
  );
});

await test("duplicate+snapshot resolves to restore", () => {
  assert.equal(
    resolveDuplicateSnapshotAction({
      hasSnapshotMovements: true,
      hasFileBytes: true,
    }),
    DUPLICATE_SNAPSHOT_ACTION.RESTORE
  );
  assert.equal(
    resolveDuplicateSnapshotAction({
      hasSnapshotMovements: true,
      hasFileBytes: false,
    }),
    DUPLICATE_SNAPSHOT_ACTION.RESTORE
  );
});

await test("duplicate without file bytes and no snapshot is legacy", () => {
  assert.equal(
    resolveDuplicateSnapshotAction({
      hasSnapshotMovements: false,
      hasFileBytes: false,
    }),
    DUPLICATE_SNAPSHOT_ACTION.LEGACY
  );
});

await test("preferSnapshotMovementCount never uses stale audit count", () => {
  assert.equal(preferSnapshotMovementCount(5, 4), 4);
  assert.equal(preferSnapshotMovementCount(5, 0), 5);
  assert.equal(preferSnapshotMovementCount(0, 4), 4);
});

await test("buildDuplicateSnapshotPipelineResult restore uses snapshot count", () => {
  const result = buildDuplicateSnapshotPipelineResult({
    action: DUPLICATE_SNAPSHOT_ACTION.RESTORE,
    prior: {
      id: "job-prior",
      metadata: {
        movement_count: 5,
        content_hash: "hash-1",
      },
    },
    movementCount: 4,
    sourceId: "src-1",
    contentHash: "hash-1",
  });
  assert.equal(result.fromCanonicalSnapshot, true);
  assert.equal(result.snapshotRestored, true);
  assert.equal(result.snapshotUpgraded, false);
  assert.equal(result.movementCount, 4);
  assert.equal(result.driveSkipped, true);
  assert.equal(result.canonicalSourceId, "src-1");
  assert.equal(result.priorJobId, "job-prior");
});

await test("buildDuplicateSnapshotPipelineResult upgrade is idempotent-ready", () => {
  const result = buildDuplicateSnapshotPipelineResult({
    action: DUPLICATE_SNAPSHOT_ACTION.UPGRADE,
    prior: {
      id: "job-prior",
      metadata: { movement_count: 5 },
    },
    movementCount: 4,
    sourceId: "src-1",
    contentHash: "hash-1",
  });
  assert.equal(result.fromCanonicalSnapshot, true);
  assert.equal(result.snapshotUpgraded, true);
  assert.equal(result.snapshotRestored, false);
  assert.equal(result.movementCount, 4);
  assert.equal(result.driveSkipped, true);
  assert.equal(
    isDuplicateSnapshotUpgradeIdempotent({
      firstAction: DUPLICATE_SNAPSHOT_ACTION.UPGRADE,
      secondHasSnapshotMovements: true,
    }),
    true
  );
  assert.equal(
    resolveDuplicateSnapshotAction({
      hasSnapshotMovements: true,
      hasFileBytes: true,
    }),
    DUPLICATE_SNAPSHOT_ACTION.RESTORE
  );
});

await test("workbench company confirm resumes from canonical snapshot", () => {
  const wb = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(wb, /hasCanonicalSnapshot/);
  assert.match(
    wb,
    /fromCanonicalSnapshot:\s*hasCanonicalSnapshot && !sourceFile/
  );
  assert.match(
    wb,
    /oturumdaki kaynak dosya veya canonical snapshot gerekli/
  );
});

await test("result card shows reanalyze for snapshot restore", () => {
  const src = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
    ),
    "utf8"
  );
  assert.match(
    src,
    /isDuplicate \|\| Boolean\(result\?\.fromCanonicalSnapshot\)/
  );
  assert.match(src, /data-testid=\"bank-reanalyze-with-new-plan\"/);
});

await test("workbench duplicate upgrade/restore skips Drive and V1 job create", () => {
  const wb = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  const upgradeBlockStart = wb.indexOf(
    "if (snapAction === DUPLICATE_SNAPSHOT_ACTION.UPGRADE)"
  );
  const legacyBlockStart = wb.indexOf(
    "setPipelineResult({",
    upgradeBlockStart
  );
  assert.ok(upgradeBlockStart > 0);
  assert.ok(legacyBlockStart > upgradeBlockStart);
  const upgradeBlock = wb.slice(upgradeBlockStart, legacyBlockStart);
  assert.match(upgradeBlock, /persistBankCanonicalSnapshot/);
  assert.match(upgradeBlock, /finishDuplicateTerminal/);
  assert.doesNotMatch(upgradeBlock, /createBankStatementDriveFolder/);
  assert.doesNotMatch(upgradeBlock, /createV1Job\b/);
  assert.doesNotMatch(upgradeBlock, /persistV1Job\b/);

  const restoreBlockStart = wb.indexOf(
    "if (snapAction === DUPLICATE_SNAPSHOT_ACTION.RESTORE)"
  );
  const restoreBlock = wb.slice(restoreBlockStart, upgradeBlockStart);
  assert.match(restoreBlock, /finishDuplicateTerminal/);
  assert.doesNotMatch(restoreBlock, /createBankStatementDriveFolder/);
  assert.doesNotMatch(restoreBlock, /createV1Job\b/);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll bank canonical snapshot tests passed.");
