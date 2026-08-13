/**
 * Staging MARE 2/2 → 4/4 regresyonu (kimliksiz).
 * Gerçek staging hareketleri + plan şekli; firma/source/hash hard-code yok.
 *
 * FAIL (eski): hint yok / stale idempotency → faiz+stopaj 2, açılış+kapanış inceleme.
 * PASS (yeni): filename hint + lifecycle → 4/4 · inceleme 0 · V005/V001/642/193.
 *
 * Run: node --import ./scripts/_alias-loader.mjs --test scripts/test-mare-staging-runtime-22-fix.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  mapParsedRowsToStandardMovements,
  mapSingleParsedRowToMovement,
  finalizeMappedBankMovements,
} from "@/src/utils/bankMovementMapper.js";
import {
  bankMovementToStandardLucaRows,
  buildElektrawebPreviewRows,
} from "@/src/utils/standardLucaRow.js";
import {
  buildUniqueMovementMissingStats,
  isMissingHesapRow,
} from "@/src/utils/previewExportValidation.js";
import { analyzeStandardLucaRows } from "@/src/utils/fisKontrolMerkezi.js";
import { BANK_TRANSACTION_TYPE } from "@/src/utils/bankTransactionType.js";
import {
  applyVadeliMevduatLifecycle,
  VADELI_LIFECYCLE_ALGORITHM_VERSION,
} from "@/src/utils/vadeliMevduatLifecycle.js";
import { applyFaizStopajiClassification } from "@/src/utils/faizStopajiClassify.js";
import {
  ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  buildRevisionIdempotencyKey,
  isCompatibleExistingReanalyzeJob,
} from "@/src/utils/bankStatementReanalyze.js";
import {
  canReanalyzeFromCanonicalSnapshot,
  publicBankSnapshotMovementView,
  snapshotMovementsToLegacyRows,
} from "@/src/utils/bankCanonicalSnapshot.js";
import { ANNVERO_V1_ENGINE_VERSION } from "@/src/utils/annveroV1Orchestration.js";
import {
  buildMovementMappingContext,
  inferStatementAccountHint,
  runAccountingAnalysisOnMovementsAsync,
} from "@/src/utils/bankParserCore.js";

/** Staging snapshot hareketleri — kimlik yok. */
const STAGING_MOVEMENTS = [
  {
    sort_index: 0,
    transaction_date: "26.12.2025",
    description: "17:46 2025018436000580 Vadeli Mevduat Hesap Açma",
    amount: 1018500,
    direction: "GIRIS",
    currency: "TRY",
    movement_type: "DK",
    classification: "",
    review_required: false,
    low_confidence: false,
    status: "ok",
    safe_extra: {},
  },
  {
    sort_index: 1,
    transaction_date: "27.01.2026",
    description: "01:46 2026001351759296 Mevduat Faiz Tahakkuku",
    amount: 33931.4,
    direction: "GIRIS",
    currency: "TRY",
    movement_type: "DK",
    classification: "",
    review_required: false,
    low_confidence: false,
    status: "ok",
    safe_extra: {},
  },
  {
    sort_index: 2,
    transaction_date: "27.01.2026",
    description: "01:46 2026001351759296 Mevduat Faiz Stopaj",
    amount: -5938,
    direction: "CIKIS",
    currency: "TRY",
    movement_type: "DK",
    classification: "",
    review_required: false,
    low_confidence: false,
    status: "ok",
    safe_extra: {},
  },
  {
    sort_index: 3,
    transaction_date: "27.01.2026",
    description: "02:20 2026001352071184 Hesap Kapatma",
    amount: -1046493.4,
    direction: "CIKIS",
    currency: "TRY",
    movement_type: "DK",
    classification: "",
    review_required: false,
    low_confidence: false,
    status: "ok",
    safe_extra: {},
  },
];

/** Staging plan şekli (anonim) — çoklu VADELI + örtük VADESIZ + yabancı banka. */
const STAGING_PLANS = [
  {
    accountCode: "102.01.004",
    accountName: "DENIZBANK YALIKAVAK SUBESI 7000 15 VADESIZ TL",
    isActive: true,
  },
  {
    accountCode: "102.01.002",
    accountName: "VAKIFBANK LEVENT CARSI SB TL",
    isActive: true,
  },
  {
    accountCode: "102.01.034",
    accountName: "VAKIFBANK LEVENT CARSI SB VADELİ HS",
    isActive: true,
  },
  {
    accountCode: "102.01.037",
    accountName: "VAKIFBANK LEVENT CARSI SB VADELİ HS",
    isActive: true,
  },
  {
    accountCode: "102.01.048",
    accountName: "VAKIFBANK LEVENT CARSI SB. 146875 NL HS.",
    isActive: true,
  },
  {
    accountCode: "102.10.V001",
    accountName: "VAKIFBANK TL 1 5800 7308 4284 49 - 7308 ÖNBÜRO",
    isActive: true,
  },
  {
    accountCode: "102.10.V002",
    accountName: "VAKIFBANK TL 1 5800 7343 8286 54 - 7343",
    isActive: true,
  },
  {
    accountCode: "102.10.V003",
    accountName: "VAKIFBANK TL 1 5800 7320 9286 54 - 7320",
    isActive: true,
  },
  {
    accountCode: "102.10.V004",
    accountName: "VAKIFBANK VADELİ  465930 TL HS.",
    isActive: true,
  },
  {
    accountCode: "102.10.V005",
    accountName: "VAKIFBANK VADELİ  466201 TL HS.",
    isActive: true,
  },
  {
    accountCode: "102.10.V006",
    accountName: "VAKIFBANK VADELİ  466233 TL HS.",
    isActive: true,
  },
  { accountCode: "642.01.001", accountName: "FAIZ GELIRLERI", isActive: true },
  {
    accountCode: "193.01.001",
    accountName: "PESIN ODENEN VERGI VE FONLAR",
    isActive: true,
  },
];

const COMPANY = {
  id: "fixture-staging",
  companyName: "FIXTURE RESORT AS",
  bankAccounts: [],
};

const FILE = "00158018033466201.pdf";

function legacyRows() {
  return snapshotMovementsToLegacyRows(
    STAGING_MOVEMENTS.map((row, i) =>
      publicBankSnapshotMovementView({
        ...row,
        id: `m${i}`,
        source_id: "src",
        company_id: COMPANY.id,
        source_movement_id: `sm-${i}`,
      })
    )
  );
}

function ctx(extra = {}) {
  return {
    selectedCompany: COMPANY,
    company: COMPANY,
    companyId: COMPANY.id,
    companyPlans: STAGING_PLANS,
    selectedBank: "VAKIFBANK",
    statementAccountType: "VADELI",
    currency: "TL",
    persistVadeliMemory: false,
    ...extra,
  };
}

function summarize(mapped) {
  const luca = mapped.flatMap((m) =>
    bankMovementToStandardLucaRows(m, {
      selectedCompany: COMPANY,
      selectedBank: "VAKIFBANK",
    })
  );
  const stats = buildUniqueMovementMissingStats(luca);
  return {
    matched: stats.uniqueMatchedMovements,
    unresolved: stats.uniqueUnresolvedMovements,
    missing: luca.filter(isMissingHesapRow).length,
    lucaRows: luca.length,
    luca,
    legs: mapped.map((m) => ({
      type: m.transactionType,
      account: m.accountCode,
      counter: m.counterAccountCode,
      role: m.vadeliLifecycleRole,
      warn: String(m.warning || ""),
    })),
  };
}

test("STAGING REPRO FAIL: hint yok → incelemede kalan açılış+kapanış (2/2 pattern)", () => {
  const mapped = mapParsedRowsToStandardMovements(
    legacyRows(),
    ctx({ sourceFileName: "", statementAccountHint: "" })
  );
  // Belge kararı stopaj → tam staging 2/2
  const stopaj = mapped.find((m) =>
    String(m.description || "").includes("Stopaj")
  );
  if (stopaj) {
    stopaj.counterAccountCode = "193.01.001";
    stopaj.reviewRequired = false;
    stopaj.missingHesapCategory = "";
  }
  const s = summarize(mapped);
  assert.equal(s.matched, 2);
  assert.equal(s.unresolved, 2);
  assert.equal(s.missing, 2);
  const open = s.legs.find((l) => String(l.warn || "").includes("Açma") || l.type === "BILINMEYEN" || l.type === "VADELI_ACILIS");
  void open;
  assert.ok(
    s.legs.some((l) => l.type === "FAIZ_GELIRI" && l.counter === "642.01.001")
  );
  assert.ok(
    s.legs.some((l) => String(l.counter) === "193.01.001")
  );
});

test("STAGING PASS: filename hint → 4/4 · V005/V001 · inceleme 0", () => {
  assert.equal(
    canReanalyzeFromCanonicalSnapshot({
      source: { status: "active", movementCount: 4 },
      movements: legacyRows().map((_, i) => ({ id: `m${i}` })),
    }).ok,
    true
  );

  let lifecyclePasses = 0;
  const options = ctx({
    sourceFileName: FILE,
    statementAccountHint: "00158018033466201",
    onVadeliLifecyclePass: () => {
      lifecyclePasses += 1;
    },
  });
  const mapped = mapParsedRowsToStandardMovements(legacyRows(), options);
  assert.equal(lifecyclePasses, 1);

  const byType = Object.fromEntries(mapped.map((m) => [m.transactionType, m]));
  assert.equal(byType[BANK_TRANSACTION_TYPE.VADELI_ACILIS]?.accountCode, "102.10.V005");
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.VADELI_ACILIS]?.counterAccountCode,
    "102.10.V001"
  );
  assert.equal(byType[BANK_TRANSACTION_TYPE.FAIZ_GELIRI]?.accountCode, "102.10.V005");
  assert.equal(byType[BANK_TRANSACTION_TYPE.FAIZ_GELIRI]?.counterAccountCode, "642.01.001");
  assert.equal(byType[BANK_TRANSACTION_TYPE.FAIZ_STOPAJI]?.accountCode, "102.10.V005");
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.FAIZ_STOPAJI]?.counterAccountCode,
    "193.01.001"
  );
  assert.equal(byType[BANK_TRANSACTION_TYPE.VADELI_KAPANIS]?.accountCode, "102.10.V005");
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.VADELI_KAPANIS]?.counterAccountCode,
    "102.10.V001"
  );

  for (const m of mapped) {
    assert.notEqual(m.counterAccountCode, "102.10.V005");
    assert.notEqual(m.accountCode, "102.01.004");
    assert.notEqual(m.counterAccountCode, "102.01.004");
  }

  const s = summarize(mapped);
  assert.equal(s.matched, 4);
  assert.equal(s.unresolved, 0);
  assert.equal(s.missing, 0);
  assert.equal(s.lucaRows, 8);
  const borc = s.luca.reduce((n, r) => n + (Number(r.borc) || 0), 0);
  const alacak = s.luca.reduce((n, r) => n + (Number(r.alacak) || 0), 0);
  assert.ok(Math.abs(borc - alacak) < 0.011);

  const fis = analyzeStandardLucaRows(s.luca, {
    companyId: COMPANY.id,
    accountPlanCodes: STAGING_PLANS.map((p) => p.accountCode),
  });
  assert.equal(fis.summary.hataRowCount, 0);
  assert.equal(fis.summary.gectiRowCount, 8);

  const elektra = buildElektrawebPreviewRows(s.luca, {
    selectedCompany: COMPANY,
    selectedBank: "VAKIFBANK",
  });
  assert.ok(Array.isArray(elektra) ? elektra.length >= 8 : true);
});

/**
 * Eski hydrate yolu: unique-memo mapSingle + faiz/stopaj, lifecycle YOK.
 * Açılış/kapanış V001 alamaz → 4/4 olmaz (canlı ddf53fb: otomatik 2 / inceleme 2).
 */
test("HYDRATE LEGACY FAIL: mapSingle without finalize → 4/4 olmaz", () => {
  const options = ctx({
    sourceFileName: FILE,
    statementAccountHint: inferStatementAccountHint({ sourceFileName: FILE }),
  });
  assert.match(options.statementAccountHint, /158018033466201|00158018033466201/);
  const mapped = legacyRows().map((row, i) =>
    mapSingleParsedRowToMovement(row, options, i)
  );
  const { movements } = applyFaizStopajiClassification(mapped, options);
  // Belge kararı stopaj damgası (canlı 2/2 kalıbı)
  const stopaj = movements.find((m) =>
    String(m.description || "").includes("Stopaj")
  );
  if (stopaj) {
    stopaj.counterAccountCode = "193.01.001";
    stopaj.reviewRequired = false;
    stopaj.missingHesapCategory = "";
  }
  const s = summarize(movements);
  assert.ok(s.matched < 4, `legacy matched=${s.matched}`);
  assert.ok(s.unresolved >= 2, `legacy unresolved=${s.unresolved}`);
  assert.ok(s.missing >= 2, `legacy missing=${s.missing}`);
  assert.equal(
    movements.some(
      (m) =>
        m.transactionType === BANK_TRANSACTION_TYPE.VADELI_ACILIS &&
        m.counterAccountCode === "102.10.V001"
    ),
    false
  );
  assert.equal(
    movements.some((m) => m.vadeliLifecycleRole),
    false
  );
});

test("HYDRATE PASS: runAccountingAnalysisOnMovementsAsync → 4/4 · lifecycle ×1", async () => {
  let lifecyclePasses = 0;
  const hint = inferStatementAccountHint({ sourceFileName: FILE });
  const result = await runAccountingAnalysisOnMovementsAsync({
    ...buildMovementMappingContext(
      ctx({
        sourceFileName: FILE,
        statementAccountHint: hint,
        persistVadeliMemory: false,
      })
    ),
    movementRows: legacyRows(),
    onVadeliLifecyclePass: () => {
      lifecyclePasses += 1;
    },
  });
  assert.equal(lifecyclePasses, 1);

  const mapped = result.movementRows || [];
  const byType = Object.fromEntries(mapped.map((m) => [m.transactionType, m]));
  assert.equal(byType[BANK_TRANSACTION_TYPE.VADELI_ACILIS]?.accountCode, "102.10.V005");
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.VADELI_ACILIS]?.counterAccountCode,
    "102.10.V001"
  );
  assert.equal(byType[BANK_TRANSACTION_TYPE.FAIZ_GELIRI]?.counterAccountCode, "642.01.001");
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.FAIZ_STOPAJI]?.counterAccountCode,
    "193.01.001"
  );
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.VADELI_KAPANIS]?.counterAccountCode,
    "102.10.V001"
  );

  const s = summarize(mapped);
  assert.equal(s.matched, 4);
  assert.equal(s.unresolved, 0);
  assert.equal(s.missing, 0);
  assert.equal(s.lucaRows, 8);
  const borc = s.luca.reduce((n, r) => n + (Number(r.borc) || 0), 0);
  const alacak = s.luca.reduce((n, r) => n + (Number(r.alacak) || 0), 0);
  assert.ok(Math.abs(borc - alacak) < 0.011);

  const fis = analyzeStandardLucaRows(s.luca, {
    companyId: COMPANY.id,
    accountPlanCodes: STAGING_PLANS.map((p) => p.accountCode),
  });
  assert.equal(fis.summary.hataRowCount, 0);
  assert.equal(fis.summary.gectiRowCount, 8);
});

test("PDF batch ve hydrate analysis aynı muhasebe bacakları", async () => {
  const options = ctx({
    sourceFileName: FILE,
    statementAccountHint: inferStatementAccountHint({ sourceFileName: FILE }),
  });
  const batch = mapParsedRowsToStandardMovements(legacyRows(), options);
  const analyzed = await runAccountingAnalysisOnMovementsAsync({
    ...buildMovementMappingContext(options),
    movementRows: legacyRows(),
  });
  const hydrate = analyzed.movementRows || [];

  const legKey = (m) =>
    [
      m.transactionType,
      m.accountCode,
      m.counterAccountCode,
      m.vadeliLifecycleRole || "",
    ].join("|");
  const batchKeys = batch.map(legKey).sort();
  const hydrateKeys = hydrate.map(legKey).sort();
  assert.deepEqual(hydrateKeys, batchKeys);

  const sBatch = summarize(batch);
  const sHydrate = summarize(hydrate);
  assert.equal(sBatch.matched, 4);
  assert.equal(sHydrate.matched, 4);
  assert.equal(sBatch.unresolved, 0);
  assert.equal(sHydrate.unresolved, 0);
});

test("finalizeMappedBankMovements lifecycle tek geçiş (çift apply yok)", () => {
  let passes = 0;
  const options = ctx({
    sourceFileName: FILE,
    statementAccountHint: "00158018033466201",
    onVadeliLifecyclePass: () => {
      passes += 1;
    },
  });
  const singles = legacyRows().map((row, i) =>
    mapSingleParsedRowToMovement(row, options, i)
  );
  const once = finalizeMappedBankMovements(singles, options);
  assert.equal(passes, 1);
  assert.equal(
    once.filter((m) => m.vadeliLifecycleRole).length,
    4
  );
  // İkinci apply aynı kodları korur (yön ters çevrilmez)
  const twice = applyVadeliMevduatLifecycle(once, options);
  assert.equal(twice.applied, true);
  assert.equal(twice.bundle?.statementCode, "102.10.V005");
  assert.equal(twice.bundle?.vadesizCode, "102.10.V001");
  for (let i = 0; i < once.length; i += 1) {
    assert.equal(twice.movements[i].accountCode, once[i].accountCode);
    assert.equal(
      twice.movements[i].counterAccountCode,
      once[i].counterAccountCode
    );
    assert.equal(twice.movements[i].direction, once[i].direction);
  }
});

test("stale completed-job: eski pipe yok key uyumsuz", () => {
  const expected = buildRevisionIdempotencyKey({
    companyId: "c",
    contentHash: "h1",
    revision: 2,
    planFingerprint: "d652977ac49b121412aa8ecab4a4fe54ac8a69816759de62804353c939f07a9a",
    sourceId: "src-1",
    sourceRevision: 14,
    snapshotFingerprint: "h1",
  });
  assert.match(expected, /:pipe:/);
  assert.match(expected, /:src:src-1/);
  assert.match(expected, /:srev:14/);
  assert.match(expected, new RegExp(VADELI_LIFECYCLE_ALGORITHM_VERSION.replace(".", "\\.")));

  const staleMeta = {
    idempotency_key:
      `annvero-v1:c:h1:${ANNVERO_V1_ENGINE_VERSION}:rev:2:plan:d652977ac49b121412aa8ecab4a4fe54ac8a69816759de62804353c939f07a9a`,
    terminal_status: "review_required",
    auto_matched_count: 2,
    review_count: 2,
  };
  const stale = isCompatibleExistingReanalyzeJob({
    existingMetadata: staleMeta,
    expectedIdempotencyKey: expected,
  });
  assert.equal(stale.ok, false);

  const same = isCompatibleExistingReanalyzeJob({
    existingMetadata: {
      idempotency_key: expected,
      terminal_status: "completed",
      auto_matched_count: 4,
      review_count: 0,
    },
    expectedIdempotencyKey: expected,
  });
  assert.equal(same.ok, true);

  const otherPipe = buildRevisionIdempotencyKey({
    companyId: "c",
    contentHash: "h1",
    revision: 2,
    planFingerprint: "d652977ac49b121412aa8ecab4a4fe54ac8a69816759de62804353c939f07a9a",
    pipelineVersion: "br/9.9.9+vl/9.9.9",
    sourceId: "src-1",
    sourceRevision: 14,
    snapshotFingerprint: "h1",
  });
  assert.notEqual(otherPipe, expected);
  assert.equal(
    isCompatibleExistingReanalyzeJob({
      existingMetadata: {
        idempotency_key: expected,
        terminal_status: "completed",
      },
      expectedIdempotencyKey: otherPipe,
      expectedPipelineVersion: "br/9.9.9+vl/9.9.9",
    }).ok,
    false
  );
});

test("pipeline version constant is deterministic", () => {
  assert.equal(
    ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
    `br/2.1.0+${VADELI_LIFECYCLE_ALGORITHM_VERSION}`
  );
});
