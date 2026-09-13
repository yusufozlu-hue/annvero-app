/**
 * Elektra ön izleme muhasebe güvenliği (üç kök neden).
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-elektraweb-preview-accounting.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { processElektrawebWorkbook } from "../src/utils/elektrawebProcessor.js";
import {
  getRowValue,
  normalizeElektrawebRawToStandardLucaRow,
  resolveElektrawebBelgeTuru,
  assertElektrawebNoHesapEksikForExport,
  collectElektrawebHesapEksikKaynakKodlari,
  buildElektrawebPreviewRows,
} from "../src/utils/standardLucaRow.js";
import { matchAccountCode } from "../src/utils/elektrawebAccountMatcher.js";
import { prepareElektrawebExportRows } from "../src/utils/elektrawebOutputAdapter.js";
import { applyElektrawebEditDraft } from "../src/utils/previewRowEdit.js";
import { parseMoneyTR } from "../src/utils/parseMoneyTR.js";
import { safeRead } from "../src/utils/safeXlsx.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function sheetFromRows(rows, name = "Elektra") {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return workbook;
}

test("Dok Tipi is explicit belge türü source; heuristic only when empty", () => {
  assert.equal(
    resolveElektrawebBelgeTuru({
      explicit: "DK",
      detayAciklama: "GIB2026000000013 Fatura",
      evrakNo: "GIB2026000000013",
    }),
    "DK"
  );
  assert.equal(
    resolveElektrawebBelgeTuru({
      explicit: "KR",
      detayAciklama: "GIB something",
    }),
    "KR"
  );
  assert.equal(
    resolveElektrawebBelgeTuru({
      explicit: "",
      detayAciklama: "GIB2026000000013 Nolu fatura",
      evrakNo: "GIB2026000000013",
    }),
    "EA"
  );

  const row = normalizeElektrawebRawToStandardLucaRow(
    {
      "Fiş Numarası": "1",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "320.10.O0004",
      "Dok Tipi": "DK",
      "Evrak No": "",
      Açıklama: "Ödeme Yapıldı(VAKIFBANK TL)",
      Borç: "100,00",
      Alacak: "0,00",
    },
    { index: 0 }
  );
  assert.equal(row.belgeTuru, "DK");
  assert.equal(row.kaynakHesapKodu, "320.10.O0004");
  assert.equal(row.hesapKodu, "320.10.O0004");
});

test("Filled source account is never silently remapped; suggestion only", () => {
  const plan = [
    { hesapKodu: "102.01.002", hesapAdi: "VAKIFBANK TL" },
    { hesapKodu: "102.10.V001", hesapAdi: "102.10.V001" },
  ];
  const row = {
    kaynakHesapKodu: "320.10.O0004",
    hesapKodu: "320.10.O0004",
    detayAciklama: "Ödeme Yapıldı(VAKIFBANK TL 1 5800 7308)",
    fisAciklama: "Ödeme Yapıldı(VAKIFBANK TL 1 5800 7308)",
    belgeTuru: "DK",
  };

  const memory = [
    {
      account_code: "102.01.002",
      keyword: "ODEME YAPILDI",
      source_module: "ELEKTRAWEB",
      is_active: true,
    },
  ];
  const rules = [
    {
      aramaMetni: "Ödeme Yapıldı",
      hesapKodu: "102.01.002",
      belgeTuru: "DK",
      kaynakTipi: "Elektraweb",
      isActive: true,
      companyId: "x",
    },
  ];

  const withFuzzy = matchAccountCode(row, plan, [], {
    companyId: "x",
    kuralMotoruRules: [],
  });
  assert.equal(withFuzzy.hesapKodu, "320.10.O0004");
  assert.equal(withFuzzy.riskDurumu, "HESAP_EKSIK");
  assert.equal(withFuzzy.eslesmeYontemi, "Excel");
  assert.equal(withFuzzy.onerilenHesapKodu, "102.01.002");
  assert.equal(withFuzzy.onerilenEslesmeYontemi, "Hesap Planı");

  const withMem = matchAccountCode(row, plan, memory, {
    companyId: "x",
    kuralMotoruRules: [],
  });
  assert.equal(withMem.hesapKodu, "320.10.O0004");
  assert.equal(withMem.riskDurumu, "HESAP_EKSIK");
  assert.equal(withMem.onerilenHesapKodu, "102.01.002");
  assert.equal(withMem.onerilenEslesmeYontemi, "Öğrenen Hafıza");
  assert.equal(withMem.hafizaEslesme, false);

  const withRule = matchAccountCode(row, plan, [], {
    companyId: "x",
    kuralMotoruRules: rules,
  });
  assert.equal(withRule.hesapKodu, "320.10.O0004");
  assert.notEqual(withRule.hesapKodu, "102.01.002");
});

test("Source account in plan stays Excel without HESAP_EKSIK", () => {
  const plan = [{ hesapKodu: "320.10.O0004", hesapAdi: "ORHAN" }];
  const match = matchAccountCode(
    {
      kaynakHesapKodu: "320.10.O0004",
      hesapKodu: "320.10.O0004",
      detayAciklama: "test",
    },
    plan,
    [],
    { companyId: "x" }
  );
  assert.equal(match.hesapKodu, "320.10.O0004");
  assert.equal(match.riskDurumu, "");
  assert.equal(match.eslesmeYontemi, "Excel");
});

test("Mükerrer belge only across different fiş numbers", () => {
  const rows = [
    {
      "Fiş Numarası": "04010001",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "100.01",
      "Dok Tipi": "EA",
      "Evrak No": "GIB2026000000099",
      Açıklama: "Satır A",
      Borç: "10,00",
      Alacak: "0,00",
    },
    {
      "Fiş Numarası": "04010001",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "320.01",
      "Dok Tipi": "EA",
      "Evrak No": "GIB2026000000099",
      Açıklama: "Satır B aynı fiş",
      Borç: "0,00",
      Alacak: "10,00",
    },
    {
      "Fiş Numarası": "04010002",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "100.01",
      "Dok Tipi": "EA",
      "Evrak No": "GIB2026000000099",
      Açıklama: "Satır C farklı fiş",
      Borç: "5,00",
      Alacak: "0,00",
    },
    {
      "Fiş Numarası": "04010002",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "320.01",
      "Dok Tipi": "EA",
      "Evrak No": "GIB2026000000099",
      Açıklama: "Satır D farklı fiş",
      Borç: "0,00",
      Alacak: "5,00",
    },
    {
      "Fiş Numarası": "04010003",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "100.01",
      "Dok Tipi": "DK",
      "Evrak No": "UNIQUE2026000001",
      Açıklama: "Tekil belge satır 1",
      Borç: "1,00",
      Alacak: "0,00",
    },
    {
      "Fiş Numarası": "04010003",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "320.01",
      "Dok Tipi": "DK",
      "Evrak No": "UNIQUE2026000001",
      Açıklama: "Tekil belge satır 2 aynı fiş — FP olmamalı",
      Borç: "0,00",
      Alacak: "1,00",
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

  const flagged = result.standardLucaRows.filter((r) =>
    String(r.kontrolNotu || "").includes("Mükerrer belge no")
  );
  assert.equal(flagged.length, 4);
  assert.ok(flagged.every((r) => r.evrakNo === "GIB2026000000099"));
  assert.equal(result.mukerrerBelgeSayisi, 1);
  assert.equal(result.mukerrerSatirSayisi, 4);
  assert.equal(result.mukerrerFisSayisi, 2);

  const sameFisOnly = result.standardLucaRows.filter(
    (r) => String(r.fisNo) === "04010003"
  );
  assert.ok(
    sameFisOnly.every(
      (r) => !String(r.kontrolNotu || "").includes("Mükerrer belge no")
    )
  );
});

test("04010003/04 style workbook: O0004 kept, no silent 102.01.002", () => {
  const rows = [
    {
      "Fiş Numarası": "04010003",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "740.30.018",
      "Dok Tipi": "EA",
      "Evrak No": "GIB2026000000023",
      Açıklama: "GIB2026000000023 Nolu ORHAN TUNA Hizmet Alış Faturası",
      Borç: "9,000.00",
      Alacak: "0.00",
    },
    {
      "Fiş Numarası": "04010003",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "191.01.020.108",
      "Dok Tipi": "EA",
      "Evrak No": "GIB2026000000023",
      Açıklama: "GIB2026000000023 Nolu ORHAN TUNA Hizmet Alış Faturası",
      Borç: "1,800.00",
      Alacak: "0.00",
    },
    {
      "Fiş Numarası": "04010003",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "320.10.O0004",
      "Dok Tipi": "EA",
      "Evrak No": "GIB2026000000023",
      Açıklama: "GIB2026000000023 Nolu ORHAN TUNA Hizmet Alış Faturası",
      Borç: "0.00",
      Alacak: "10,800.00",
    },
    {
      "Fiş Numarası": "04010004",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "320.10.O0004",
      "Dok Tipi": "DK",
      "Evrak No": "",
      Açıklama: "Ödeme Yapıldı(VAKIFBANK TL 1 5800 7308 4284 49 - 7308 ÖNBÜRO)",
      Borç: "10,800.00",
      Alacak: "0.00",
    },
    {
      "Fiş Numarası": "04010004",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "102.10.V001",
      "Dok Tipi": "DK",
      "Evrak No": "",
      Açıklama: "Ödeme Yapıldı(ORHAN TUNA)",
      Borç: "0.00",
      Alacak: "10,800.00",
    },
  ];

  const allCodes = [...new Set(rows.map((r) => r["Hesap Kodu"]))];
  const plan = allCodes
    .filter((c) => c !== "320.10.O0004")
    .map((hesapKodu) => ({ hesapKodu, hesapAdi: hesapKodu }));
  plan.push({ hesapKodu: "102.01.002", hesapAdi: "VAKIFBANK TL" });

  const memory = [
    {
      account_code: "102.01.002",
      keyword: "ODEME YAPILDI",
      source_module: "ELEKTRAWEB",
      is_active: true,
    },
  ];

  const result = processElektrawebWorkbook(sheetFromRows(rows), {
    firmaId: "x",
    accountPlan: plan,
    learningMemory: memory,
    companyMappings: { companyId: "x", kuralMotoruRules: [] },
  });

  const o0004 = result.standardLucaRows.filter(
    (r) => String(r.kaynakHesapKodu || r.hesapKodu) === "320.10.O0004"
  );
  assert.equal(o0004.length, 2);
  for (const row of o0004) {
    assert.equal(row.hesapKodu, "320.10.O0004");
    assert.equal(row.riskDurumu, "HESAP_EKSIK");
    assert.notEqual(row.hesapKodu, "102.01.002");
  }

  const borc04 = result.standardLucaRows.find(
    (r) => String(r.fisNo) === "04010004" && Number(r.borc) > 0
  );
  assert.equal(borc04.hesapKodu, "320.10.O0004");
  assert.equal(borc04.belgeTuru, "DK");
  assert.ok(
    !borc04.onerilenHesapKodu || borc04.onerilenHesapKodu === "102.01.002"
  );

  const sameFisMuk = result.standardLucaRows.filter(
    (r) =>
      String(r.fisNo) === "04010003" &&
      String(r.kontrolNotu || "").includes("Mükerrer belge no")
  );
  assert.equal(sameFisMuk.length, 0);
});

const desktopXlsx = (() => {
  const desktop = path.join(
    process.env.USERPROFILE || process.env.HOME || "",
    "Desktop"
  );
  try {
    const name = fs
      .readdirSync(desktop)
      .find((f) => f.includes("Nisan 2026") && f.toLowerCase().endsWith(".xlsx"));
    return name ? path.join(desktop, name) : "";
  } catch {
    return "";
  }
})();

if (desktopXlsx && fs.existsSync(desktopXlsx)) {
  test("Nisan 2026 Excel acceptance: drift, Dok Tipi, mükerrer, O0004", () => {
    const buf = fs.readFileSync(desktopXlsx);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const wb = safeRead(ab, { type: "array", cellDates: true });
    const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
      defval: "",
      raw: false,
    });
    const filtered = rawRows.filter((r) => r["Fiş Numarası"] || r["Fiş No"]);
    assert.equal(filtered.length, 558);

    const allCodes = [
      ...new Set(
        filtered
          .map((r) => String(getRowValue(r, "Hesap Kodu") || "").trim())
          .filter(Boolean)
      ),
    ];
    const plan = allCodes
      .filter((c) => c !== "320.10.O0004")
      .map((hesapKodu) => ({ hesapKodu, hesapAdi: hesapKodu }));
    plan.push({ hesapKodu: "102.01.002", hesapAdi: "VAKIFBANK TL" });

    const memory = [
      {
        account_code: "102.01.002",
        keyword: "ODEME YAPILDI",
        source_module: "ELEKTRAWEB",
        is_active: true,
      },
    ];

    const result = processElektrawebWorkbook(wb, {
      firmaId: "x",
      accountPlan: plan,
      learningMemory: memory,
      companyMappings: { companyId: "x", kuralMotoruRules: [] },
    });

    assert.equal(result.toplamSatir, 558);
    assert.equal(result.toplamFis, 174);
    assert.equal(result.dengeliFis, 174);

    const byId = new Map(
      filtered.map((raw, index) => {
        const n = normalizeElektrawebRawToStandardLucaRow(raw, { index });
        return [
          n.id,
          {
            dokTipi: String(getRowValue(raw, "Dok Tipi") || "").trim(),
            hesap: String(getRowValue(raw, "Hesap Kodu") || "").trim(),
            acik: String(getRowValue(raw, "Açıklama", "Detay Notları") || "").trim(),
            borc: parseMoneyTR(
              getRowValue(raw, "Borç", "Borc", "Toplam Borç", "Toplam Borc")
            ),
            alacak: parseMoneyTR(getRowValue(raw, "Alacak", "Toplam Alacak")),
          },
        ];
      })
    );

    let belgeDrift = 0;
    let hesapOverwrite = 0;
    let borcDrift = 0;
    let alacakDrift = 0;
    let acikDrift = 0;
    let sameFisMukerrer = 0;

    const firstFisByBelge = new Map();
    for (const row of result.standardLucaRows) {
      const src = byId.get(row.id);
      assert.ok(src, `missing source for id ${row.id}`);
      if (src.dokTipi.toUpperCase() !== String(row.belgeTuru || "").toUpperCase()) {
        belgeDrift += 1;
      }
      if (src.hesap && src.hesap !== String(row.hesapKodu || "").trim()) {
        hesapOverwrite += 1;
      }
      if (Number(src.borc || 0) !== Number(row.borc || 0)) borcDrift += 1;
      if (Number(src.alacak || 0) !== Number(row.alacak || 0)) alacakDrift += 1;
      if (src.acik !== String(row.detayAciklama || "").trim()) acikDrift += 1;

      const belge = String(row.belgeNo || row.evrakNo || "").trim();
      const flagged = String(row.kontrolNotu || "").includes("Mükerrer belge no");
      if (belge && belge.length > 5) {
        if (!firstFisByBelge.has(belge)) {
          firstFisByBelge.set(belge, String(row.fisNo));
        } else if (flagged && firstFisByBelge.get(belge) === String(row.fisNo)) {
          // flagged while only seen in same fis so far — count later via algorithm
        }
      }
    }

    // Same-fiş FP: flagged rows whose belge only appears in one fis
    const belgeFis = new Map();
    for (const row of result.standardLucaRows) {
      const belge = String(row.belgeNo || row.evrakNo || "").trim();
      if (!belge || belge.length <= 5) continue;
      if (!belgeFis.has(belge)) belgeFis.set(belge, new Set());
      belgeFis.get(belge).add(String(row.fisNo));
    }
    for (const row of result.standardLucaRows) {
      if (!String(row.kontrolNotu || "").includes("Mükerrer belge no")) continue;
      const belge = String(row.belgeNo || row.evrakNo || "").trim();
      if ((belgeFis.get(belge)?.size || 0) < 2) sameFisMukerrer += 1;
    }

    assert.equal(belgeDrift, 0, `belge türü drift=${belgeDrift}`);
    assert.equal(hesapOverwrite, 0, `hesap overwrite=${hesapOverwrite}`);
    assert.equal(borcDrift, 0);
    assert.equal(alacakDrift, 0);
    assert.equal(acikDrift, 0);
    assert.equal(sameFisMukerrer, 0);

    const o0004 = result.standardLucaRows.filter(
      (r) => String(r.hesapKodu) === "320.10.O0004"
    );
    assert.ok(o0004.length >= 2);
    assert.ok(o0004.every((r) => r.riskDurumu === "HESAP_EKSIK"));

    const borc04 = result.standardLucaRows.find(
      (r) =>
        String(r.fisNo) === "04010004" &&
        String(r.kaynakHesapKodu || "") === "320.10.O0004"
    );
    assert.ok(borc04);
    assert.equal(borc04.hesapKodu, "320.10.O0004");
    assert.notEqual(borc04.hesapKodu, "102.01.002");

    assert.ok(result.mukerrerBelgeSayisi >= 1);
    assert.ok(Array.isArray(result.mukerrerBelgeListesi));
    console.log("  mukerrerBelgeListesi", result.mukerrerBelgeListesi);

    const exportGate = assertElektrawebNoHesapEksikForExport(result.standardLucaRows);
    assert.equal(exportGate.ok, false);
    assert.ok(exportGate.missingKaynakHesapKodlari.includes("320.10.O0004"));
    assert.match(exportGate.message, /320\.10\.O0004/);

    const adapterGate = prepareElektrawebExportRows(result.standardLucaRows, {
      companyId: "x",
    });
    assert.equal(adapterGate.ok, false);
    assert.equal(adapterGate.gate.code, "HESAP_EKSIK");
  });
} else {
  console.log("skip - Nisan 2026 Excel not on Desktop");
}

test("Export gate blocks while HESAP_EKSIK remains; clears after all manual targets", () => {
  const rows = [
    {
      "Fiş Numarası": "1",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "320.10.O0004",
      "Dok Tipi": "DK",
      Açıklama: "Ödeme Yapıldı(VAKIFBANK TL)",
      Borç: "10,00",
      Alacak: "0,00",
    },
    {
      "Fiş Numarası": "1",
      "Fiş Tarihi": "01.04.2026",
      "Hesap Kodu": "999.99.X001",
      "Dok Tipi": "DK",
      Açıklama: "Karşı satır",
      Borç: "0,00",
      Alacak: "10,00",
    },
  ];
  const plan = [
    { hesapKodu: "102.01.002", hesapAdi: "VAKIFBANK TL" },
    { hesapKodu: "320.01", hesapAdi: "320.01" },
  ];
  const result = processElektrawebWorkbook(sheetFromRows(rows), {
    firmaId: "x",
    accountPlan: plan,
    learningMemory: [],
    companyMappings: { companyId: "x", kuralMotoruRules: [] },
  });

  const missing = collectElektrawebHesapEksikKaynakKodlari(result.standardLucaRows);
  assert.ok(missing.includes("320.10.O0004"));
  assert.ok(missing.includes("999.99.X001"));
  assert.equal(assertElektrawebNoHesapEksikForExport(result.standardLucaRows).ok, false);

  // Resolve only one row — export must stay blocked
  const partial = result.standardLucaRows.map((row) => {
    if (row.kaynakHesapKodu !== "320.10.O0004") return row;
    return applyElektrawebEditDraft(row, {
      accountCode: "102.01.002",
      documentType: row.belgeTuru,
      description: row.detayAciklama,
      borc: row.borc,
      alacak: row.alacak,
      controlNote: "",
    });
  });
  const rematchedPartial = buildElektrawebPreviewRows(partial, {
    firmaId: "x",
    accountPlan: plan,
    selectedCompanyAccountPlan: plan,
    learningMemory: [],
    companyMappings: { companyId: "x", kuralMotoruRules: [] },
  });
  assert.equal(assertElektrawebNoHesapEksikForExport(rematchedPartial).ok, false);
  assert.deepEqual(
    collectElektrawebHesapEksikKaynakKodlari(rematchedPartial),
    ["999.99.X001"]
  );

  const resolvedO0004 = rematchedPartial.find((r) => r.kaynakHesapKodu === "320.10.O0004");
  assert.equal(resolvedO0004.kaynakHesapKodu, "320.10.O0004");
  assert.equal(resolvedO0004.hesapKodu, "102.01.002");
  assert.equal(resolvedO0004.manuallyEdited, true);
  assert.notEqual(resolvedO0004.riskDurumu, "HESAP_EKSIK");

  // Resolve remaining — export opens
  const full = rematchedPartial.map((row) => {
    if (row.kaynakHesapKodu !== "999.99.X001") return row;
    return applyElektrawebEditDraft(row, {
      accountCode: "320.01",
      documentType: row.belgeTuru,
      description: row.detayAciklama,
      borc: row.borc,
      alacak: row.alacak,
      controlNote: "",
    });
  });
  const rematchedFull = buildElektrawebPreviewRows(full, {
    firmaId: "x",
    accountPlan: plan,
    selectedCompanyAccountPlan: plan,
    learningMemory: [],
    companyMappings: { companyId: "x", kuralMotoruRules: [] },
  });
  const openGate = assertElektrawebNoHesapEksikForExport(rematchedFull);
  assert.equal(openGate.ok, true);
  assert.deepEqual(openGate.missingKaynakHesapKodlari, []);
  assert.equal(prepareElektrawebExportRows(rematchedFull, { companyId: "x" }).ok, true);
});

console.log(`\n${passed} tests passed`);
