/**
 * Production MARE canonical snapshot regresyonu (kimliksiz fixture).
 * Gözlenen prod hatası: banka kartı boş → lifecycle applied:false → 1/4 eşleşme.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-mare-production-canonical-snapshot.mjs
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
  detectVadeliLifecycleBundle,
  resolve102RoleFromAccountPlan,
} from "@/src/utils/vadeliMevduatLifecycle.js";
import {
  canReanalyzeFromCanonicalSnapshot,
  publicBankSnapshotMovementView,
  snapshotMovementsToLegacyRows,
} from "@/src/utils/bankCanonicalSnapshot.js";

/** Production snapshot alanları — firma/source id ve hash yok. */
const PROD_CANONICAL_MOVEMENTS = [
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

const COMPANY_PLANS = [
  { accountCode: "102.10.V001", accountName: "VAKIFBANK VADESIZ TL", isActive: true },
  { accountCode: "102.10.V002", accountName: "VAKIFBANK VADELI TL", isActive: true },
  { accountCode: "642.01.001", accountName: "FAIZ GELIRLERI", isActive: true },
  {
    accountCode: "193.01.001",
    accountName: "PESIN ODENEN VERGI VE FONLAR",
    isActive: true,
  },
  // Gürültü — yanlış eşleşmemeli
  { accountCode: "102.20.001", accountName: "GARANTI VADESIZ TL", isActive: true },
  { accountCode: "120.01.001", accountName: "ALICILAR", isActive: true },
];

const COMPANY_NO_BANKS = {
  id: "fixture-company",
  companyName: "FIXTURE RESORT AS",
  bankAccounts: [],
};

function prodContext(extra = {}) {
  return {
    selectedCompany: COMPANY_NO_BANKS,
    company: COMPANY_NO_BANKS,
    companyId: COMPANY_NO_BANKS.id,
    companyPlans: COMPANY_PLANS,
    selectedBank: "VAKIFBANK",
    // Dosya adından hesap no çıkarımı (workbench reanalyze yolu)
    sourceFileName: "00158018033466201.pdf",
    statementAccountType: "VADELI",
    currency: "TL",
    persistVadeliMemory: false,
    ...extra,
  };
}

function hydrateLegacyRows() {
  const views = PROD_CANONICAL_MOVEMENTS.map((row, i) =>
    publicBankSnapshotMovementView({
      ...row,
      id: `m${i}`,
      source_id: "src-fixture",
      company_id: "fixture-company",
      source_movement_id: `sm-${i}`,
    })
  );
  return snapshotMovementsToLegacyRows(views);
}

test("plan: tek VADELI / tek VADESIZ 102 (banka adı ile)", () => {
  const vadeli = resolve102RoleFromAccountPlan({
    companyPlans: COMPANY_PLANS,
    bankName: "VAKIFBANK",
    currency: "TL",
    accountType: "VADELI",
  });
  const vadesiz = resolve102RoleFromAccountPlan({
    companyPlans: COMPANY_PLANS,
    bankName: "VAKIFBANK",
    currency: "TL",
    accountType: "VADESIZ",
    excludeCodes: [vadeli.code],
  });
  assert.equal(vadeli.ok, true);
  assert.equal(vadeli.code, "102.10.V002");
  assert.equal(vadesiz.ok, true);
  assert.equal(vadesiz.code, "102.10.V001");
});

test("plan: belirsiz çoklu VADESIZ → otomatik seçim yok", () => {
  const plans = [
    ...COMPANY_PLANS,
    {
      accountCode: "102.10.V050",
      accountName: "VAKIFBANK VADESIZ 2 TL",
      isActive: true,
    },
  ];
  const hit = resolve102RoleFromAccountPlan({
    companyPlans: plans,
    bankName: "VAKIFBANK",
    currency: "TL",
    accountType: "VADESIZ",
  });
  assert.equal(hit.ok, false);
  assert.equal(hit.ambiguous, true);
});

test("production snapshot: banka kartı boşken 4/4 eşleşir (plan fallback)", () => {
  const legacy = hydrateLegacyRows();
  assert.equal(legacy.length, 4);

  const can = canReanalyzeFromCanonicalSnapshot({
    source: { status: "active", movementCount: 4 },
    movements: legacy.map((_, i) => ({ id: `m${i}` })),
  });
  assert.equal(can.ok, true);

  const mapped = mapParsedRowsToStandardMovements(legacy, prodContext());
  const life = applyVadeliMevduatLifecycle(mapped, prodContext());
  assert.equal(detectVadeliLifecycleBundle(mapped).ok, true);
  assert.equal(life.applied, true);

  const byType = Object.fromEntries(
    mapped.map((m) => [m.transactionType, m])
  );
  assert.equal(byType[BANK_TRANSACTION_TYPE.VADELI_ACILIS]?.accountCode, "102.10.V002");
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.VADELI_ACILIS]?.counterAccountCode,
    "102.10.V001"
  );
  assert.equal(byType[BANK_TRANSACTION_TYPE.FAIZ_GELIRI]?.accountCode, "102.10.V002");
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.FAIZ_GELIRI]?.counterAccountCode,
    "642.01.001"
  );
  assert.equal(byType[BANK_TRANSACTION_TYPE.FAIZ_STOPAJI]?.accountCode, "102.10.V002");
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.FAIZ_STOPAJI]?.counterAccountCode,
    "193.01.001"
  );
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.VADELI_KAPANIS]?.accountCode,
    "102.10.V002"
  );
  assert.equal(
    byType[BANK_TRANSACTION_TYPE.VADELI_KAPANIS]?.counterAccountCode,
    "102.10.V001"
  );

  // Luca borç/alacak yönleri: stopaj 193 borç / V002 alacak; kapanış V001 borç / V002 alacak
  const luca = mapped.flatMap((m) =>
    bankMovementToStandardLucaRows(m, {
      selectedCompany: COMPANY_NO_BANKS,
      selectedBank: "VAKIFBANK",
    })
  );
  assert.equal(luca.length, 8);
  const borc = luca.reduce((s, r) => s + (Number(r.borc) || 0), 0);
  const alacak = luca.reduce((s, r) => s + (Number(r.alacak) || 0), 0);
  assert.ok(Math.abs(borc - alacak) < 0.011);

  const stats = buildUniqueMovementMissingStats(luca);
  assert.equal(stats.uniqueMatchedMovements, 4);
  assert.equal(stats.uniqueUnresolvedMovements, 0);
  assert.equal(luca.filter(isMissingHesapRow).length, 0);

  const fis = analyzeStandardLucaRows(luca, {
    companyId: COMPANY_NO_BANKS.id,
    accountPlanCodes: COMPANY_PLANS.map((p) => p.accountCode),
  });
  assert.equal(fis.summary.hataRowCount, 0);
  assert.equal(fis.summary.gectiRowCount, 8);

  const elektra = buildElektrawebPreviewRows(luca, {
    selectedCompany: COMPANY_NO_BANKS,
  });
  assert.equal(elektra.length, 8);

  // Snapshot hydrate = mapper sonucu (dosyasız reanalyze aynı giriş)
  assert.equal(mapped.length, 4);
});

test("genel vergi ödemesi (lifecycle dışı) 193’e zorlanmaz", () => {
  const rows = [
    {
      sourceRowId: "t1",
      tarih: "2026-02-01",
      aciklama: "Vergi ödemesi KDV",
      tutar: 1000,
      yon: "CIKIS",
    },
  ];
  const mapped = mapParsedRowsToStandardMovements(rows, prodContext());
  assert.notEqual(mapped[0].counterAccountCode, "193.01.001");
  assert.notEqual(mapped[0].transactionType, BANK_TRANSACTION_TYPE.FAIZ_STOPAJI);
});

test("vadeli→vadeli plan adayı VADESIZ olarak seçilmez", () => {
  const hit = resolve102RoleFromAccountPlan({
    companyPlans: [
      { accountCode: "102.10.V002", accountName: "VAKIFBANK VADELI TL", isActive: true },
      { accountCode: "102.10.V003", accountName: "VAKIFBANK VADELI 2 TL", isActive: true },
    ],
    bankName: "VAKIFBANK",
    currency: "TL",
    accountType: "VADESIZ",
  });
  assert.equal(hit.ok, false);
});
