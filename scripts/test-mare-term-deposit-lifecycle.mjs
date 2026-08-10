/**
 * MARE vadeli mevduat yaşam döngüsü — golden + güvenlik testleri.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-mare-term-deposit-lifecycle.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mapParsedRowsToStandardMovements } from "@/src/utils/bankMovementMapper.js";
import { bankMovementToStandardLucaRows } from "@/src/utils/standardLucaRow.js";
import { buildElektrawebPreviewRows } from "@/src/utils/standardLucaRow.js";
import {
  buildUniqueMovementMissingStats,
  isMissingHesapRow,
} from "@/src/utils/previewExportValidation.js";
import { analyzeStandardLucaRows } from "@/src/utils/fisKontrolMerkezi.js";
import { BANK_TRANSACTION_TYPE } from "@/src/utils/bankTransactionType.js";
import { isTaxObligationMissingRow } from "@/src/utils/cariMissingResolutionGroups.js";
import {
  detectAndClassifyBankInternalTransfer,
  resolveVirman102Pair,
} from "@/src/utils/bankInternalTransfer.js";
import {
  buildVadeliLifecycleMemoryRecords,
  detectVadeliLifecycleBundle,
  isForbiddenVadeliMemorySuggestion,
  isVadeliToVadeliTransfer,
  resolveStatementBankAccount,
  resolveVadesizCounter102,
} from "@/src/utils/vadeliMevduatLifecycle.js";
import {
  matchesVadeliLifecycleAmounts,
} from "@/src/utils/faizStopajiClassify.js";
import {
  canReanalyzeFromCanonicalSnapshot,
  sanitizeIncomingSnapshotBody,
  buildSnapshotMovementsFromRows,
  publicBankSnapshotSourceView,
  publicBankSnapshotMovementView,
  assertNoRawBankSnapshotLeak,
} from "@/src/utils/bankCanonicalSnapshot.js";

const MARE_ID = "84384297-270c-47cd-ac5a-d693ba80b84a";

const MARE_COMPANY = {
  id: MARE_ID,
  name: "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş",
  companyName: "MARE",
  bankAccounts: [
    {
      bankName: "VAKIFBANK",
      accountType: "VADELI",
      lucaAccountCode: "102.10.V002",
      accountNumber: "00158018033466201",
      currency: "TL",
      isActive: true,
    },
    {
      bankName: "VAKIFBANK",
      accountType: "VADESIZ",
      lucaAccountCode: "102.10.V001",
      accountNumber: "158007308428449",
      iban: "TR820001500158007308428449",
      currency: "TL",
      isActive: true,
    },
  ],
};

const COMPANY_PLANS = [
  { accountCode: "102.10.V001", accountName: "VAKIF VADESIZ", isActive: true },
  { accountCode: "102.10.V002", accountName: "VAKIF VADELI", isActive: true },
  { accountCode: "642.01.001", accountName: "FAİZ GELİRLERİ", isActive: true },
  {
    accountCode: "193.01.001",
    accountName: "PEŞİN ÖDENEN VERGİ VE FONLAR",
    isActive: true,
  },
];

const MARE_ROWS = [
  {
    sourceRowId: "o1",
    tarih: "2025-12-26",
    aciklama: "Vadeli Mevduat Hesap Açma",
    tutar: 1018500,
    yon: "GIRIS",
    hesapNo: "00158018033466201",
  },
  {
    sourceRowId: "f1",
    tarih: "2026-01-27",
    aciklama: "Mevduat Faiz Tahakkuku",
    tutar: 33931.4,
    yon: "GIRIS",
    hesapNo: "00158018033466201",
  },
  {
    sourceRowId: "s1",
    tarih: "2026-01-27",
    aciklama: "Vergi ödemesi",
    tutar: 5938,
    yon: "CIKIS",
    hesapNo: "00158018033466201",
  },
  {
    sourceRowId: "c1",
    tarih: "2026-01-27",
    aciklama: "Hesap Kapatma",
    tutar: 1046493.4,
    yon: "CIKIS",
    hesapNo: "00158018033466201",
  },
];

function mareContext(extra = {}) {
  return {
    selectedCompany: MARE_COMPANY,
    company: MARE_COMPANY,
    companyId: MARE_ID,
    companyPlans: COMPANY_PLANS,
    selectedBank: "VAKIFBANK",
    statementAccountHint: "00158018033466201",
    statementAccountType: "VADELI",
    currency: "TL",
    persistVadeliMemory: false,
    ...extra,
  };
}

function bySource(movements, id) {
  return movements.find((m) => m.sourceMovementId === id || m.sourceRowId === id);
}

test("tutar yaşam döngüsü: principal + faiz − stopaj = kapanış", () => {
  const life = matchesVadeliLifecycleAmounts(
    [
      { description: "Vadeli Mevduat Hesap Açma", direction: "GIRIS", amount: 1018500 },
      {
        description: "Mevduat Faiz Tahakkuku",
        direction: "GIRIS",
        amount: 33931.4,
        transactionType: "FAIZ_GELIRI",
      },
      { description: "Vergi ödemesi", direction: "CIKIS", amount: 5938 },
      { description: "Hesap Kapatma", direction: "CIKIS", amount: 1046493.4 },
    ],
    { amount: 5938, direction: "CIKIS", description: "Vergi ödemesi" },
    {
      amount: 33931.4,
      direction: "GIRIS",
      description: "Mevduat Faiz Tahakkuku",
      transactionType: "FAIZ_GELIRI",
    }
  );
  assert.equal(life.ok, true);
  assert.equal(Math.round((1018500 + 33931.4 - 5938) * 100) / 100, 1046493.4);
});

test("statement hesabı hesap no ile bağlanır; banka adı .find() değil", () => {
  const hit = resolveStatementBankAccount({
    company: MARE_COMPANY,
    accountNumber: "00158018033466201",
    bankName: "VAKIFBANK",
    currency: "TL",
    accountType: "VADELI",
  });
  assert.equal(hit.ok, true);
  assert.equal(hit.code, "102.10.V002");
  assert.equal(hit.accountType, "VADELI");
});

test("tek kesin VADESIZ 102 → 102.10.V001", () => {
  const v = resolveVadesizCounter102({
    company: MARE_COMPANY,
    sourceBank: MARE_COMPANY.bankAccounts[0],
    currency: "TL",
    bankName: "VAKIFBANK",
  });
  assert.equal(v.ok, true);
  assert.equal(v.code, "102.10.V001");
});

test("birden fazla belirsiz vadesiz adayda otomatik seçim yok", () => {
  const company = {
    ...MARE_COMPANY,
    bankAccounts: [
      ...MARE_COMPANY.bankAccounts,
      {
        bankName: "VAKIFBANK",
        accountType: "VADESIZ",
        lucaAccountCode: "102.10.V099",
        accountNumber: "9999999999",
        currency: "TL",
        isActive: true,
      },
    ],
  };
  const v = resolveVadesizCounter102({
    company,
    sourceBank: company.bankAccounts[0],
    currency: "TL",
    bankName: "VAKIFBANK",
  });
  assert.equal(v.ok, false);
  assert.equal(v.ambiguous, true);
});

test("vadeli→vadeli hard-block + aynı hesap kendi karşı hesabı olamaz", () => {
  const vadeliA = MARE_COMPANY.bankAccounts[0];
  const vadeliB = {
    bankName: "VAKIFBANK",
    accountType: "VADELI",
    lucaAccountCode: "102.10.V003",
    accountNumber: "00158019999999999",
    iban: "TR110001500158019999999999",
    currency: "TL",
    isActive: true,
  };
  assert.equal(isVadeliToVadeliTransfer(vadeliA, vadeliB), true);
  assert.equal(
    isVadeliToVadeliTransfer(vadeliA, MARE_COMPANY.bankAccounts[1]),
    false
  );

  const company = {
    ...MARE_COMPANY,
    bankAccounts: [...MARE_COMPANY.bankAccounts, vadeliB],
  };
  const pair = resolveVirman102Pair({
    company,
    selectedBank: "VAKIFBANK",
    description: `Hesaplar arasi virman TR110001500158019999999999 00158019999999999`,
    direction: "CIKIS",
    bankAccountCode: "102.10.V002",
    row: {
      detayAciklama: `Hesaplar arasi virman TR110001500158019999999999`,
      karsiIban: "TR110001500158019999999999",
    },
  });
  assert.equal(pair.complete, false);
  assert.ok(
    (pair.reasons || []).includes("vadeli_to_vadeli_blocked") ||
      String(pair.missingReason || "").includes("Vadeli") ||
      String(pair.label || "").includes("Vadeli"),
    `expected vadeli block, got ${JSON.stringify({
      reasons: pair.reasons,
      missingReason: pair.missingReason,
      label: pair.label,
      status: pair.status,
    })}`
  );

  const same = resolveVirman102Pair({
    company: MARE_COMPANY,
    selectedBank: "VAKIFBANK",
    description: "Virman TR820001500158007308428449",
    direction: "CIKIS",
    bankAccountCode: "102.10.V001",
    row: {
      detayAciklama: "Virman TR820001500158007308428449",
      karsiIban: "TR820001500158007308428449",
    },
  });
  assert.equal(same.complete, false);
});

test("MARE golden: 4 tip + hesaplar + inceleme 0 + 8 Luca", () => {
  const movements = mapParsedRowsToStandardMovements(MARE_ROWS, mareContext());
  assert.equal(movements.length, 4);

  const open = bySource(movements, "o1");
  const faiz = bySource(movements, "f1");
  const stopaj = bySource(movements, "s1");
  const close = bySource(movements, "c1");

  assert.equal(open.transactionType, BANK_TRANSACTION_TYPE.VADELI_ACILIS);
  assert.equal(close.transactionType, BANK_TRANSACTION_TYPE.VADELI_KAPANIS);
  assert.equal(faiz.transactionType, BANK_TRANSACTION_TYPE.FAIZ_GELIRI);
  assert.equal(stopaj.transactionType, BANK_TRANSACTION_TYPE.FAIZ_STOPAJI);
  assert.equal(isTaxObligationMissingRow(stopaj), false);

  assert.equal(open.accountCode, "102.10.V002");
  assert.equal(open.counterAccountCode, "102.10.V001");
  assert.equal(close.accountCode, "102.10.V002");
  assert.equal(close.counterAccountCode, "102.10.V001");
  assert.equal(faiz.counterAccountCode, "642.01.001");
  assert.equal(stopaj.counterAccountCode, "193.01.001");

  const luca = movements.flatMap((m) =>
    bankMovementToStandardLucaRows(m, {
      selectedCompany: MARE_COMPANY,
      selectedBank: "VAKIFBANK",
    })
  );
  assert.equal(luca.length, 8);

  const legs = [
    { desc: "açılış", borc: "102.10.V002", alacak: "102.10.V001", tutar: 1018500 },
    { desc: "faiz", borc: "102.10.V002", alacak: "642.01.001", tutar: 33931.4 },
    { desc: "stopaj", borc: "193.01.001", alacak: "102.10.V002", tutar: 5938 },
    { desc: "kapanış", borc: "102.10.V001", alacak: "102.10.V002", tutar: 1046493.4 },
  ];
  for (const expected of legs) {
    const debit = luca.find(
      (r) =>
        String(r.hesapKodu) === expected.borc &&
        Number(r.borc) === expected.tutar
    );
    const credit = luca.find(
      (r) =>
        String(r.hesapKodu) === expected.alacak &&
        Number(r.alacak) === expected.tutar
    );
    assert.ok(debit, `borç eksik: ${expected.desc}`);
    assert.ok(credit, `alacak eksik: ${expected.desc}`);
  }

  // Vadeli↔vadeli 102 çifti yok
  for (let i = 0; i < luca.length; i += 2) {
    const a = String(luca[i]?.hesapKodu || "");
    const b = String(luca[i + 1]?.hesapKodu || "");
    if (a.startsWith("102") && b.startsWith("102")) {
      assert.notEqual(a, "102.10.V002" === b && b === "102.10.V002" ? a : "");
      const codes = [a, b].sort();
      assert.ok(
        !(codes[0] === "102.10.V002" && codes[1] === "102.10.V002"),
        "vadeli↔vadeli yok"
      );
      assert.ok(
        codes.includes("102.10.V001") || !codes.every((c) => c.startsWith("102.10.V00")),
        "102 çifti vadesiz içermeli"
      );
    }
  }
  const vadeliOnlyPairs = [];
  for (const m of movements) {
    if (
      String(m.accountCode) === "102.10.V002" &&
      String(m.counterAccountCode) === "102.10.V002"
    ) {
      vadeliOnlyPairs.push(m);
    }
  }
  assert.equal(vadeliOnlyPairs.length, 0);

  const missing = luca.filter((r) => isMissingHesapRow(r));
  assert.equal(missing.length, 0);
  const stats = buildUniqueMovementMissingStats(luca);
  assert.equal(stats.uniqueUnresolvedMovements, 0);
  assert.equal(stats.uniqueMatchedMovements, 4);

  const borcToplam = luca.reduce((s, r) => s + (Number(r.borc) || 0), 0);
  const alacakToplam = luca.reduce((s, r) => s + (Number(r.alacak) || 0), 0);
  assert.equal(borcToplam, alacakToplam);

  const fis = analyzeStandardLucaRows(luca, {
    companyId: MARE_ID,
    firmaId: MARE_ID,
    accountPlanCodes: COMPANY_PLANS.map((p) => p.accountCode),
  });
  assert.ok(fis?.rows?.length);
  assert.equal(fis.summary.hataRowCount, 0);
  assert.equal(fis.summary.gectiRowCount, fis.rows.length);
  for (const row of fis.rows) {
    assert.equal(row._kontrol?.kontrolDurumu, "Geçti");
  }
  // lowConfidence / critical — issue tiplerinden
  const criticalIssues = (fis.issues || []).filter(
    (i) => i.seviye === "Hata" || i.seviye === "HATA"
  );
  assert.equal(criticalIssues.length, 0);

  const elektra = buildElektrawebPreviewRows(luca, {
    selectedCompany: MARE_COMPANY,
  });
  assert.ok(Array.isArray(elektra));
  assert.ok(elektra.length >= 4);
});

test("lifecycle dışı genel Vergi ödemesi 193'e gitmez", () => {
  const rows = [
    {
      sourceRowId: "t1",
      tarih: "2026-01-27",
      aciklama: "Vergi ödemesi",
      tutar: 5000,
      yon: "CIKIS",
    },
  ];
  const movements = mapParsedRowsToStandardMovements(rows, mareContext());
  assert.equal(movements.length, 1);
  assert.notEqual(movements[0].transactionType, BANK_TRANSACTION_TYPE.FAIZ_STOPAJI);
  assert.notEqual(movements[0].counterAccountCode, "193.01.001");
});

test("hafıza firma-scoped; vadeli→vadeli yasak; başka firmaya sızmaz", () => {
  const records = buildVadeliLifecycleMemoryRecords({
    companyId: MARE_ID,
    bankName: "VAKIFBANK",
    currency: "TL",
    statementAccountType: "VADELI",
    statementCode: "102.10.V002",
    vadesizCode: "102.10.V001",
    faizCode: "642.01.001",
    stopajCode: "193.01.001",
  });
  assert.ok(records.length >= 4);
  for (const rec of records) {
    assert.equal(rec.companyId, MARE_ID);
    assert.ok(String(rec.analysisKey).includes(MARE_ID));
    assert.ok(String(rec.analysisKey).includes("VAKIFBANK") || String(rec.analysisKey).includes("VAKIF"));
    assert.ok(String(rec.analysisKey).includes("TL"));
  }
  assert.equal(
    isForbiddenVadeliMemorySuggestion({
      statementAccountType: "VADELI",
      suggestedAccountCode: "102.10.V002",
      company: MARE_COMPANY,
    }),
    true
  );
  assert.equal(
    isForbiddenVadeliMemorySuggestion({
      statementAccountType: "VADELI",
      suggestedAccountCode: "102.10.V001",
      company: MARE_COMPANY,
    }),
    false
  );

  const other = buildVadeliLifecycleMemoryRecords({
    companyId: "00000000-0000-4000-8000-000000000099",
    bankName: "VAKIFBANK",
    currency: "TL",
    statementCode: "102.10.V002",
    vadesizCode: "102.10.V001",
    faizCode: "642.01.001",
    stopajCode: "193.01.001",
  });
  assert.ok(other.every((r) => r.companyId !== MARE_ID));
  assert.ok(other.every((r) => !String(r.analysisKey).includes(MARE_ID)));
});

test("canonical snapshot: 1 source / 4 movement; yeni drive/job yok", () => {
  const movements = mapParsedRowsToStandardMovements(MARE_ROWS, mareContext());
  const snapshotMovements = buildSnapshotMovementsFromRows(
    movements.map((m) => ({
      ...m,
      aciklama: m.description,
      tutar: m.amount,
      yon: m.direction,
    }))
  );
  assert.equal(snapshotMovements.length, 4);
  const body = sanitizeIncomingSnapshotBody({
    companyId: MARE_ID,
    source: {
      id: "src-1",
      contentHash: "abc",
      bankName: "VAKIFBANK",
      statementAccountHint: "00158018033466201",
    },
    movements: snapshotMovements,
  });
  assert.equal((body.movements || []).length, 4);
  assert.ok(body.source);
  const sourceView = publicBankSnapshotSourceView(body.source);
  const movementViews = (body.movements || []).map(publicBankSnapshotMovementView);
  assert.equal(movementViews.length, 4);
  assertNoRawBankSnapshotLeak({ source: sourceView, movements: movementViews });
  const canRe = canReanalyzeFromCanonicalSnapshot({
    source: { ...body.source, movementCount: 4 },
    movements: body.movements,
    companyId: MARE_ID,
  });
  assert.equal(canRe.ok, true);
  assert.equal(canRe.movementCount, 4);
  // Dosyasız reanalysis: ham PDF / yeni drive job yok
  assert.ok(!body.rawPdf && !body.pdfBytes);
  assert.ok(!body.driveFileId);
  assert.ok(!body.jobId);
});

test("detectVadeliLifecycleBundle MARE tutarlarını bağlar", () => {
  const mapped = MARE_ROWS.map((r) => ({
    ...r,
    description: r.aciklama,
    amount: r.tutar,
    direction: r.yon,
    transactionType:
      r.sourceRowId === "f1" ? BANK_TRANSACTION_TYPE.FAIZ_GELIRI : undefined,
  }));
  const bundle = detectVadeliLifecycleBundle(mapped);
  assert.equal(bundle.ok, true);
  assert.equal(bundle.principal, 1018500);
  assert.equal(bundle.faizAmount, 33931.4);
  assert.equal(bundle.stopajAmount, 5938);
  assert.equal(bundle.closing, 1046493.4);
});

test("genel havale/EFT vadeli hard-block'tan etkilenmez (external)", () => {
  const detect = detectAndClassifyBankInternalTransfer({
    description: "Giden havale ACME TURIZM A.S.",
    direction: "CIKIS",
    transactionType: BANK_TRANSACTION_TYPE.GIDEN_HAVALE,
    selectedCompany: MARE_COMPANY,
    selectedBank: "VAKIFBANK",
    bankAccountCode: "102.10.V001",
    rawRow: { aciklama: "Giden havale ACME TURIZM A.S." },
  });
  assert.equal(detect.isBankInternalTransfer, false);
  assert.equal(detect.shouldReclassify, false);
});

console.log("OK: test-mare-term-deposit-lifecycle");
