/**
 * Production MARE runtime regresyonu — gerçek plan şekli (kimliksiz).
 *
 * Prod UI FAIL (afd2250 @ 2026-08-11 14:32): 1/4 eşleşme, 3 inceleme, 3 eksik.
 * Kök neden: fileless reanalyze'de sourceFileName/hint düşüyor → çoklu VADELI ambiguous;
 * VADESIZ adında "VADESIZ" yok + banka filtresi diğer bankaya düşüyordu.
 *
 * Run: node --import ./scripts/_alias-loader.mjs --test scripts/test-mare-production-runtime-resolution.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mapParsedRowsToStandardMovements } from "@/src/utils/bankMovementMapper.js";
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
  resolve102RoleFromAccountPlan,
} from "@/src/utils/vadeliMevduatLifecycle.js";
import {
  canReanalyzeFromCanonicalSnapshot,
  publicBankSnapshotMovementView,
  snapshotMovementsToLegacyRows,
} from "@/src/utils/bankCanonicalSnapshot.js";

/** Prod snapshot hareketleri — firma/source id yok. */
const PROD_MOVEMENTS = [
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

/**
 * Gerçek MARE plan şekli (anonim): Türkçe İ, VADELİ hesabında numara,
 * vadesizde "VADESIZ" kelimesi yok, çoklu vadeli + yabancı banka gürültüsü.
 */
const RUNTIME_PLANS = [
  { accountCode: "102.01.004", accountName: "DENIZBANK YALIKAVAK SUBESI 7000 15 VADESIZ TL", isActive: true },
  { accountCode: "102.01.002", accountName: "VAKIFBANK LEVENT CARSI SB TL", isActive: true },
  { accountCode: "102.01.034", accountName: "VAKIFBANK LEVENT CARSI SB VADELİ HS", isActive: true },
  { accountCode: "102.01.037", accountName: "VAKIFBANK LEVENT CARSI SB VADELİ HS", isActive: true },
  { accountCode: "102.10.V001", accountName: "VAKIFBANK TL 1 5800 7308 4284 49 - 7308 ÖNBÜRO", isActive: true },
  { accountCode: "102.10.V002", accountName: "VAKIFBANK TL 1 5800 7343 8286 54 - 7343", isActive: true },
  { accountCode: "102.10.V003", accountName: "VAKIFBANK TL 1 5800 7320 9286 54 - 7320", isActive: true },
  { accountCode: "102.10.V004", accountName: "VAKIFBANK VADELİ  465930 TL HS.", isActive: true },
  { accountCode: "102.10.V005", accountName: "VAKIFBANK VADELİ  466201 TL HS.", isActive: true },
  { accountCode: "102.10.V006", accountName: "VAKIFBANK VADELİ  466233 TL HS.", isActive: true },
  { accountCode: "642.01.001", accountName: "FAIZ GELIRLERI", isActive: true },
  { accountCode: "193.01.001", accountName: "PESIN ODENEN VERGI VE FONLAR", isActive: true },
];

const COMPANY = {
  id: "fixture-runtime",
  companyName: "FIXTURE RESORT AS",
  bankAccounts: [],
};

function legacyRows() {
  return snapshotMovementsToLegacyRows(
    PROD_MOVEMENTS.map((row, i) =>
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
    companyPlans: RUNTIME_PLANS,
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
    legs: mapped.map((m) => ({
      type: m.transactionType,
      account: m.accountCode,
      counter: m.counterAccountCode,
    })),
  };
}

test("RUNTIME REPRO: hint yokken production UI gibi 1/4 · 3 inceleme", () => {
  const legacy = legacyRows();
  assert.equal(canReanalyzeFromCanonicalSnapshot({
    source: { status: "active", movementCount: 4 },
    movements: legacy.map((_, i) => ({ id: `m${i}` })),
  }).ok, true);

  // Fileless reanalyze'de sourceFileName/fileName boş kalınca
  const mapped = mapParsedRowsToStandardMovements(
    legacy,
    ctx({ sourceFileName: "", statementAccountHint: "" })
  );
  const life = applyVadeliMevduatLifecycle(
    mapped,
    ctx({ sourceFileName: "", statementAccountHint: "" })
  );
  const s = summarize(mapped);
  assert.equal(life.applied, false);
  assert.equal(s.matched, 1);
  assert.equal(s.unresolved, 3);
  assert.equal(s.missing, 3);
});

test("RUNTIME: hint + gerçek plan şekli → 4/4 · V005/V001 · yabancı banka yok", () => {
  const legacy = legacyRows();
  const options = ctx({
    sourceFileName: "00158018033466201.pdf",
    statementAccountHint: "00158018033466201",
  });
  const mapped = mapParsedRowsToStandardMovements(legacy, options);
  const life = applyVadeliMevduatLifecycle(mapped, options);
  assert.equal(life.applied, true);

  const byType = Object.fromEntries(mapped.map((m) => [m.transactionType, m]));
  assert.equal(byType[BANK_TRANSACTION_TYPE.VADELI_ACILIS]?.accountCode, "102.10.V005");
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.VADELI_ACILIS]?.counterAccountCode,
    "102.10.V001"
  );
  assert.equal(byType[BANK_TRANSACTION_TYPE.FAIZ_GELIRI]?.accountCode, "102.10.V005");
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.FAIZ_GELIRI]?.counterAccountCode,
    "642.01.001"
  );
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

  // Vadeli↔vadeli yok; Denizbank'a kaçış yok
  for (const m of mapped) {
    assert.notEqual(m.counterAccountCode, "102.10.V005");
    assert.notEqual(m.counterAccountCode, "102.01.004");
    assert.notEqual(m.accountCode, "102.01.004");
  }

  const luca = mapped.flatMap((m) =>
    bankMovementToStandardLucaRows(m, {
      selectedCompany: COMPANY,
      selectedBank: "VAKIFBANK",
    })
  );
  const stats = buildUniqueMovementMissingStats(luca);
  assert.equal(stats.uniqueMatchedMovements, 4);
  assert.equal(stats.uniqueUnresolvedMovements, 0);
  assert.equal(luca.filter(isMissingHesapRow).length, 0);
  assert.equal(luca.length, 8);
  const borc = luca.reduce((s, r) => s + (Number(r.borc) || 0), 0);
  const alacak = luca.reduce((s, r) => s + (Number(r.alacak) || 0), 0);
  assert.ok(Math.abs(borc - alacak) < 0.011);

  const fis = analyzeStandardLucaRows(luca, {
    companyId: COMPANY.id,
    accountPlanCodes: RUNTIME_PLANS.map((p) => p.accountCode),
  });
  assert.equal(fis.summary.hataRowCount, 0);
  assert.equal(fis.summary.gectiRowCount, 8);

  const elektra = buildElektrawebPreviewRows(luca, { selectedCompany: COMPANY });
  assert.equal(elektra.length, 8);
});

test("RUNTIME: banka adı varken diğer banka VADESIZ seçilmez", () => {
  const hit = resolve102RoleFromAccountPlan({
    companyPlans: RUNTIME_PLANS,
    bankName: "VAKIFBANK",
    currency: "TL",
    accountType: "VADESIZ",
    excludeCodes: ["102.10.V005"],
  });
  assert.equal(hit.ok, true);
  assert.equal(hit.code, "102.10.V001");
  assert.notEqual(hit.code, "102.01.004");
});

test("RUNTIME: hint yok + çoklu VADELI → ambiguous, sessiz seçim yok", () => {
  const hit = resolve102RoleFromAccountPlan({
    companyPlans: RUNTIME_PLANS,
    bankName: "VAKIFBANK",
    currency: "TL",
    accountType: "VADELI",
  });
  assert.equal(hit.ok, false);
  assert.equal(hit.ambiguous, true);
});
