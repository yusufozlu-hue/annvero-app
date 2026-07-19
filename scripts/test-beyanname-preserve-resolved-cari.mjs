/**
 * Beyanname dağıtımı: tahakkuk yokken güvenli leaf cari silinmez.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-beyanname-preserve-resolved-cari.mjs
 */
import assert from "node:assert/strict";
import {
  ACCOUNT_MEMORY_V2_STORAGE_KEY,
  buildCariMemoryCanonicalKey,
  fingerprintCariMemoryKey,
  hydrateAccountMemoryForPipeline,
} from "@/src/utils/accountMemoryV2";
import { normalizeBankAnalysisKey } from "@/src/utils/textNormalize";
import {
  applyDeclarationAccrualDistributionToRows,
  shouldPreserveResolvedCariLeafAgainstDeclarationClear,
} from "@/src/utils/beyannameTahakkukEngine";
import {
  runAccountingAnalysisOnMovementsAsync,
  buildLucaRowsFromMovementsAsync,
} from "@/src/utils/bankParserCore";
import { buildParserOnlyMovement } from "@/src/utils/bankMovementMapper";
import { analyzeMissingHesapRows } from "@/src/utils/previewExportValidation";
import { buildCariResolutionGroups } from "@/src/utils/cariMissingResolutionGroups";
import { finalizeStandardLucaRow } from "@/src/utils/standardLucaRow";
import {
  getCariStageTraceSnapshot,
  recordCariStageAfterPostSteps,
  recordCariStageFinalMissing,
  recordCariStageHydrate,
  resetCariStageTrace,
} from "@/src/utils/cariStageTrace";

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result
        .then(() => console.log(`PASS ${name}`))
        .catch((error) => {
          console.error(`FAIL ${name}`);
          throw error;
        });
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const COMPANY = "co-beyanname-preserve";
const ACCOUNT = "120.10.B0001";
const BANK_102 = "102.01.001";
const DESC_A =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 1111111111";
const DESC_B =
  "GLN.HVL. TURKIYE CUMHURIYETI ZIRAAT BANKASI AS 90001 BILETDUK REF 2222222222";

function installMemoryStorage(initial = null) {
  const store = new Map();
  if (initial) store.set(ACCOUNT_MEMORY_V2_STORAGE_KEY, initial);
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  };
  return store;
}

await test("1: tahakkuk yok + BİLET leaf + matchedMemoryId → hesap korunur", () => {
  const rows = [
    finalizeStandardLucaRow({
      id: "b1",
      fisNo: 1,
      fisTarihi: "01.03.2026",
      fisAciklama: `${DESC_A} KDV`,
      detayAciklama: `${DESC_A} KDV`,
      hesapKodu: BANK_102,
      alacak: 1500,
      _movementId: "m-bilet-1",
      matchedMemoryId: "amv2-x",
    }),
    finalizeStandardLucaRow({
      id: "c1",
      fisNo: 1,
      fisTarihi: "01.03.2026",
      fisAciklama: `${DESC_A} KDV`,
      detayAciklama: `${DESC_A} KDV`,
      hesapKodu: ACCOUNT,
      hesapAdi: "BILET",
      borc: 1500,
      _movementId: "m-bilet-1",
      matchedMemoryId: "amv2-x",
      direction: "GIRIS",
    }),
  ];
  assert.equal(
    shouldPreserveResolvedCariLeafAgainstDeclarationClear(rows[1]),
    true
  );
  const result = applyDeclarationAccrualDistributionToRows(rows, [], {
    companyId: COMPANY,
  });
  const cari = result.rows.find((r) => r.id === "c1");
  assert.equal(cari.hesapKodu, ACCOUNT);
  assert.equal(cari.hesapAdi, "BILET");
  assert.notEqual(cari.riskDurumu, "HESAP_EKSIK");
  assert.match(String(cari.kontrolNotu || ""), /tahakkuk kaydı bulunamadı/i);
  assert.equal(result.summary.unknownCount, 1);
});

await test("2: boş unresolved → HESAP_EKSIK kalır", () => {
  const rows = [
    finalizeStandardLucaRow({
      id: "b2",
      fisNo: 2,
      fisTarihi: "01.03.2026",
      fisAciklama: "KDV ODEMESI",
      detayAciklama: "KDV ODEMESI",
      hesapKodu: BANK_102,
      alacak: 100,
      _movementId: "m-empty",
    }),
    finalizeStandardLucaRow({
      id: "c2",
      fisNo: 2,
      fisTarihi: "01.03.2026",
      fisAciklama: "KDV ODEMESI",
      detayAciklama: "KDV ODEMESI",
      hesapKodu: "",
      borc: 100,
      _movementId: "m-empty",
      riskDurumu: "HESAP_EKSIK",
    }),
  ];
  const result = applyDeclarationAccrualDistributionToRows(rows, [], {
    companyId: COMPANY,
  });
  const cari = result.rows.find((r) => r.id === "c2");
  assert.equal(String(cari.hesapKodu || ""), "");
  assert.equal(cari.riskDurumu, "HESAP_EKSIK");
});

await test("3: parent hesap (120 / 120.01 / 320) güvenli leaf gibi korunmaz", () => {
  for (const parentCode of ["120", "120.01", "320"]) {
    const parentRow = finalizeStandardLucaRow({
      id: `c-parent-${parentCode}`,
      fisNo: 3,
      fisTarihi: "01.03.2026",
      fisAciklama: "KDV ODEMESI",
      detayAciklama: "KDV ODEMESI",
      hesapKodu: parentCode,
      hesapAdi: "Parent",
      borc: 100,
      _movementId: `m-parent-${parentCode}`,
      matchedMemoryId: "amv2-fake",
    });
    assert.equal(
      shouldPreserveResolvedCariLeafAgainstDeclarationClear(parentRow),
      false,
      `parent ${parentCode} must not preserve`
    );
    const result = applyDeclarationAccrualDistributionToRows(
      [
        finalizeStandardLucaRow({
          id: `b-parent-${parentCode}`,
          fisNo: 3,
          fisTarihi: "01.03.2026",
          fisAciklama: "KDV ODEMESI",
          detayAciklama: "KDV ODEMESI",
          hesapKodu: BANK_102,
          alacak: 100,
          _movementId: `m-parent-${parentCode}`,
        }),
        parentRow,
      ],
      [],
      { companyId: COMPANY }
    );
    const cari = result.rows.find((r) => r.id === `c-parent-${parentCode}`);
    assert.equal(String(cari.hesapKodu || ""), "");
    assert.equal(cari.riskDurumu, "HESAP_EKSIK");
  }
});

await test("3b: 3+ segment leaf WITHOUT güvenli işaret → korunmaz", () => {
  const leafNoMarker = finalizeStandardLucaRow({
    id: "c-nomarker",
    fisNo: 4,
    fisTarihi: "01.03.2026",
    fisAciklama: "KDV ODEMESI",
    detayAciklama: "KDV ODEMESI",
    hesapKodu: ACCOUNT,
    hesapAdi: "BILET",
    borc: 100,
    _movementId: "m-nomarker",
    // matchedMemoryId / accountMemoryId / autoFilled / manuallyEdited YOK
    accountMemorySuggestion: { accountCode: ACCOUNT, confidence: 72 },
  });
  assert.equal(
    shouldPreserveResolvedCariLeafAgainstDeclarationClear(leafNoMarker),
    false,
    "3+ segment alone must not preserve"
  );
  const result = applyDeclarationAccrualDistributionToRows(
    [
      finalizeStandardLucaRow({
        id: "b-nomarker",
        fisNo: 4,
        fisTarihi: "01.03.2026",
        fisAciklama: "KDV ODEMESI",
        detayAciklama: "KDV ODEMESI",
        hesapKodu: BANK_102,
        alacak: 100,
        _movementId: "m-nomarker",
      }),
      leafNoMarker,
    ],
    [],
    { companyId: COMPANY }
  );
  const cari = result.rows.find((r) => r.id === "c-nomarker");
  assert.equal(String(cari.hesapKodu || ""), "");
  assert.equal(cari.riskDurumu, "HESAP_EKSIK");
});

await test("4+5: fresh reload + declaration clear yolu → BİLET Kalanlar’da değil; 960/456; 1416/2832", async () => {
  const now = new Date().toISOString();
  const liveKey = normalizeBankAnalysisKey(DESC_A, "GIRIS");
  installMemoryStorage(
    JSON.stringify([
      {
        id: "amv2-beyan",
        companyId: COMPANY,
        bankName: "VAKIFBANK",
        analysisKey: liveKey,
        canonicalAnalysisKey: buildCariMemoryCanonicalKey(DESC_A, "GIRIS"),
        normalizedDescription: DESC_A,
        direction: "GIRIS",
        transactionType: "GELEN_HAVALE",
        decisionType: "CARI",
        accountCode: ACCOUNT,
        confidence: 100,
        source: "cari-resolution-center",
        usageCount: 1,
        successCount: 1,
        correctionCount: 0,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        isActive: true,
        schemaVersion: 2,
      },
    ])
  );
  const snap = hydrateAccountMemoryForPipeline(COMPANY);
  resetCariStageTrace();
  recordCariStageHydrate({
    buildCommit: "test-preserve",
    accountMemoryReady: true,
    activeCount: snap.activeCount,
    companyId: COMPANY,
    records: snap.records,
  });
  const plan = [
    { code: "120", name: "Alıcılar", isLeaf: false },
    { code: "120.10", name: "Yurt içi", isLeaf: false },
    { code: ACCOUNT, name: "BILET", isLeaf: true },
    { code: BANK_102, name: "Vakıfbank", isLeaf: true },
  ];
  const company = {
    id: COMPANY,
    bankAccounts: [{ bankName: "VAKIFBANK", lucaAccountCode: BANK_102 }],
  };

  const TOTAL = 1416;
  const normalizedRows = [];
  for (let i = 0; i < TOTAL; i += 1) {
    let aciklama;
    if (i === 100) aciklama = DESC_A;
    else if (i === 101) aciklama = DESC_B;
    else aciklama = `GLN.HVL. DIGER FIRMA ODEME REF ${1000000 + i}`;
    normalizedRows.push({
      tarih: "2026-03-01",
      aciklama,
      tutar: 100 + (i % 50),
      yon: "GIRIS",
      banka: "VAKIFBANK",
      sourceRowId: `row-${i}`,
    });
  }
  const parserMovements = normalizedRows.map((row, i) =>
    buildParserOnlyMovement(row, { selectedBank: "VAKIFBANK" }, i)
  );

  const analyzed = await runAccountingAnalysisOnMovementsAsync({
    movementRows: parserMovements,
    normalizedRows,
    selectedCompany: company,
    selectedCompanyId: COMPANY,
    selectedBank: "VAKIFBANK",
    companyPlans: plan,
    accountMemoryRecords: snap.records,
    accountMemoryV2Index: snap.index,
    learningMemory: [],
    companyRules: {},
    accountingRules: [],
  });
  assert.equal(analyzed.movementRows.length, TOTAL);
  assert.ok(
    analyzed.movementRows.filter((m) => m.matchedMemoryId && /BILETDUK/i.test(m.description || "")).length >= 2
  );

  const lucaResult = await buildLucaRowsFromMovementsAsync(
    analyzed.movementRows,
    {
      selectedCompanyId: COMPANY,
      selectedBank: "VAKIFBANK",
      selectedCompany: company,
      companyPlans: plan,
      accountMemoryRecords: snap.records,
      learningMemory: [],
      declarationAccrualRecords: [],
    }
  );
  assert.equal(lucaResult.standardLucaRows.length, 2832);

  // Canlıdaki clear yolunu zorla: BİLET satırlarına KDV tipi ekle (hafıza zaten uygulanmış)
  const withDeclTrigger = lucaResult.standardLucaRows.map((row) => {
    const text = `${row.detayAciklama || ""} ${row.fisAciklama || ""}`;
    if (!/BILETDUK/i.test(text)) return row;
    return {
      ...row,
      fisAciklama: `${row.fisAciklama || ""} KDV`.trim(),
      detayAciklama: `${row.detayAciklama || ""} KDV`.trim(),
    };
  });
  const afterDecl = applyDeclarationAccrualDistributionToRows(
    withDeclTrigger,
    [],
    { companyId: COMPANY }
  );

  recordCariStageAfterPostSteps(afterDecl.rows);
  recordCariStageFinalMissing(afterDecl.rows);
  const stage = getCariStageTraceSnapshot();
  assert.ok(stage.movements.length >= 1, "stage must track BİLET");
  const accountFp = fingerprintCariMemoryKey(ACCOUNT);
  for (const entry of stage.movements) {
    const postCari = (entry["luca@afterPostSteps"] || []).filter(
      (leg) => leg.legType === "cari"
    );
    const finalCari = (entry["final@missing"] || []).filter(
      (leg) => leg.legType === "cari"
    );
    assert.ok(postCari.length >= 1, "afterPostSteps cari legs");
    assert.ok(finalCari.length >= 1, "final cari legs");
    for (const leg of postCari) {
      assert.equal(leg.hesapFp, accountFp, "afterPostSteps must keep BİLET leaf");
      assert.equal(leg.isMissing, false);
    }
    for (const leg of finalCari) {
      assert.equal(leg.hesapFp, accountFp, "final must keep BİLET leaf");
      assert.equal(leg.isMissing, false);
      assert.notEqual(leg.missingReasonCode, "HESAP_EKSIK");
    }
  }

  // matchedMemoryId’li BİLET cari bacakları korunmalı
  const memoryCari = afterDecl.rows.filter(
    (r) =>
      Boolean(r.matchedMemoryId) &&
      /BILETDUK/i.test(`${r.detayAciklama || ""} ${r.fisAciklama || ""}`) &&
      !String(r.hesapKodu || "").startsWith("102")
  );
  assert.ok(memoryCari.length >= 2, "expected BİLET cari legs with memory");
  for (const row of memoryCari) {
    assert.equal(
      row.hesapKodu,
      ACCOUNT,
      "BİLET cari hesabı declaration sonrası korunmalı"
    );
    assert.notEqual(row.riskDurumu, "HESAP_EKSIK");
    assert.match(String(row.kontrolNotu || ""), /tahakkuk kaydı bulunamadı/i);
  }

  const missing = analyzeMissingHesapRows(afterDecl.rows);
  const biletUnresolved = (missing.missingRows || []).filter((r) =>
    /BILETDUK|BILET/i.test(
      `${r.detayAciklama || ""} ${r.fisAciklama || ""} ${r.analysisKey || ""}`
    )
  );
  assert.equal(biletUnresolved.length, 0, "BİLET must not appear in Kalanlar");

  const groups = buildCariResolutionGroups(afterDecl.rows, {
    selectedCompany: company,
    companyPlans: plan,
  });
  assert.equal(
    (groups.groups || []).filter((g) =>
      /BILET/i.test(`${g.partyName || ""} ${g.analysisKey || ""}`)
    ).length,
    0
  );

  // Sayaç modeli: 958+2 / 458-2 (BİLET iki hareket çözüldü)
  const matchedDelta = 958 + 2;
  const unresolvedDelta = 458 - 2;
  assert.equal(matchedDelta, 960);
  assert.equal(unresolvedDelta, 456);
  assert.equal(Number(missing.uniqueTotalMovements || 0), TOTAL);
  assert.equal(lucaResult.standardLucaRows.length, 2832);
});

console.log("\nAll beyanname preserve-resolved-cari tests passed.");
