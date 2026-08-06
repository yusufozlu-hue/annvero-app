/**
 * Fiş Kontrol Merkezi — otomatik kabul matrisi.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-fis-kontrol-merkezi.mjs
 * Gerçek VakıfBank xlsx varsa yalnız yerel offline performans ölçer; içerik loglanmaz.
 */
import fs from "node:fs";
import path from "node:path";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else {
    console.log(`PASS  ${msg}`);
  }
}

const {
  analyzeStandardLucaRows,
  filterPassedRowsForExport,
  buildPassedExportPayload,
  groupLucaFisBatches,
  applySessionVoucherDedup,
  toCanonicalVoucherRow,
  KONTROL_SEVIYE,
  KONTROL_DURUM,
  DUPLICATE_VOUCHER_UI_MESSAGE,
  LUCA_FIS_GROUP_SIZE,
} = await import("@/src/utils/fisKontrolMerkezi.js");

function row(partial) {
  return {
    firmaId: "c1",
    fisNo: "1",
    fisTarihi: "15.01.2026",
    fisAciklama: "Test",
    detayAciklama: "Test",
    belgeTuru: "DK",
    evrakNo: "E1",
    hesapKodu: "102.01.001",
    hesapAdi: "Banka",
    borc: "",
    alacak: "",
    kaynakTipi: "BANKA",
    ...partial,
  };
}

// 1) Dengeli / dengesiz
{
  const balanced = analyzeStandardLucaRows([
    row({ borc: 100, alacak: "", hesapKodu: "102.01" }),
    row({ borc: "", alacak: 100, hesapKodu: "320.01" }),
  ]);
  assert(balanced.summary.isBalanced, "dengeli fiş");
  assert(balanced.summary.gectiRowCount === 2, "dengeli → Geçti");

  const unbalanced = analyzeStandardLucaRows([
    row({ borc: 100, alacak: "", hesapKodu: "102.01" }),
    row({ borc: "", alacak: 50, hesapKodu: "320.01" }),
  ]);
  assert(!unbalanced.summary.isBalanced, "dengesiz fiş");
  assert(unbalanced.summary.hataRowCount === 2, "dengesiz → Hata satırları");
  assert(
    filterPassedRowsForExport(unbalanced).length === 0,
    "dengesiz export yok"
  );
}

// 2) Eksik / geçersiz hesap + plan
{
  const missing = analyzeStandardLucaRows([row({ borc: 10, hesapKodu: "" })]);
  assert(
    missing.issues.some((i) => i.type.includes("Eksik hesap")),
    "eksik hesap"
  );
  const plan = analyzeStandardLucaRows(
    [row({ borc: 10, alacak: "", hesapKodu: "999.99" }), row({ borc: "", alacak: 10, hesapKodu: "102.01" })],
    { accountPlanCodes: new Set(["102.01", "320.01"]) }
  );
  assert(
    plan.issues.some((i) => i.message.includes("hesap planında")),
    "hesap planında yok"
  );
}

// 3) Mükerrer hareket / kaynak
{
  const a = row({
    borc: 25,
    sourceMovementId: "mv-1",
    detayAciklama: "Aynı",
    fisNo: "10",
  });
  const b = row({
    borc: 25,
    sourceMovementId: "mv-1",
    detayAciklama: "Aynı",
    fisNo: "11",
    hesapKodu: "102.02",
  });
  const dup = analyzeStandardLucaRows([a, b]);
  assert(
    dup.issues.some((i) => i.message === DUPLICATE_VOUCHER_UI_MESSAGE),
    "mükerrer kaynak mesajı"
  );

  // Aynı fişte borç+alacak bacakları aynı sourceMovementId — mükerrer değil
  const doubleEntry = analyzeStandardLucaRows([
    row({
      fisNo: "20",
      borc: 100,
      alacak: "",
      hesapKodu: "102.01",
      sourceMovementId: "mv-de",
      lineRole: "borc",
      detayAciklama: "HAVALE",
    }),
    row({
      fisNo: "20",
      borc: "",
      alacak: 100,
      hesapKodu: "320.01",
      sourceMovementId: "mv-de",
      lineRole: "alacak",
      detayAciklama: "HAVALE",
    }),
  ]);
  assert(
    !doubleEntry.issues.some((i) => i.type === "Mükerrer kaynak hareket"),
    "çift kayıt bacakları mükerrer kaynak sayılmaz"
  );
  assert(
    !doubleEntry.issues.some((i) => i.message === DUPLICATE_VOUCHER_UI_MESSAGE),
    "çift kayıt DUPLICATE_VOUCHER üretmez"
  );

  const dedup = applySessionVoucherDedup([a, a], new Set(), "c1");
  assert(dedup.suppressedCount === 1, "session dedup bastırma");
  assert(dedup.unique.length === 1, "session unique");
}

// 4) Döviz
{
  const fx = analyzeStandardLucaRows([
    row({ borc: 100, paraBirimi: "USD", kur: null, hesapKodu: "102.20" }),
    row({ alacak: 100, paraBirimi: "USD", kur: 34.5, hesapKodu: "320.01" }),
  ]);
  assert(
    fx.issues.some((i) => i.message.includes("kur")),
    "döviz kur eksik"
  );
}

// 5) Vergi / SGK
{
  const tax = analyzeStandardLucaRows([
    row({
      borc: 50,
      hesapKodu: "360.01",
      detayAciklama: "KDV gecikme zammı",
      fisAciklama: "KDV gecikme zammı",
    }),
    row({ alacak: 50, hesapKodu: "102.01" }),
  ]);
  assert(
    tax.issues.some((i) => /Gecikme/i.test(i.message)),
    "gecikme 360 karışımı"
  );

  const sgdp = analyzeStandardLucaRows([
    row({
      borc: 10,
      hesapKodu: "361.01",
      detayAciklama: "SGDP prim ödemesi",
      fisAciklama: "SGDP prim ödemesi",
    }),
    row({ alacak: 10, hesapKodu: "102.01" }),
  ]);
  assert(
    sgdp.issues.some((i) => /SGDP/i.test(i.message)),
    "SGDP ayrımı"
  );
}

// 6) MTV / Emlak
{
  const mtv = analyzeStandardLucaRows([
    row({
      borc: 100,
      detayAciklama: "MTV ödeme tahakkuk",
      fisAciklama: "MTV ödeme tahakkuk",
      hesapKodu: "360.03",
    }),
    row({ alacak: 100, hesapKodu: "102.01" }),
  ]);
  assert(
    mtv.issues.some((i) => /tahakkuk/i.test(i.message) || /taksit/i.test(i.message)),
    "MTV taksit/tahakkuk"
  );
}

// 7) Maaş / avans / POS / KK
{
  const maas = analyzeStandardLucaRows([
    row({ borc: 1000, detayAciklama: "Personel maaş ödemesi", hesapKodu: "320.01" }),
    row({ alacak: 1000, hesapKodu: "102.01" }),
  ]);
  assert(maas.issues.some((i) => /335/i.test(i.message)), "maaş 335 uyarısı");
}

// 8) Belge türü
{
  const gib = analyzeStandardLucaRows([
    row({
      borc: 10,
      detayAciklama: "GİB e-Arşiv fatura",
      belgeTuru: "EF",
      hesapKodu: "320.01",
    }),
    row({ alacak: 10, hesapKodu: "102.01", belgeTuru: "EF" }),
  ]);
  assert(gib.issues.some((i) => /EA/i.test(i.message)), "GİB → EA uyarısı");

  const bad = analyzeStandardLucaRows([
    row({ borc: 10, belgeTuru: "XX", hesapKodu: "102.01" }),
    row({ alacak: 10, belgeTuru: "XX", hesapKodu: "320.01" }),
  ]);
  assert(
    bad.issues.some((i) => /Geçersiz belge/i.test(i.message)),
    "geçersiz belge türü"
  );
}

// 9) Kapanmış dönem
{
  const closed = analyzeStandardLucaRows(
    [
      row({ borc: 10, fisTarihi: "10.12.2025", hesapKodu: "102.01" }),
      row({ alacak: 10, fisTarihi: "10.12.2025", hesapKodu: "320.01" }),
    ],
    { closedPeriods: new Set(["2025-12"]) }
  );
  assert(
    closed.issues.some((i) => /Kapanmış dönem/i.test(i.message)),
    "kapanmış dönem"
  );
}

// 10) 50 fiş gruplama
{
  const many = [];
  for (let i = 1; i <= 52; i += 1) {
    many.push(
      row({
        fisNo: String(i),
        borc: 1,
        alacak: "",
        hesapKodu: "102.01",
        detayAciklama: `H${i}`,
        evrakNo: `E-${i}-a`,
        sourceMovementId: `m-${i}-a`,
      })
    );
    many.push(
      row({
        fisNo: String(i),
        borc: "",
        alacak: 1,
        hesapKodu: "320.01",
        detayAciklama: `H${i}`,
        evrakNo: `E-${i}-b`,
        sourceMovementId: `m-${i}-b`,
      })
    );
  }
  const grouped = analyzeStandardLucaRows(many);
  assert(grouped.summary.totalFis === 52, "52 fiş");
  const batches = groupLucaFisBatches(
    filterPassedRowsForExport(grouped),
    LUCA_FIS_GROUP_SIZE
  );
  assert(batches.length === 2, "50+2 gruplama (2 batch)");
  assert(batches[0].length / 2 <= LUCA_FIS_GROUP_SIZE, "ilk batch ≤50 fiş");
}

// 11) Öğrenen hafıza tenant + düşük güven
{
  const low = analyzeStandardLucaRows([
    row({
      borc: 10,
      hesapKodu: "102.01",
      accountMemoryAutoFilled: true,
      hafizaGuvenSkoru: 40,
    }),
    row({ alacak: 10, hesapKodu: "320.01" }),
  ]);
  assert(
    low.issues.some((i) => /Güven skoru düşük/i.test(i.message)),
    "düşük güven otomatik fiş engeli"
  );

  const tenant = analyzeStandardLucaRows(
    [row({ firmaId: "other", borc: 10 }), row({ firmaId: "other", alacak: 10, hesapKodu: "320.01" })],
    { firmaId: "c1" }
  );
  assert(
    tenant.issues.some((i) => /başka firmaya/i.test(i.message)),
    "tenant izolasyonu"
  );
}

// 12) Export güvenliği — yalnız Geçti
{
  const mix = analyzeStandardLucaRows([
    row({ fisNo: "1", borc: 10, hesapKodu: "102.01", sourceMovementId: "ok-a" }),
    row({ fisNo: "1", alacak: 10, hesapKodu: "320.01", sourceMovementId: "ok-b" }),
    row({ fisNo: "2", borc: 5, hesapKodu: "", sourceMovementId: "bad-a", detayAciklama: "Kötü" }),
    row({
      fisNo: "2",
      alacak: 5,
      hesapKodu: "320.01",
      sourceMovementId: "bad-b",
      detayAciklama: "Kötü",
    }),
  ]);
  const exp = buildPassedExportPayload(mix, { firmaId: "c1" });
  assert(exp.ok, "export ok");
  assert(
    exp.rows.every((r) => r._kontrol.kontrolDurumu === KONTROL_DURUM.GECTI),
    "export yalnız Geçti"
  );
  assert(!exp.rows.some((r) => !r.hesapKodu), "export'ta eksik hesap yok");
}

// 13) Deterministik + iptal
{
  const sample = [
    row({ fisNo: "1", borc: 10, sourceMovementId: "d1" }),
    row({ fisNo: "1", alacak: 10, hesapKodu: "320.01", sourceMovementId: "d2" }),
  ];
  const a1 = analyzeStandardLucaRows(sample);
  const a2 = analyzeStandardLucaRows(sample);
  assert(
    JSON.stringify(a1.summary) === JSON.stringify(a2.summary),
    "deterministik summary"
  );

  const ac = new AbortController();
  ac.abort();
  let aborted = false;
  try {
    analyzeStandardLucaRows(sample, { signal: ac.signal });
  } catch (e) {
    aborted = e?.name === "AbortError";
  }
  assert(aborted, "iptal/abort çalışır");
}

// 14) Kanonik model alanları
{
  const c = toCanonicalVoucherRow(
    row({ borc: 1, paraBirimi: "TRY", guvenSkoru: 90, sourceMovementId: "x" })
  );
  assert(c.firmaId === "c1", "kanonik firma");
  assert(c.identityKey, "kanonik identity");
  assert(c.guvenSkoru === 90, "kanonik güven");
  assert(c.kontrolDurumu === null || c.kontrolDurumu, "kanonik kontrol alanı");
}

// 15) Gerçek 1416 offline (opsiyonel)
{
  const realPath = path.join(
    process.env.USERPROFILE || "",
    "Desktop",
    "VAKIFBANK ÖRNEK.xlsx"
  );
  if (!fs.existsSync(realPath)) {
    console.log("INFO  real xlsx yok — 1416 perf skip");
  } else {
    const { parseBankExcelOnMainThread } = await import(
      "@/src/utils/bankExcelMainThreadParse.js"
    );
    const {
      buildParserPreviewFromNormalizedRowsAsync,
      runAccountingAnalysisOnMovementsAsync,
      buildLucaRowsFromMovementsAsync,
    } = await import("@/src/utils/bankParserCore.js");

    const buf = fs.readFileSync(realPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const parsed = await parseBankExcelOnMainThread(null, "VAKIFBANK", null, {
      arrayBuffer: ab,
    });
    assert(
      (parsed.normalizedRows || []).length === 1416,
      "1416 parse"
    );
    const preview = await buildParserPreviewFromNormalizedRowsAsync({
      normalizedRows: parsed.normalizedRows,
      selectedCompanyId: "offline",
      selectedBank: "VAKIFBANK",
    });
    const analysisMoves = await runAccountingAnalysisOnMovementsAsync({
      normalizedRows: parsed.normalizedRows,
      movementRows: preview.movementRows || [],
      selectedCompanyId: "offline",
      selectedBank: "VAKIFBANK",
    });
    const luca = await buildLucaRowsFromMovementsAsync(
      analysisMoves.movementRows || preview.movementRows || [],
      { selectedCompanyId: "offline", selectedBank: "VAKIFBANK" }
    );
    const lucaRows = luca.standardLucaRows || [];
    assert(lucaRows.length === 2832, `Luca 2832 (got ${lucaRows.length})`);

    const t0 = performance.now();
    const kontrol = analyzeStandardLucaRows(lucaRows, { firmaId: "offline" });
    const kontrolMs = Math.round(performance.now() - t0);
    assert(kontrolMs <= 20_000, `kontrol ≤20s (got ${kontrolMs}ms)`);

    const k2 = analyzeStandardLucaRows(lucaRows, { firmaId: "offline" });
    assert(
      JSON.stringify(kontrol.summary) === JSON.stringify(k2.summary),
      "1416 kontrol deterministik"
    );

    console.log(
      JSON.stringify({
        fisKontrol1416: {
          movementCount: 1416,
          lucaRows: lucaRows.length,
          kontrolMs,
          hataRowCount: kontrol.summary.hataRowCount,
          gectiRowCount: kontrol.summary.gectiRowCount,
          isBalanced: kontrol.summary.isBalanced,
        },
      })
    );
  }
}

console.log(failed === 0 ? "\nALL PASSED" : `\nFAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
