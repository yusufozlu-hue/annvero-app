/**
 * Sayaç invariant + güvenli eşleştirme regresyon kapıları.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cari-match-counter-invariant.mjs
 */
import assert from "node:assert/strict";
import {
  analyzeMissingHesapRows,
  buildUniqueMovementMissingStats,
  isMissingHesapRow,
} from "@/src/utils/previewExportValidation.js";
import {
  deriveAutoMatchedMovements,
  deriveUnresolvedMovements,
} from "@/src/utils/bankOneClickPipeline.js";
import {
  resolveCariAccountMatch,
  buildCariMatchIndex,
  CARI_MATCH_REASON,
} from "@/src/utils/cariAccountMatcher.js";
import { buildOwnCompanyIdentity } from "@/src/utils/cariCounterpartyExtract.js";
import { mapParsedRowToStandardMovement } from "@/src/utils/bankMovementMapper.js";
import {
  evaluateOwnAccountVirmanTransfer,
  createOwnAccountVirmanContext,
  VIRMAN_STATUS,
} from "@/src/utils/bankInternalTransfer.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("unique movement missing: aynı hareket iki Luca satırında tek sayılır", () => {
  const rows = [
    {
      id: "l1",
      sourceMovementId: "m1",
      hesapKodu: "102.01.001",
      borc: 100,
      alacak: 0,
      fisNo: "1",
      fisTarihi: "01.08.2025",
    },
    {
      id: "l2",
      sourceMovementId: "m1",
      hesapKodu: "",
      riskDurumu: "HESAP_EKSIK",
      borc: 0,
      alacak: 100,
      fisNo: "1",
      fisTarihi: "01.08.2025",
      detayAciklama: "cari yok",
    },
    {
      id: "l3",
      sourceMovementId: "m2",
      hesapKodu: "102.01.001",
      borc: 50,
      fisNo: "2",
      fisTarihi: "02.08.2025",
    },
    {
      id: "l4",
      sourceMovementId: "m2",
      hesapKodu: "120.10.B0001",
      alacak: 50,
      fisNo: "2",
      fisTarihi: "02.08.2025",
    },
  ];

  const report = analyzeMissingHesapRows(rows);
  assert.equal(report.missingLucaRowCount, 1);
  assert.equal(report.uniqueUnresolvedMovements, 1);
  assert.equal(report.uniqueMatchedMovements, 1);
  assert.equal(report.uniqueTotalMovements, 2);
  assert.equal(report.movementMatchInvariantOk, true);
  assert.equal(
    report.uniqueMatchedMovements + report.uniqueUnresolvedMovements,
    report.uniqueTotalMovements
  );

  const auto = deriveAutoMatchedMovements(report.readyCount, {
    uniqueMatchedMovements: report.uniqueMatchedMovements,
  });
  const unresolved = deriveUnresolvedMovements(report.missingCount, {
    uniqueUnresolvedMovements: report.uniqueUnresolvedMovements,
  });
  assert.equal(auto, 1);
  assert.equal(unresolved, 1);
  assert.equal(auto + unresolved, 2);
});

test("çift eksik bacak: movement identity ile tekilleşir", () => {
  const missing = [
    { id: "a", sourceMovementId: "x", hesapKodu: "", riskDurumu: "HESAP_EKSIK" },
    { id: "b", sourceMovementId: "x", hesapKodu: "", riskDurumu: "HESAP_EKSIK" },
  ];
  const stats = buildUniqueMovementMissingStats(
    [
      ...missing,
      { id: "c", sourceMovementId: "y", hesapKodu: "120.1" },
    ],
    missing
  );
  assert.equal(stats.uniqueUnresolvedMovements, 1);
  assert.ok(isMissingHesapRow(missing[0]));
});

test("BİLET unique exact leaf — pipeline/mapper resolved (Uygula şart değil)", () => {
  const plan = [
    { accountCode: "102.01.001", accountName: "VAKIFBANK", isActive: true },
    { accountCode: "120", accountName: "ALICILAR", isActive: true },
    { accountCode: "120.01", accountName: "ALICILAR YURTICI", isActive: true },
    {
      accountCode: "120.01.B0019",
      accountName: "BİLETDÜKKANI TURİZM A.Ş.",
      isActive: true,
    },
    {
      accountCode: "120.10.B0001",
      accountName: "BİLET DÜKKANI TURİZM A.Ş.",
      isActive: true,
    },
  ];
  const index = buildCariMatchIndex(plan);
  const company = {
    id: "firma-mare",
    companyName: "MARE RESORT TURIZM VE OTELCILIK TICARET AS",
    bankAccounts: [
      {
        iban: "TR110001000000000000000001",
        lucaAccountCode: "102.01.001",
        isActive: true,
      },
    ],
  };
  const desc =
    "GLN HVL / TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 SORGU NUMARALI BILETDUK";
  const mapped = mapParsedRowToStandardMovement(
    {
      aciklama: desc,
      tutar: 250,
      yon: "GIRIS",
      tarih: "2025-08-01",
      sourceRowId: "vakif|sheet|42",
    },
    {
      selectedCompany: company,
      selectedCompanyId: company.id,
      selectedBank: "VAKIFBANK",
      companyPlans: plan,
      cariIndex: index,
      learningMemory: [],
      accountMemoryRecords: [],
    }
  );
  assert.equal(mapped.counterAccountCode, "120.10.B0001");
  assert.equal(mapped.cariRequired, true);
  assert.ok(mapped.cariMatchReason);
});

test("BİLET unique exact leaf — hafızasız otomatik (yeniden yükleme)", () => {
  const plan = [
    { accountCode: "120", accountName: "ALICILAR", isActive: true },
    { accountCode: "120.01", accountName: "ALICILAR YURTICI", isActive: true },
    {
      accountCode: "120.01.B0019",
      accountName: "BİLETDÜKKANI TURİZM A.Ş.",
      isActive: true,
    },
    {
      accountCode: "120.10.B0001",
      accountName: "BİLET DÜKKANI TURİZM A.Ş.",
      isActive: true,
    },
  ];
  const index = buildCariMatchIndex(plan);
  const match = resolveCariAccountMatch(plan, {
    description:
      "TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 SORGU NUMARALI BILETDUK",
    direction: "GIRIS",
    ownIdentity: buildOwnCompanyIdentity({
      companyName: "MARE RESORT TURIZM VE OTELCILIK TICARET AS",
    }),
    cariIndex: index,
  });
  assert.equal(match.code, "120.10.B0001");
  assert.equal(match.autoApplied, true);
  assert.equal(match.duplicateAccounts, false);
  assert.equal(match.matchReason, CARI_MATCH_REASON.UNVAN);
});

test("mükerrer BİLET leaf — otomatik seçim yok", () => {
  const plan = [
    { accountCode: "120", accountName: "ALICILAR", isActive: true },
    {
      accountCode: "120.01.B0019",
      accountName: "BİLET DÜKKANI TURİZM A.Ş.",
      isActive: true,
    },
    {
      accountCode: "120.10.B0001",
      accountName: "BİLET DÜKKANI TURİZM A.Ş.",
      isActive: true,
    },
  ];
  const index = buildCariMatchIndex(plan);
  const match = resolveCariAccountMatch(plan, {
    description: "GLN HVL / BILETDUK TAHSILAT",
    direction: "GIRIS",
    ownIdentity: buildOwnCompanyIdentity({ name: "Mare Resort" }),
    cariIndex: index,
  });
  assert.equal(match.code, "");
  assert.equal(match.duplicateAccounts, true);
  assert.ok((match.suggestions || []).length >= 2);
});

test("BİLET hafızası leaf’i parent’a düşmeden uygular", () => {
  const plan = [
    { accountCode: "120", accountName: "ALICILAR", isActive: true },
    { accountCode: "120.01.B0019", accountName: "BİLET DÜKKANI TURİZM A.Ş.", isActive: true },
    { accountCode: "120.10.B0001", accountName: "BİLET DÜKKANI TURİZM A.Ş.", isActive: true },
  ];
  const index = buildCariMatchIndex(plan);
  const match = resolveCariAccountMatch(plan, {
    description: "GLN HVL / BILETDUK TAHSILAT",
    direction: "GIRIS",
    ownIdentity: buildOwnCompanyIdentity({ name: "Mare Resort" }),
    cariIndex: index,
    firmaMemoryRecord: {
      accountCode: "120.10.B0001",
      accountName: "BİLET DÜKKANI TURİZM A.Ş.",
    },
  });
  assert.equal(match.code, "120.10.B0001");
  assert.equal(match.autoApplied, true);
});

test("unvan + maskeli IBAN yalnız → virman adayı değil", () => {
  const company = {
    name: "Mare Resort Turizm A.Ş.",
    bankAccounts: [
      { iban: "TR110001000000000000000001", lucaAccountCode: "102.01.001", isActive: true },
    ],
  };
  const verdict = evaluateOwnAccountVirmanTransfer(
    {
      detayAciklama:
        "TARIHLI SORGU NO LU MARE RESORT TURIZM VE OTELCILIK TICARET AS HESABI AVUKATLIK UCRETI",
      transactionType: "GIDEN_HAVALE",
    },
    {
      ownAccountContext: createOwnAccountVirmanContext(company, "VAKIFBANK"),
      selectedCompany: company,
      selectedBank: "VAKIFBANK",
    }
  );
  assert.notEqual(verdict.status, VIRMAN_STATUS.CANDIDATE);
  assert.equal(Boolean(verdict.isVirmanCandidate), false);
});

console.log("PASS all cari-match-counter-invariant");
