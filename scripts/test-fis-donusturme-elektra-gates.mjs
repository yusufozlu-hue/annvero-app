/**
 * Fiş Dönüştürme Merkezi — Elektra tek ekran kapıları (B seçeneği).
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-fis-donusturme-elektra-gates.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import {
  assertFisDonusturmeLucaProducerTransferAllowed,
  isFisDonusturmeElektrawebSource,
  prepareFisDonusturmeLucaExcelFiles,
  resolveFisDonusturmeDisplayRiskSeviyesi,
  shouldShowFisDonusturmeRiskPill,
  FIS_DONUSTURME_ELEKTRA_TRANSFER_DISABLED_CODE,
} from "../src/utils/fisDonusturmeElektraGates.js";
import { publishFisDonusturmeTransfer } from "../src/utils/canonicalFisControlTransfer.js";
import { processElektrawebWorkbook } from "../src/utils/elektrawebProcessor.js";
import {
  assertElektrawebNoHesapEksikForExport,
  buildElektrawebPreviewRows,
  getRowValue,
  LUCA_EXPORT_HEADERS,
  normalizeElektrawebRawToStandardLucaRow,
} from "../src/utils/standardLucaRow.js";
import { applyElektrawebEditDraft } from "../src/utils/previewRowEdit.js";
import { safeRead } from "../src/utils/safeXlsx.js";
import { formatDateTR } from "../src/utils/formatDateTR.js";
import {
  analyzeStandardLucaRows,
  KONTROL_SEVIYE,
  KONTROL_TIP,
} from "../src/utils/fisKontrolMerkezi.js";
import {
  DOCUMENT_TYPE_OPTIONS,
  isValidLucaDocumentType,
} from "../src/utils/lucaDocumentTypes.js";
import {
  applyFisAciklamaToEmptyRows,
  buildMukerrerFisGroups,
  createMukerrerDecision,
  getExcludedFisNosFromMukerrerDecisions,
  MUKERRER_DECISION_KEEP_ALL,
  MUKERRER_DECISION_KEEP_FIRST,
} from "../src/utils/fisDonusturmeMukerrerDecisions.js";
import { parseMoneyTR } from "../src/utils/parseMoneyTR.js";

function keepAllMukerrerDecisions(rows, firmaId = "x") {
  const groups = buildMukerrerFisGroups(rows, { firmaId });
  const decisions = {};
  for (const group of groups) {
    decisions[group.id] = createMukerrerDecision(
      MUKERRER_DECISION_KEEP_ALL,
      [],
      group
    );
  }
  return { groups, decisions };
}

function keepFirstMukerrerDecisions(rows, firmaId = "x") {
  const groups = buildMukerrerFisGroups(rows, { firmaId });
  const decisions = {};
  for (const group of groups) {
    decisions[group.id] = createMukerrerDecision(
      MUKERRER_DECISION_KEEP_FIRST,
      [],
      group
    );
  }
  return { groups, decisions };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const pagePath = path.join(
  root,
  "app/(annvero)/muhasebe/fis-donusturme/page.jsx"
);

let passed = 0;
function test(name, fn) {
  const run = async () => {
    try {
      await fn();
      passed += 1;
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`fail - ${name}`);
      console.error(error);
      process.exitCode = 1;
    }
  };
  return run();
}

function sheetFromRows(rows, name = "Elektra") {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return workbook;
}

await test("UI: Elektra seçiliyken aktarım CTA’sı koşullu gizlenir", () => {
  const src = fs.readFileSync(pagePath, "utf8");
  assert.match(src, /isFisDonusturmeElektrawebSource\(sourceType\)/);
  assert.match(src, /Luca Fiş Üretici'ye Aktar/);
  assert.match(
    src,
    /!isFisDonusturmeElektrawebSource\(sourceType\)[\s\S]*?Luca Fiş Üretici'ye Aktar/
  );
  assert.match(src, /assertFisDonusturmeLucaProducerTransferAllowed/);
  assert.match(src, /prepareFisDonusturmeLucaExcelFiles/);
  assert.match(src, /MukerrerFisDecisionPanel/);
  assert.match(src, /mukerrerDecisions/);
  assert.match(src, /applyFisAciklamaToEmptyRows/);
  assert.match(
    src,
    /setMukerrerDecisions\(\{\}\)[\s\S]*?setFisAciklamaDrafts\(\{\}\)/
  );
  assert.match(src, /const resetPipelineOutput = \(\) => \{[\s\S]*?setMukerrerDecisions\(\{\}\)/);
  assert.match(src, /changeSourceType[\s\S]*?resetPipelineOutput\(\)/);
  assert.match(src, /handleFile[\s\S]*?resetPipelineOutput\(\)/);
  assert.match(src, /setSelectedCompanyId[\s\S]*?resetPipelineOutput\(\)/);
});

await test("UI: mükerrer panel mobil + masaüstü viewport sınıfları", () => {
  const panelPath = path.join(
    root,
    "app/(annvero)/muhasebe/components/MukerrerFisDecisionPanel.jsx"
  );
  const src = fs.readFileSync(panelPath, "utf8");
  assert.match(src, /overflow-x-auto/);
  assert.match(src, /min-w-\[640px\]/);
  assert.match(src, /flex-col gap-2 sm:flex-row/);
  assert.match(src, /max-w-full/);
  const pageSrc = fs.readFileSync(pagePath, "utf8");
  assert.match(pageSrc, /from "\.\.\/components\/MukerrerFisDecisionPanel"/);
});

await test("UI: export işlem çubuğu Ön İzleme’de; sidebar yalnız 2xl+", () => {
  const src = fs.readFileSync(pagePath, "utf8");
  assert.match(src, /data-testid="fis-donusturme-export-actions-primary"/);
  assert.match(src, /data-testid="fis-donusturme-export-actions-sidebar"/);
  assert.match(src, /hidden[\s\S]*?2xl:block/);
  assert.match(src, /minmax\(0,1fr\)/);
  assert.match(src, /overflow-x-auto/);
  assert.match(src, /overflow-x-hidden/);
  assert.match(src, /exportActionsDisabled/);
  assert.match(src, /disabled=\{exportActionsDisabled\}/);
  assert.match(src, /loading=\{isExporting\}/);
  assert.match(src, /withExportGuard/);
  assert.match(src, /exportBusyRef/);
  assert.match(src, /function ExportActionsBar/);
  // Primary + sidebar aynı handler / disabled / loading
  const lucaBindings = src.match(/onLucaExcel=\{exportLucaExcel\}/g) || [];
  assert.equal(lucaBindings.length, 2);
  const controlBindings = src.match(/onControlReport=\{exportControlReport\}/g) || [];
  assert.equal(controlBindings.length, 2);
  const errorBindings = src.match(/onErrorReport=\{exportErrorReport\}/g) || [];
  assert.equal(errorBindings.length, 2);
  const disabledBindings = src.match(/disabled=\{exportActionsDisabled\}/g) || [];
  assert.equal(disabledBindings.length, 2);
  const loadingBindings = src.match(/loading=\{isExporting\}/g) || [];
  assert.equal(loadingBindings.length, 2);
  // HESAP_EKSIK gate her iki görünümde aynı prepare yolundan
  assert.match(src, /prepareFisDonusturmeLucaExcelFiles/);
  assert.equal((src.match(/prepareFisDonusturmeLucaExcelFiles\(/g) || []).length, 1);
});

await test("Handler: Elektra sourceType doğrudan reddedilir", () => {
  const gate = assertFisDonusturmeLucaProducerTransferAllowed({
    sourceType: "ELEKTRAWEB",
    source: "bank",
    rows: [{ id: "1", kaynakTipi: "BANKA", hesapKodu: "100" }],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, FIS_DONUSTURME_ELEKTRA_TRANSFER_DISABLED_CODE);
});

await test("Handler: source=elektraweb reddedilir (yanlış bank yolu yok)", () => {
  const gate = assertFisDonusturmeLucaProducerTransferAllowed({
    sourceType: "BANKA",
    source: "elektraweb",
    rows: [],
  });
  assert.equal(gate.ok, false);
});

await test("Handler: Elektra satırları source=bank ile de reddedilir", () => {
  const gate = assertFisDonusturmeLucaProducerTransferAllowed({
    sourceType: "BANKA",
    source: "bank",
    rows: [
      {
        id: "1",
        kaynakTipi: "ELEKTRAWEB",
        kaynakAdi: "ELEKTRAWEB",
        hesapKodu: "320.10.O0004",
        riskDurumu: "HESAP_EKSIK",
      },
    ],
  });
  assert.equal(gate.ok, false);
});

await test("Handler: banka satırları aktarıma açık", () => {
  const gate = assertFisDonusturmeLucaProducerTransferAllowed({
    sourceType: "BANKA",
    source: "bank",
    rows: [{ id: "1", kaynakTipi: "BANKA", kaynakAdi: "VAKIFBANK", hesapKodu: "102.01" }],
  });
  assert.equal(gate.ok, true);
});

await test("publishFisDonusturmeTransfer Elektra’yı fail-closed reddeder", async () => {
  const result = await publishFisDonusturmeTransfer({
    companyId: "co-test",
    companyName: "Test",
    bankName: "Elektraweb",
    source: "bank",
    sourceType: "ELEKTRAWEB",
    rows: [
      {
        id: "e1",
        firmaId: "co-test",
        kaynakTipi: "ELEKTRAWEB",
        kaynakAdi: "ELEKTRAWEB",
        fisNo: 1,
        fisTarihi: "01.04.2026",
        hesapKodu: "100.01",
        belgeTuru: "DK",
        borc: 10,
        alacak: "",
      },
    ],
    authUserId: "user-test",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, FIS_DONUSTURME_ELEKTRA_TRANSFER_DISABLED_CODE);
  assert.equal(result.runId, undefined);
});

await test("HESAP_EKSIK varken doğrudan Luca Excel oluşmaz; kod listesi döner", () => {
  const rows = [
    {
      id: "1",
      fisNo: 1,
      fisTarihi: "01.04.2026",
      hesapKodu: "320.10.O0004",
      kaynakHesapKodu: "320.10.O0004",
      riskDurumu: "HESAP_EKSIK",
      belgeTuru: "DK",
      detayAciklama: "Ödeme",
      borc: 10,
      alacak: "",
    },
    {
      id: "2",
      fisNo: 1,
      fisTarihi: "01.04.2026",
      hesapKodu: "100.01",
      kaynakHesapKodu: "100.01",
      riskDurumu: "",
      belgeTuru: "DK",
      detayAciklama: "Karşı",
      borc: "",
      alacak: 10,
    },
  ];
  const blocked = prepareFisDonusturmeLucaExcelFiles({
    sourceType: "ELEKTRAWEB",
    rows,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.files.length, 0);
  assert.ok(blocked.missingKaynakHesapKodlari.includes("320.10.O0004"));
  assert.match(blocked.message, /320\.10\.O0004/);
});

await test("Eksikler manuel çözülünce export açılır + Luca sözleşmesi", () => {
  const rows = [
    {
      id: "1",
      fisNo: 1,
      fisTarihi: "01.04.2026",
      hesapKodu: "102.01.002",
      kaynakHesapKodu: "320.10.O0004",
      riskDurumu: "",
      belgeTuru: "DK",
      detayAciklama: "Ödeme",
      fisAciklama: "Ödeme",
      borc: 10,
      alacak: "",
      manuallyEdited: true,
    },
    {
      id: "2",
      fisNo: 1,
      fisTarihi: "01.04.2026",
      hesapKodu: "100.01",
      riskDurumu: "",
      belgeTuru: "DK",
      detayAciklama: "Karşı",
      fisAciklama: "Karşı",
      borc: "",
      alacak: 10,
    },
  ];
  const prepared = prepareFisDonusturmeLucaExcelFiles({
    sourceType: "ELEKTRAWEB",
    rows,
    filePrefix: "elektraweb",
    chunkSize: 50,
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.files.length, 1);
  const file = prepared.files[0];
  assert.deepEqual(file.headers, [...LUCA_EXPORT_HEADERS]);
  assert.equal(file.excelRows.length, 2);
  const sample = file.sampleContract;
  assert.equal(sample.fisNo, 1);
  assert.ok(sample.fisTarihi);
  assert.equal(sample.hesapKodu, "102.01.002");
  assert.equal(sample.belgeTuru, "DK");
  assert.equal(sample.borc, 10);
  assert.ok(sample.aciklama);
});

await test("50 fiş gruplaması korunur", () => {
  const rows = [];
  for (let fis = 1; fis <= 51; fis += 1) {
    rows.push({
      id: `f${fis}a`,
      fisNo: fis,
      fisTarihi: "01.04.2026",
      hesapKodu: "100.01",
      belgeTuru: "DK",
      detayAciklama: `Satır ${fis}`,
      borc: 1,
      alacak: "",
      riskDurumu: "",
    });
    rows.push({
      id: `f${fis}b`,
      fisNo: fis,
      fisTarihi: "01.04.2026",
      hesapKodu: "320.01",
      belgeTuru: "DK",
      detayAciklama: `Satır ${fis}b`,
      borc: "",
      alacak: 1,
      riskDurumu: "",
    });
  }
  const prepared = prepareFisDonusturmeLucaExcelFiles({
    sourceType: "ELEKTRAWEB",
    rows,
    chunkSize: 50,
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.files.length, 2);
  assert.equal(prepared.files[0].fisCount, 50);
  assert.equal(prepared.files[1].fisCount, 1);
});

await test("HESAP_EKSIK satırında Düşük görünmez", () => {
  const row = {
    riskDurumu: "HESAP_EKSIK",
    hesapKodu: "320.10.O0004",
    _kontrol: {
      seviye: "Bilgi",
      riskSeviyesi: "Düşük",
      kontrolNotu: "Hafıza",
    },
  };
  assert.equal(resolveFisDonusturmeDisplayRiskSeviyesi(row), "Yüksek");
  assert.equal(shouldShowFisDonusturmeRiskPill(row), true);
  assert.notEqual(resolveFisDonusturmeDisplayRiskSeviyesi(row), "Düşük");
});

await test("Aynı fiş içi belge tekrarları mükerrer değil; çapraz-fiş korunur", () => {
  const rows = [
    {
      "Fiş Numarası": "1",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "100.01",
      "Dok Tipi": "DK",
      "Evrak No": "SAMEBELGE001",
      Açıklama: "Borç 1",
      Borç: "5,00",
      Alacak: "0,00",
    },
    {
      "Fiş Numarası": "1",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "320.01",
      "Dok Tipi": "DK",
      "Evrak No": "SAMEBELGE001",
      Açıklama: "Alacak 1",
      Borç: "0,00",
      Alacak: "5,00",
    },
    {
      "Fiş Numarası": "2",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "100.01",
      "Dok Tipi": "DK",
      "Evrak No": "CROSSBELGE99",
      Açıklama: "Fiş2",
      Borç: "3,00",
      Alacak: "0,00",
    },
    {
      "Fiş Numarası": "3",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "320.01",
      "Dok Tipi": "DK",
      "Evrak No": "CROSSBELGE99",
      Açıklama: "Fiş3",
      Borç: "0,00",
      Alacak: "3,00",
    },
  ];
  const plan = [
    { hesapKodu: "100.01", hesapAdi: "100.01" },
    { hesapKodu: "320.01", hesapAdi: "320.01" },
  ];
  const result = processElektrawebWorkbook(sheetFromRows(rows), {
    firmaId: "x",
    accountPlan: plan,
  });

  const sameFis = result.standardLucaRows.filter((r) => String(r.fisNo) === "1");
  assert.ok(
    sameFis.every(
      (r) => !String(r.kontrolNotu || "").includes("Mükerrer belge no")
    )
  );

  const cross = result.standardLucaRows.filter((r) =>
    String(r.kontrolNotu || "").includes("Mükerrer belge no")
  );
  assert.equal(cross.length, 2);
  assert.ok(cross.every((r) => r.evrakNo === "CROSSBELGE99"));
  assert.equal(result.mukerrerBelgeSayisi, 1);
});

await test("Mükerrer grup kimliği satır sırasından bağımsız ve deterministik", () => {
  const base = [
    {
      fisNo: "A2",
      fisTarihi: "01.04.2026",
      hesapKodu: "102.01",
      belgeTuru: "DK",
      detayAciklama: "aynı hareket",
      borc: 100,
      alacak: "",
      firmaId: "x",
    },
    {
      fisNo: "A2",
      fisTarihi: "01.04.2026",
      hesapKodu: "320.01",
      belgeTuru: "DK",
      detayAciklama: "aynı hareket",
      borc: "",
      alacak: 100,
      firmaId: "x",
    },
    {
      fisNo: "A1",
      fisTarihi: "01.04.2026",
      hesapKodu: "102.01",
      belgeTuru: "DK",
      detayAciklama: "aynı hareket",
      borc: 100,
      alacak: "",
      firmaId: "x",
    },
    {
      fisNo: "A1",
      fisTarihi: "01.04.2026",
      hesapKodu: "320.01",
      belgeTuru: "DK",
      detayAciklama: "aynı hareket",
      borc: "",
      alacak: 100,
      firmaId: "x",
    },
  ];
  const forward = buildMukerrerFisGroups(base, { firmaId: "x" });
  const reverse = buildMukerrerFisGroups([...base].reverse(), { firmaId: "x" });
  assert.equal(forward.length, 1);
  assert.equal(reverse.length, 1);
  assert.equal(forward[0].id, reverse[0].id);
  assert.deepEqual(forward[0].fisNos, ["A1", "A2"]);
  assert.deepEqual(reverse[0].fisNos, ["A1", "A2"]);
  assert.equal(forward[0].id, "A1|A2");
});

await test("Mükerrer export fiş bütünlüğü + formül sanitize + boş/uzun açıklama", () => {
  const rows = [
    {
      fisNo: "1",
      fisTarihi: "01.04.2026",
      hesapKodu: "102.01",
      belgeTuru: "DK",
      detayAciklama: "=CMD()",
      fisAciklama: "=CMD()",
      borc: 10,
      alacak: "",
      firmaId: "x",
      kaynakTipi: "ELEKTRAWEB",
    },
    {
      fisNo: "1",
      fisTarihi: "01.04.2026",
      hesapKodu: "320.01",
      belgeTuru: "DK",
      detayAciklama: "+hijack",
      fisAciklama: "+hijack",
      borc: "",
      alacak: 10,
      firmaId: "x",
      kaynakTipi: "ELEKTRAWEB",
    },
    {
      fisNo: "2",
      fisTarihi: "01.04.2026",
      hesapKodu: "102.01",
      belgeTuru: "DK",
      detayAciklama: "=CMD()",
      fisAciklama: "=CMD()",
      borc: 10,
      alacak: "",
      firmaId: "x",
      kaynakTipi: "ELEKTRAWEB",
    },
    {
      fisNo: "2",
      fisTarihi: "01.04.2026",
      hesapKodu: "320.01",
      belgeTuru: "DK",
      detayAciklama: "@sum",
      fisAciklama: "@sum",
      borc: "",
      alacak: 10,
      firmaId: "x",
      kaynakTipi: "ELEKTRAWEB",
    },
    {
      fisNo: "3",
      fisTarihi: "01.04.2026",
      hesapKodu: "102.01",
      belgeTuru: "DK",
      detayAciklama: "",
      fisAciklama: "",
      borc: 5,
      alacak: "",
      firmaId: "x",
      kaynakTipi: "ELEKTRAWEB",
    },
    {
      fisNo: "3",
      fisTarihi: "01.04.2026",
      hesapKodu: "320.01",
      belgeTuru: "DK",
      detayAciklama: "x".repeat(4000),
      fisAciklama: "x".repeat(4000),
      borc: "",
      alacak: 5,
      firmaId: "x",
      kaynakTipi: "ELEKTRAWEB",
    },
  ];

  const groups = buildMukerrerFisGroups(rows, { firmaId: "x" });
  assert.ok(groups.length >= 1);
  const unresolved = prepareFisDonusturmeLucaExcelFiles({
    sourceType: "ELEKTRAWEB",
    rows,
    mukerrerGroups: groups,
    mukerrerDecisions: {},
  });
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.code, "MUKERRER_UNRESOLVED");

  const keepFirst = keepFirstMukerrerDecisions(rows);
  // Fiş 1+2 mükerrer; keep first → A1 style first sorted = "1"
  const prepared = prepareFisDonusturmeLucaExcelFiles({
    sourceType: "ELEKTRAWEB",
    rows,
    mukerrerGroups: keepFirst.groups,
    mukerrerDecisions: keepFirst.decisions,
  });
  assert.equal(prepared.ok, true);
  const excel = prepared.files.flatMap((f) => f.excelRows);
  const byFis = new Map();
  for (const row of excel) {
    const fis = String(row["Fiş No"] ?? "");
    byFis.set(fis, (byFis.get(fis) || 0) + 1);
  }
  // Excluded mükerrer twin must drop ALL legs (0), kept fiş keeps both legs (2)
  for (const group of keepFirst.groups) {
    const keep = group.firstFisNo;
    for (const fis of group.fisNos) {
      if (fis === keep) {
        assert.equal(byFis.get(fis), 2, `korunan fiş ${fis} iki bacak`);
      } else {
        assert.equal(byFis.get(fis) || 0, 0, `çıkarılan fiş ${fis} bütünüyle dışarı`);
      }
    }
  }
  assert.equal(byFis.get("3"), 2, "mükerrer dışı fiş bütünü korunur");

  const formulas = excel.map((r) => String(r["Detay Açıklama"] || ""));
  assert.ok(formulas.some((t) => t.startsWith("'=")));
  assert.ok(formulas.some((t) => t.startsWith("'+")));
  assert.equal(
    formulas.some(
      (t) =>
        (t.startsWith("=") || t.startsWith("+") || t.startsWith("-") || t.startsWith("@")) &&
        !t.startsWith("'")
    ),
    false
  );
  assert.ok(formulas.some((t) => t.length >= 4000));
  assert.ok(formulas.some((t) => t === ""));

  const filled = applyFisAciklamaToEmptyRows(rows, "3", "yeni açıklama");
  assert.equal(filled.updatedCount, 1);
  const row3 = filled.rows.filter((r) => String(r.fisNo) === "3");
  assert.equal(
    row3.filter((r) => String(r.detayAciklama || "").trim() === "yeni açıklama").length,
    1
  );
  assert.equal(
    row3.filter((r) => String(r.detayAciklama || "").trim() === "x".repeat(4000)).length,
    1
  );
});

const nisanPath = path.join(
  process.env.USERPROFILE || "",
  "Desktop",
  "Elektra Fişler Nisan 2026.xlsx"
);

if (fs.existsSync(nisanPath)) {
  await test("Nisan 2026: 558/174 drift 0 + merkez gate + risk pill", () => {
    const workbook = safeRead(fs.readFileSync(nisanPath));
    // Minimal plan: all unique codes except force O0004 missing if present
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: false });
    const codes = [
      ...new Set(
        raw
          .map((r) => String(r["Hesap Kodu"] || r.HesapKodu || "").trim())
          .filter(Boolean)
      ),
    ];
    const plan = codes
      .filter((c) => c !== "320.10.O0004")
      .map((hesapKodu) => ({ hesapKodu, hesapAdi: hesapKodu }));

    const result = processElektrawebWorkbook(workbook, {
      firmaId: "x",
      accountPlan: plan,
      learningMemory: [],
      companyMappings: { companyId: "x", kuralMotoruRules: [] },
    });

    assert.equal(result.toplamSatir, 558);
    assert.equal(result.toplamFis, 174);

    const { groups, decisions } = keepAllMukerrerDecisions(
      result.standardLucaRows
    );
    assert.equal(groups.length, 2);

    const blocked = prepareFisDonusturmeLucaExcelFiles({
      sourceType: "ELEKTRAWEB",
      rows: result.standardLucaRows,
      mukerrerGroups: groups,
      mukerrerDecisions: decisions,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "HESAP_EKSIK");
    assert.equal(blocked.files.length, 0);
    assert.ok(blocked.missingKaynakHesapKodlari.length > 0);

    for (const row of result.standardLucaRows) {
      if (String(row.riskDurumu || "").trim() !== "HESAP_EKSIK") continue;
      assert.equal(resolveFisDonusturmeDisplayRiskSeviyesi(row), "Yüksek");
      assert.notEqual(resolveFisDonusturmeDisplayRiskSeviyesi(row), "Düşük");
    }

    assert.equal(isFisDonusturmeElektrawebSource("ELEKTRAWEB"), true);
  });

  await test("Nisan 2026 resolved disposable: 50+50+50+24 and 558-row integrity", () => {
    const workbook = safeRead(fs.readFileSync(nisanPath));
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: false });
    const codes = [
      ...new Set(
        raw
          .map((r) => String(r["Hesap Kodu"] || r.HesapKodu || "").trim())
          .filter(Boolean)
      ),
    ];
    // Disposable: tüm kaynak hesaplar planda → HESAP_EKSIK kapısı açık (gerçek dosya kopyası)
    const plan = codes.map((hesapKodu) => ({ hesapKodu, hesapAdi: hesapKodu }));

    const result = processElektrawebWorkbook(workbook, {
      firmaId: "x",
      accountPlan: plan,
      learningMemory: [],
      companyMappings: { companyId: "x", kuralMotoruRules: [] },
    });

    assert.equal(result.toplamSatir, 558, "kaynak satır");
    assert.equal(result.toplamFis, 174, "benzersiz fiş");
    assert.equal(result.standardLucaRows.length, 558);

    const unresolved = result.standardLucaRows.filter(
      (r) => String(r.riskDurumu || "").trim() === "HESAP_EKSIK"
    );
    assert.equal(unresolved.length, 0, "disposable fixture HESAP_EKSIK=0");

    const gate = assertElektrawebNoHesapEksikForExport(result.standardLucaRows);
    assert.equal(gate.ok, true);

    const unresolvedBlocked = prepareFisDonusturmeLucaExcelFiles({
      sourceType: "ELEKTRAWEB",
      rows: result.standardLucaRows,
      chunkSize: 50,
      filePrefix: "elektraweb",
    });
    assert.equal(unresolvedBlocked.ok, false);
    assert.equal(unresolvedBlocked.code, "MUKERRER_UNRESOLVED");
    assert.equal(result.standardLucaRows.length, 558, "kararsızken satır sessiz düşmez");

    const { groups, decisions } = keepAllMukerrerDecisions(
      result.standardLucaRows
    );
    assert.equal(groups.length, 2);

    const prepared = prepareFisDonusturmeLucaExcelFiles({
      sourceType: "ELEKTRAWEB",
      rows: result.standardLucaRows,
      chunkSize: 50,
      filePrefix: "elektraweb",
      mukerrerGroups: groups,
      mukerrerDecisions: decisions,
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.files.length, 4);
    assert.deepEqual(
      prepared.files.map((f) => f.fisCount),
      [50, 50, 50, 24]
    );

    const totalExportRows = prepared.files.reduce((sum, f) => sum + f.rowCount, 0);
    assert.equal(totalExportRows, 558, "export satır toplamı");

    const flatExcel = prepared.files.flatMap((f) => f.excelRows);
    assert.equal(flatExcel.length, 558);

    const normalizeMoney = (value) => {
      if (value === "" || value === null || value === undefined) return "";
      const num = Number(value);
      if (!Number.isFinite(num) || num === 0) return "";
      return String(num);
    };

    const sourceFingerprints = result.standardLucaRows.map((row) =>
      [
        String(row.fisNo ?? ""),
        formatDateTR(row.fisTarihi),
        String(row.hesapKodu || "").trim(),
        String(row.belgeTuru || "").trim(),
        normalizeMoney(row.borc),
        normalizeMoney(row.alacak),
        String(row.detayAciklama || row.fisAciklama || "").trim(),
      ].join("|")
    );
    const excelFingerprints = flatExcel.map((row) =>
      [
        String(row["Fiş No"] ?? ""),
        String(row["Fiş Tarihi"] ?? ""),
        String(row["Hesap Kodu"] || "").trim(),
        String(row["Belge Türü"] || "").trim(),
        normalizeMoney(row["Borç"]),
        normalizeMoney(row["Alacak"]),
        String(row["Detay Açıklama"] || row["Fiş Açıklama"] || "").trim(),
      ].join("|")
    );

    const sortCopy = (list) => [...list].sort((a, b) => a.localeCompare(b, "tr"));
    assert.deepEqual(
      sortCopy(excelFingerprints),
      sortCopy(sourceFingerprints),
      "kayıp/mükerrer/drift fingerprint"
    );

    // Her fiş tam bir grupta; fiş bölünmesi yok
    const fisOwner = new Map();
    for (let fileIndex = 0; fileIndex < prepared.files.length; fileIndex += 1) {
      const fisInFile = new Set(
        prepared.files[fileIndex].excelRows.map((r) => String(r["Fiş No"] ?? ""))
      );
      assert.equal(fisInFile.size, prepared.files[fileIndex].fisCount);
      for (const fisNo of fisInFile) {
        assert.equal(
          fisOwner.has(fisNo),
          false,
          `fiş bölünmesi: ${fisNo} birden fazla grupta`
        );
        fisOwner.set(fisNo, fileIndex);
      }
    }
    assert.equal(fisOwner.size, 174);

    const groupReport = prepared.files.map((file, index) => {
      let borc = 0;
      let alacak = 0;
      for (const row of file.excelRows) {
        borc += Number(row["Borç"] || 0) || 0;
        alacak += Number(row["Alacak"] || 0) || 0;
      }
      borc = Math.round(borc * 100) / 100;
      alacak = Math.round(alacak * 100) / 100;
      assert.equal(
        borc,
        alacak,
        `grup ${index + 1} borç/alacak dengesi ${borc}≠${alacak}`
      );
      return {
        grup: index + 1,
        fis: file.fisCount,
        satir: file.rowCount,
        borc,
        alacak,
      };
    });

    console.log("  Nisan resolved chunk table:");
    for (const row of groupReport) {
      console.log(
        `    G${row.grup}: fiş=${row.fis} satır=${row.satir} borç=${row.borc} alacak=${row.alacak}`
      );
    }
    assert.equal(
      groupReport.reduce((s, r) => s + r.satir, 0),
      558
    );
  });

  await test("Nisan 2026: KR/MF allowlist — 0 geçersiz belge, Hata=8 mükerrer, açıklama uyarı", () => {
    assert.equal(isValidLucaDocumentType("KR"), true);
    assert.equal(isValidLucaDocumentType("MF"), true);
    assert.ok(DOCUMENT_TYPE_OPTIONS.includes("MF"));
    assert.ok(DOCUMENT_TYPE_OPTIONS.includes("KR"));

    const workbook = safeRead(fs.readFileSync(nisanPath));
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: false });
    const codes = [
      ...new Set(
        raw
          .map((r) => String(r["Hesap Kodu"] || r.HesapKodu || "").trim())
          .filter(Boolean)
      ),
    ];
    const plan = codes.map((hesapKodu) => ({ hesapKodu, hesapAdi: hesapKodu }));

    const result = processElektrawebWorkbook(workbook, {
      firmaId: "x",
      accountPlan: plan,
      learningMemory: [],
      companyMappings: { companyId: "x", kuralMotoruRules: [] },
    });

    assert.equal(result.standardLucaRows.length, 558);
    assert.equal(result.toplamFis, 174);

    const filtered = raw.filter((r) => r["Fiş Numarası"] || r["Fiş No"]);
    const dokById = new Map(
      filtered.map((src, index) => {
        const n = normalizeElektrawebRawToStandardLucaRow(src, { index });
        return [n.id, String(getRowValue(src, "Dok Tipi") || "").trim()];
      })
    );
    let drift = 0;
    for (const row of result.standardLucaRows) {
      const srcDok = dokById.get(row.id) || "";
      if (srcDok.toUpperCase() !== String(row.belgeTuru || "").trim().toUpperCase()) {
        drift += 1;
      }
    }
    assert.equal(drift, 0, "Dok Tipi → belgeTuru drift");

    const analysis = analyzeStandardLucaRows(result.standardLucaRows, {
      firmaId: "x",
      accountPlan: plan,
    });
    const hata = analysis.issues.filter((i) => i.seviye === KONTROL_SEVIYE.HATA);
    const uyari = analysis.issues.filter((i) => i.seviye === KONTROL_SEVIYE.UYARI);
    assert.equal(hata.length, 8, "Hata=8 mükerrer (açıklama artık uyarı)");
    assert.equal(
      hata.filter((i) => i.message === "Geçersiz belge türü: KR").length,
      0
    );
    assert.equal(
      hata.filter((i) => i.message === "Geçersiz belge türü: MF").length,
      0
    );
    assert.equal(
      hata.filter((i) => i.type === KONTROL_TIP.GECERSIZ_BELGE_TURU).length,
      0
    );
    assert.equal(
      hata.filter((i) => i.type === KONTROL_TIP.MUKERRER_HAREKET).length,
      8
    );
    assert.equal(
      hata.filter((i) => i.type === KONTROL_TIP.EKSIK_ACIKLAMA).length,
      0
    );
    assert.equal(
      uyari.filter((i) => i.type === KONTROL_TIP.EKSIK_ACIKLAMA).length,
      2
    );

    const { groups, decisions } = keepAllMukerrerDecisions(
      result.standardLucaRows
    );
    const prepared = prepareFisDonusturmeLucaExcelFiles({
      sourceType: "ELEKTRAWEB",
      rows: result.standardLucaRows,
      chunkSize: 50,
      filePrefix: "elektraweb",
      mukerrerGroups: groups,
      mukerrerDecisions: decisions,
    });
    assert.equal(prepared.ok, true);
    const excelRows = prepared.files.flatMap((f) => f.excelRows);
    assert.equal(excelRows.length, 558);
    assert.equal(
      excelRows.filter((r) => String(r["Belge Türü"] || "").trim() === "KR").length,
      7
    );
    assert.equal(
      excelRows.filter((r) => String(r["Belge Türü"] || "").trim() === "MF").length,
      6
    );
  });

  await test("Nisan 2026: mükerrer fiş kararları + açıklama uyarı/akış", () => {
    const workbook = safeRead(fs.readFileSync(nisanPath));
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: false });
    const codes = [
      ...new Set(
        raw
          .map((r) => String(r["Hesap Kodu"] || r.HesapKodu || "").trim())
          .filter(Boolean)
      ),
    ];
    const plan = codes.map((hesapKodu) => ({ hesapKodu, hesapAdi: hesapKodu }));
    const result = processElektrawebWorkbook(workbook, {
      firmaId: "x",
      accountPlan: plan,
      learningMemory: [],
      companyMappings: { companyId: "x", kuralMotoruRules: [] },
    });

    assert.equal(result.standardLucaRows.length, 558);
    assert.equal(result.toplamFis, 174);

    const analysis = analyzeStandardLucaRows(result.standardLucaRows, {
      firmaId: "x",
      accountPlan: plan,
    });
    const hata = analysis.issues.filter((i) => i.seviye === KONTROL_SEVIYE.HATA);
    const uyari = analysis.issues.filter((i) => i.seviye === KONTROL_SEVIYE.UYARI);
    assert.equal(hata.filter((i) => i.type === KONTROL_TIP.MUKERRER_HAREKET).length, 8);
    assert.equal(uyari.filter((i) => i.type === KONTROL_TIP.EKSIK_ACIKLAMA).length, 2);
    assert.equal(hata.filter((i) => i.type === KONTROL_TIP.GECERSIZ_BELGE_TURU).length, 0);

    const groups = buildMukerrerFisGroups(result.standardLucaRows, { firmaId: "x" });
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].fisNos, ["04010006", "04010011", "04010014"]);
    assert.deepEqual(groups[1].fisNos, ["04010010", "04010013", "04010017"]);

    const blocked = prepareFisDonusturmeLucaExcelFiles({
      sourceType: "ELEKTRAWEB",
      rows: result.standardLucaRows,
      mukerrerGroups: groups,
      mukerrerDecisions: {},
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "MUKERRER_UNRESOLVED");
    assert.match(blocked.message, /04010006/);
    assert.equal(result.standardLucaRows.length, 558);

    const keepFirst = keepFirstMukerrerDecisions(result.standardLucaRows);
    const excluded = getExcludedFisNosFromMukerrerDecisions(
      keepFirst.groups,
      keepFirst.decisions
    );
    assert.deepEqual(excluded, [
      "04010011",
      "04010013",
      "04010014",
      "04010017",
    ]);
    assert.equal(keepFirst.groups[0].firstFisNo, "04010006");
    assert.equal(keepFirst.groups[1].firstFisNo, "04010010");

    const preparedFirst = prepareFisDonusturmeLucaExcelFiles({
      sourceType: "ELEKTRAWEB",
      rows: result.standardLucaRows,
      chunkSize: 50,
      filePrefix: "elektraweb",
      mukerrerGroups: keepFirst.groups,
      mukerrerDecisions: keepFirst.decisions,
    });
    assert.equal(preparedFirst.ok, true);
    const exportRowsFirst = preparedFirst.files.flatMap((f) => f.excelRows);
    const exportFisFirst = [
      ...new Set(exportRowsFirst.map((r) => String(r["Fiş No"] ?? ""))),
    ];
    assert.equal(exportFisFirst.length, 170);
    assert.equal(exportRowsFirst.length, 550);
    assert.equal(
      exportFisFirst.includes("04010011") ||
        exportFisFirst.includes("04010014") ||
        exportFisFirst.includes("04010013") ||
        exportFisFirst.includes("04010017"),
      false
    );
    assert.equal(exportFisFirst.includes("04010006"), true);
    assert.equal(exportFisFirst.includes("04010010"), true);

    // Bütün fişler dengeli
    const byFis = new Map();
    for (const row of exportRowsFirst) {
      const fis = String(row["Fiş No"] ?? "");
      if (!byFis.has(fis)) byFis.set(fis, { borc: 0, alacak: 0 });
      const bucket = byFis.get(fis);
      bucket.borc += parseMoneyTR(row["Borç"]) || 0;
      bucket.alacak += parseMoneyTR(row["Alacak"]) || 0;
    }
    for (const [fis, totals] of byFis) {
      assert.ok(
        Math.abs(totals.borc - totals.alacak) < 0.005,
        `dengesiz export fiş ${fis}`
      );
    }

    // Karar geri alınca yeniden blok
    const revoked = prepareFisDonusturmeLucaExcelFiles({
      sourceType: "ELEKTRAWEB",
      rows: result.standardLucaRows,
      mukerrerGroups: groups,
      mukerrerDecisions: {},
    });
    assert.equal(revoked.ok, false);

    const keepAll = keepAllMukerrerDecisions(result.standardLucaRows);
    const preparedAll = prepareFisDonusturmeLucaExcelFiles({
      sourceType: "ELEKTRAWEB",
      rows: result.standardLucaRows,
      chunkSize: 50,
      filePrefix: "elektraweb",
      mukerrerGroups: keepAll.groups,
      mukerrerDecisions: keepAll.decisions,
    });
    assert.equal(preparedAll.ok, true);
    const exportAll = preparedAll.files.flatMap((f) => f.excelRows);
    assert.equal(exportAll.length, 558);
    assert.equal(
      new Set(exportAll.map((r) => String(r["Fiş No"] ?? ""))).size,
      174
    );

    // 04010093 açıklama — yalnız 2 boş satır
    const before = result.standardLucaRows.filter(
      (r) => String(r.fisNo) === "04010093"
    );
    assert.equal(before.length >= 2, true);
    const filledBefore = before.filter(
      (r) =>
        String(r.detayAciklama || "").trim() ||
        String(r.fisAciklama || "").trim()
    ).length;
    const applied = applyFisAciklamaToEmptyRows(
      result.standardLucaRows,
      "04010093",
      "Nisan test açıklaması"
    );
    assert.equal(applied.updatedCount, 2);
    const after = applied.rows.filter((r) => String(r.fisNo) === "04010093");
    const emptyAfter = after.filter(
      (r) =>
        !String(r.detayAciklama || "").trim() &&
        !String(r.fisAciklama || "").trim()
    );
    assert.equal(emptyAfter.length, 0);
    const stillOriginal = after.filter(
      (r) => String(r.detayAciklama || "").trim() === "Nisan test açıklaması"
    );
    assert.equal(stillOriginal.length, 2);
    // Dolu satırlar değişmedi
    assert.equal(
      after.filter(
        (r) =>
          String(r.detayAciklama || "").trim() &&
          String(r.detayAciklama || "").trim() !== "Nisan test açıklaması"
      ).length,
      filledBefore
    );
  });
} else {
  console.log("skip - Nisan 2026 Excel not on Desktop");
}

await test("Export gate clears after full manual resolve (prepare path)", () => {
  const plan = [
    { hesapKodu: "102.01.002", hesapAdi: "VAKIFBANK TL" },
    { hesapKodu: "320.01", hesapAdi: "320.01" },
  ];
  const result = processElektrawebWorkbook(
    sheetFromRows([
      {
        "Fiş Numarası": "1",
        "Fiş Tarihi": "01.04.2026",
        "Hesap Kodu": "320.10.O0004",
        "Dok Tipi": "DK",
        Açıklama: "Ödeme",
        Borç: "10,00",
        Alacak: "0,00",
      },
      {
        "Fiş Numarası": "1",
        "Fiş Tarihi": "01.04.2026",
        "Hesap Kodu": "999.99.X001",
        "Dok Tipi": "DK",
        Açıklama: "Karşı",
        Borç: "0,00",
        Alacak: "10,00",
      },
    ]),
    {
      firmaId: "x",
      accountPlan: plan,
      learningMemory: [],
      companyMappings: { companyId: "x", kuralMotoruRules: [] },
    }
  );

  assert.equal(
    prepareFisDonusturmeLucaExcelFiles({
      sourceType: "ELEKTRAWEB",
      rows: result.standardLucaRows,
    }).ok,
    false
  );

  const resolved = buildElektrawebPreviewRows(
    result.standardLucaRows.map((row) =>
      applyElektrawebEditDraft(row, {
        accountCode:
          row.kaynakHesapKodu === "320.10.O0004" ? "102.01.002" : "320.01",
        documentType: row.belgeTuru,
        description: row.detayAciklama,
        borc: row.borc,
        alacak: row.alacak,
        controlNote: "",
      })
    ),
    {
      firmaId: "x",
      accountPlan: plan,
      selectedCompanyAccountPlan: plan,
      learningMemory: [],
      companyMappings: { companyId: "x", kuralMotoruRules: [] },
    }
  );

  assert.equal(assertElektrawebNoHesapEksikForExport(resolved).ok, true);
  const opened = prepareFisDonusturmeLucaExcelFiles({
    sourceType: "ELEKTRAWEB",
    rows: resolved,
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.files.length, 1);
});

console.log(`\n${passed} tests passed`);
