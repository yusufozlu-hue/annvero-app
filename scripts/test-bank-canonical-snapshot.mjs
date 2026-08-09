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
  // Comment'teki "TRUNCATE RLS bypass" uyarısını yok say; gerçek TRUNCATE TABLE yasak
  assert.doesNotMatch(sql, /\bTRUNCATE\s+TABLE\b/i);
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
  // Fileless confirm must accept snapshot even when session file is gone.
  const confirmStart = wb.indexOf("const handleConfirmCompanyAndContinue");
  assert.ok(confirmStart > 0, "handleConfirmCompanyAndContinue missing");
  const confirmEnd = wb.indexOf("\n  const handle", confirmStart + 10);
  const confirmBlock = wb.slice(
    confirmStart,
    confirmEnd > confirmStart ? confirmEnd : confirmStart + 2500
  );
  assert.match(confirmBlock, /hasCanonicalSnapshot/);
  assert.match(confirmBlock, /fromCanonicalSnapshot/);
  assert.doesNotMatch(
    confirmBlock,
    /if\s*\(\s*!sourceFile\s*\)\s*\{[\s\S]{0,120}return/
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

test("migration 032 document resolutions present and non-destructive", () => {
  const sql = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/032_bank_statement_movement_resolutions.sql"
    ),
    "utf8"
  );
  assert.match(sql, /bank_statement_movement_resolutions/);
  assert.match(sql, /source_movement_id/);
  assert.match(sql, /supersedes_resolution_id/);
  assert.match(sql, /annvero_can_access_company/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /service_role/);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  // Comment'teki "TRUNCATE RLS bypass" uyarısını yok say; gerçek TRUNCATE TABLE yasak
  assert.doesNotMatch(sql, /\bTRUNCATE\s+TABLE\b/i);
});

const {
  applyDocumentResolutionsToLucaRows,
  buildResolutionLookup,
  buildResolutionPayloadsFromApply,
  lookupDocumentResolution,
  resolveSourceMovementId,
} = await import("@/src/utils/bankStatementMovementResolutions.js");

test("document resolutions overlay before missing hesap and keep stable ids", () => {
  const resolutions = [
    {
      id: "r1",
      company_id: "c1",
      source_id: "s1",
      source_movement_id: "mov-faiz",
      account_code: "642.01.001",
      account_name: "Faiz",
      status: "active",
      revision: 1,
      user_approved: true,
    },
    {
      id: "r2",
      company_id: "c1",
      source_id: "s1",
      source_movement_id: "mov-stopaj",
      account_code: "193.01.001",
      account_name: "Stopaj",
      status: "active",
      revision: 1,
      user_approved: true,
    },
  ];
  const lookup = buildResolutionLookup(resolutions);
  assert.equal(
    lookupDocumentResolution(lookup, { sourceMovementId: "mov-faiz" })
      ?.accountCode,
    "642.01.001"
  );
  const luca = [
    {
      id: "luca-1",
      sourceMovementId: "mov-faiz",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
    },
    {
      id: "luca-2",
      sourceMovementId: "mov-acma",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
    },
    {
      id: "luca-3",
      sourceMovementId: "mov-stopaj",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
    },
  ];
  const applied = applyDocumentResolutionsToLucaRows(luca, resolutions);
  assert.equal(applied.applied, 2);
  assert.equal(applied.lucaRows[0].hesapKodu, "642.01.001");
  assert.equal(applied.lucaRows[1].hesapKodu, "");
  assert.equal(applied.lucaRows[2].hesapKodu, "193.01.001");
  assert.equal(resolveSourceMovementId(luca[0]), "mov-faiz");
});

test("buildResolutionPayloadsFromApply uses sourceMovementId not luca row id alone", () => {
  const payloads = buildResolutionPayloadsFromApply({
    companyId: "c1",
    sourceId: "s1",
    accountCode: "642.01.001",
    accountName: "Faiz",
    learn: true,
    group: {
      id: "g1",
      rowIds: ["luca-row-1"],
      direction: "GIRIS",
      seedRow: {
        id: "luca-row-1",
        sourceMovementId: "stable-faiz-1",
        transactionType: "FINANCE",
      },
    },
    lucaRows: [
      {
        id: "luca-row-1",
        sourceMovementId: "stable-faiz-1",
        direction: "GIRIS",
        transactionType: "FINANCE",
      },
    ],
  });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].source_movement_id, "stable-faiz-1");
  assert.equal(payloads[0].account_code, "642.01.001");
  assert.equal(payloads[0].learn_for_company, true);
});

test("buildResolutionPayloadsFromApply recovers id from learnSeed and sanitizes direction", () => {
  const payloads = buildResolutionPayloadsFromApply({
    companyId: "c1",
    sourceId: "s1",
    accountCode: "193.01.001",
    accountName: "Stopaj",
    learn: true,
    group: {
      id: "g2",
      rowIds: ["sl-9"],
      direction: "NOT_A_VALID_DIRECTION",
      seedRow: { id: "sl-9" },
      transactions: [
        {
          id: "sl-9",
          learnSeed: {
            id: "sl-9",
            sourceMovementId: "stable-stopaj-1",
            direction: "CIKIS",
          },
        },
      ],
    },
    lucaRows: [{ id: "sl-9" }],
  });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].source_movement_id, "stable-stopaj-1");
  assert.equal(payloads[0].direction, "");
});

test("snapshot legacy rows expose rawRow + stable sourceMovementId for fileless map", () => {
  const legacy = snapshotMovementToLegacyRow({
    id: "uuid-mov-1",
    source_movement_id: "uuid-mov-1",
    description: "VADELI MEVDUAT FAIZ",
    direction: "GIRIS",
    amount: 100,
    debit: 100,
    credit: 0,
  });
  assert.equal(legacy.sourceMovementId, "uuid-mov-1");
  assert.ok(legacy.rawRow);
  assert.equal(legacy.rawRow.sourceMovementId, "uuid-mov-1");
  assert.equal(legacy.rawRow.aciklama, "VADELI MEVDUAT FAIZ");
});

test("workbench persists document resolutions on apply and hydrates them", () => {
  const wb = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(wb, /persistBankStatementResolutions/);
  assert.match(wb, /undoBankStatementResolutions/);
  assert.match(wb, /documentResolutionsRef/);
  assert.match(wb, /pendingCanonicalHydrateReanalyzeRef/);
  assert.match(wb, /documentResolutions:\s*documentResolutionsRef\.current/);
  assert.match(wb, /buildResolutionPayloadsFromApply/);
});

const {
  inferMemoryDecisionType,
  MEMORY_DECISION_TYPE,
  normalizeAccountMemoryV2Record,
  resolveAccountMemoryV2Decision,
  saveAccountMemoryV2Decision,
  loadAccountMemoryV2Records,
} = await import("@/src/utils/accountMemoryV2.js");

test("642/193 learn is DIRECT/FINANCE not CARI — auto-apply on FINANCE type", () => {
  const prevWindow = globalThis.window;
  const store = new Map();
  const fakeLs = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = { localStorage: fakeLs };
  globalThis.localStorage = fakeLs;
  try {
    const saved = saveAccountMemoryV2Decision(
      {
        hesapKodu: "642.01.001",
        accountCode: "642.01.001",
        analysisKey: "vadeli mevduat faiz|GIRIS",
        direction: "GIRIS",
        transactionType: "FAIZ_GELIRI",
        normalizedDescription: "VADELI MEVDUAT FAIZ",
        source: "cari-resolution-center",
      },
      { firmaId: "company-mare", kaynakAdi: "VAKIFBANK" }
    );
    assert.ok(saved);
    assert.notEqual(saved.decisionType, MEMORY_DECISION_TYPE.CARI);
    assert.equal(saved.cariId, "");
    const decision = resolveAccountMemoryV2Decision(
      {
        companyId: "company-mare",
        analysisKey: "vadeli mevduat faiz|GIRIS",
        direction: "GIRIS",
        transactionType: "FAIZ_GELIRI",
        normalizedDescription: "VADELI MEVDUAT FAIZ",
      },
      loadAccountMemoryV2Records(),
      { allowAuto: true }
    );
    assert.equal(decision.autoApply, true);
    assert.notEqual(
      decision.rejectReason,
      "cari_forbidden_for_transaction_type"
    );
    assert.equal(decision.record?.accountCode, "642.01.001");
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    delete globalThis.localStorage;
  }
});

test("legacy wrong CARI+642 record heals and does not quarantine", () => {
  assert.equal(
    inferMemoryDecisionType({
      transactionType: "FAIZ_GELIRI",
      accountCode: "642.01.001",
      cariId: "",
    }),
    MEMORY_DECISION_TYPE.FINANCE_ACCOUNT
  );
  const healed = normalizeAccountMemoryV2Record({
    companyId: "c1",
    accountCode: "642.01.001",
    transactionType: "FAIZ_GELIRI",
    cariId: "642.01.001",
    decisionType: MEMORY_DECISION_TYPE.CARI,
    analysisKey: "faiz|GIRIS",
    direction: "GIRIS",
  });
  assert.equal(healed.cariId, "");
  assert.notEqual(healed.decisionType, MEMORY_DECISION_TYPE.CARI);
  assert.equal(healed.decisionType, MEMORY_DECISION_TYPE.FINANCE_ACCOUNT);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll bank canonical snapshot tests passed.");
