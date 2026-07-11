import * as XLSX from "xlsx";
import { exportStandardLucaExcel } from "@/src/utils/exportStandardLucaExcel";
import {
  buildKurDegerlemeLucaRows,
  recalculateKurDegerlemeSummary,
} from "@/src/utils/kurDegerlemeEngine";

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

export function validateKurDegerlemeLucaExport(valuationRows = [], lucaRows = []) {
  const errors = [];
  const warnings = [];
  const rowErrors = [];

  if (!valuationRows.length) {
    errors.push("Değerleme sonucu bulunamadı.");
  }

  for (const row of valuationRows) {
    const issues = [];

    if (!row.hesapKodu) issues.push("Hesap kodu boş.");
    if (row.dovizBakiye === "" || row.dovizBakiye === null || row.dovizBakiye === undefined) {
      issues.push("Döviz bakiye boş.");
    }
    if (!row.kur && row.kur !== 0) issues.push("Kur boş.");
    if (!row.kurFarkiHesap) issues.push("Kur farkı hesabı boş.");
    if (!row.tutar || row.tutar < 0.01) issues.push("Tutar sıfır veya geçersiz.");

    if (issues.length) {
      rowErrors.push({
        rowId: row.id,
        hesapKodu: row.hesapKodu || "—",
        errors: issues,
      });
    }
  }

  const fisTotals = new Map();

  for (const row of lucaRows) {
    const fisNo = String(row.fisNo || "");
    if (!fisTotals.has(fisNo)) {
      fisTotals.set(fisNo, { borc: 0, alacak: 0 });
    }

    const bucket = fisTotals.get(fisNo);
    bucket.borc += roundMoney(row.borc);
    bucket.alacak += roundMoney(row.alacak);

    if (!row.hesapKodu) {
      rowErrors.push({
        rowId: row.id,
        hesapKodu: "—",
        errors: ["Luca satırında hesap kodu boş."],
      });
    }
  }

  let unbalancedCount = 0;

  fisTotals.forEach((totals, fisNo) => {
    if (Math.abs(totals.borc - totals.alacak) >= 0.01) {
      unbalancedCount += 1;
      warnings.push(`Fiş ${fisNo}: borç/alacak toplamı eşit değil.`);
    }
  });

  if (unbalancedCount) {
    errors.push(`${unbalancedCount} fişte borç/alacak toplamı eşit değil.`);
  }

  const flatRowErrors = rowErrors.flatMap((item) =>
    item.errors.map((message) => `${item.hesapKodu}: ${message}`)
  );

  return {
    ok: errors.length === 0 && flatRowErrors.length === 0,
    errors: [...errors, ...flatRowErrors],
    warnings,
    rowErrors,
    hasBlockingErrors: errors.length > 0 || flatRowErrors.length > 0,
  };
}

export function buildKurDegerlemeSummarySheetRows(summary = {}, meta = {}) {
  return [
    ["Kur Değerleme Özeti"],
    ["Firma", meta.firmaAdi || ""],
    ["Değerleme Tarihi", meta.degerlemeTarihi || ""],
    ["Para Birimi", meta.paraBirimi || ""],
    ["TCMB Kur", meta.kur ?? ""],
    ["TCMB Kur Tarihi", meta.tcmbTarih || ""],
    [],
    ["Değerlenen Hesap Sayısı", summary.degerlenenHesapSayisi ?? 0],
    ["Toplam Döviz Bakiye", summary.toplamDovizBakiye ?? 0],
    ["Toplam Kur Farkı Geliri", summary.toplamKurFarkiGeliri ?? 0],
    ["Toplam Kur Farkı Gideri", summary.toplamKurFarkiGideri ?? 0],
    ["Net Kur Farkı", summary.netKurFarki ?? 0],
  ];
}

export function buildKurDegerlemeDetailSheetRows(valuationRows = []) {
  return [
    [
      "Hesap Kodu",
      "Hesap Adı",
      "Para Birimi",
      "Döviz Bakiye",
      "Defter TL",
      "Kur",
      "Değerlenmiş TL",
      "Kur Farkı",
      "Gelir/Gider",
      "Kur Farkı Hesabı",
      "Fiş Tarihi",
      "Açıklama",
      "Tutar",
    ],
    ...valuationRows.map((row) => [
      row.hesapKodu,
      row.hesapAdi,
      row.paraBirimi,
      row.dovizBakiye,
      row.defterTl,
      row.kur,
      row.degerlenmisTl,
      row.kurFarki,
      row.kurFarkiTip === "gelir" ? "Gelir" : row.kurFarkiTip === "gider" ? "Gider" : "",
      row.kurFarkiHesap,
      row.fisTarihi,
      row.aciklama,
      row.tutar,
    ]),
  ];
}

export function exportKurDegerlemeReportWorkbook({
  valuationRows = [],
  summary = {},
  meta = {},
  fileName = "kur-degerleme-rapor",
}) {
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet(
    buildKurDegerlemeSummarySheetRows(summary, meta)
  );
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Değerleme Özeti");

  const detailSheet = XLSX.utils.aoa_to_sheet(
    buildKurDegerlemeDetailSheetRows(valuationRows)
  );
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Hesap Detay");

  XLSX.writeFile(workbook, `${fileName}.xlsx`);

  return { ok: true };
}

export async function exportKurDegerlemeLucaExcel(valuationRows = [], context = {}) {
  const lucaRows = buildKurDegerlemeLucaRows(valuationRows, context);
  const validation = validateKurDegerlemeLucaExport(valuationRows, lucaRows);

  if (validation.hasBlockingErrors) {
    return {
      ok: false,
      reason: "validation",
      validation,
      message: "Luca Excel oluşturulamadı. Lütfen hataları düzeltin.",
    };
  }

  const filePrefix = context.filePrefix || "kur-degerleme-luca";
  const result = await exportStandardLucaExcel(lucaRows, {
    filePrefix,
    logLabel: "kur-degerleme-luca-export",
    ignoreWarnings: true,
    onValidationFail: context.onValidationFail,
  });

  return {
    ...result,
    lucaRows,
    validation,
  };
}

export async function exportKurDegerlemeFullPack({
  valuationRows = [],
  summary = {},
  meta = {},
  context = {},
}) {
  const computedSummary = summary.degerlenenHesapSayisi
    ? summary
    : recalculateKurDegerlemeSummary(valuationRows);

  exportKurDegerlemeReportWorkbook({
    valuationRows,
    summary: computedSummary,
    meta,
    fileName: context.reportFileName || "kur-degerleme-rapor",
  });

  const lucaResult = await exportKurDegerlemeLucaExcel(valuationRows, {
    ...context,
    filePrefix: context.lucaFilePrefix || "kur-degerleme-luca",
  });

  if (!lucaResult.ok) {
    return lucaResult;
  }

  return {
    ok: true,
    lucaFileCount: lucaResult.fileCount,
    summary: computedSummary,
  };
}
