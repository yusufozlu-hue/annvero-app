import * as XLSX from "xlsx";
import { parseDateTR } from "@/src/utils/formatDateTR";
import { exportStandardLucaExcel } from "@/src/utils/exportStandardLucaExcel";
import { buildAdatLucaRows } from "@/src/utils/adatHesaplamaEngine";

function validateLucaBalance(lucaRows = []) {
  const fisTotals = new Map();

  for (const row of lucaRows) {
    const fisNo = String(row.fisNo || "");
    if (!fisTotals.has(fisNo)) fisTotals.set(fisNo, { borc: 0, alacak: 0 });
    const bucket = fisTotals.get(fisNo);
    bucket.borc += Number(row.borc || 0);
    bucket.alacak += Number(row.alacak || 0);
  }

  const errors = [];
  fisTotals.forEach((totals, fisNo) => {
    if (Math.abs(totals.borc - totals.alacak) >= 0.01) {
      errors.push(`Fiş ${fisNo}: borç/alacak toplamı eşit değil.`);
    }
  });

  return errors;
}

export function validateAdatExport(params = {}) {
  const errors = [];

  if (!params.yillikFaizOrani && params.yillikFaizOrani !== 0) {
    errors.push("Yıllık faiz oranı boş olamaz.");
  }

  const start = parseDateTR(params.donemBaslangic);
  const end = parseDateTR(params.donemBitis);

  if (!start || !end) {
    errors.push("Hesap dönemi başlangıç ve bitiş tarihleri geçerli olmalıdır.");
  } else if (end < start) {
    errors.push("Bitiş tarihi başlangıçtan önce olamaz.");
  }

  if (!params.selectedAccounts?.length) {
    errors.push("Adat hesaplanacak en az bir hesap seçilmelidir.");
  }

  if (!params.muavinLoaded) {
    errors.push("Muavin Excel dosyası yüklenmelidir.");
  }

  if (params.muavinLoaded && !params.balanceCalculable) {
    errors.push("Seçilen hesaplar için bakiye hesaplanamıyor.");
  }

  if (!params.previewRows?.length) {
    errors.push("Önizleme satırı bulunamadı.");
  }

  const lucaErrors = validateLucaBalance(params.lucaRows || []);
  errors.push(...lucaErrors);

  return {
    ok: errors.length === 0,
    errors,
    hasBlockingErrors: errors.length > 0,
  };
}

export function buildAdatOzetSheetRows(summary = {}, meta = {}) {
  return [
    ["Adat Hesaplama Özeti"],
    ["Firma", meta.firmaAdi || ""],
    ["Dönem Başlangıç", meta.donemBaslangic || ""],
    ["Dönem Bitiş", meta.donemBitis || ""],
    ["Yıllık Faiz Oranı (%)", meta.yillikFaizOrani ?? ""],
    ["Gün Bazı", meta.gunBazi ?? ""],
    ["Hesaplama Modu", meta.hesaplamaModu || ""],
    [],
    ["Toplam Adat Tutarı", summary.toplamAdatTutari ?? 0],
    ["Toplam Faiz Geliri", summary.toplamFaizGeliri ?? 0],
    ["Toplam Faiz Gideri", summary.toplamFaizGideri ?? 0],
    ["Günlük Ortalama Bakiye", summary.gunlukOrtalamaBakiye ?? 0],
    ["Hesaplanan Gün Sayısı", summary.hesaplananGunSayisi ?? 0],
    ["İşlem Yapılan Hesap Sayısı", summary.islemYapilanHesapSayisi ?? 0],
  ];
}

export function buildGunlukDetaySheetRows(previewRows = []) {
  return [
    [
      "Tarih",
      "Dönem",
      "Hesap Kodu",
      "Hesap Adı",
      "Bakiye",
      "Gün",
      "Faiz Oranı",
      "Günlük Faiz",
      "Faiz Yönü",
      "Faiz Hesabı",
      "Açıklama",
    ],
    ...previewRows.map((row) => [
      row.tarih,
      row.donem,
      row.hesapKodu,
      row.hesapAdi,
      row.bakiye,
      row.gunSayisi,
      row.faizOrani,
      row.gunlukFaiz,
      row.faizYonu,
      row.faizHesap,
      row.aciklama,
    ]),
  ];
}

export function buildHesapOzetSheetRows(accountSummary = []) {
  return [
    ["Hesap Kodu", "Hesap Adı", "Toplam Faiz", "Ortalama Bakiye", "Gün Sayısı", "Faiz Yönü"],
    ...accountSummary.map((row) => [
      row.hesapKodu,
      row.hesapAdi,
      row.toplamFaiz,
      row.ortalamaBakiye,
      row.gunSayisi,
      row.faizYonu,
    ]),
  ];
}

export function buildAylikOzetSheetRows(monthlySummary = []) {
  return [
    ["Dönem", "Hesap Kodu", "Hesap Adı", "Toplam Faiz", "Ortalama Bakiye", "Gün Sayısı"],
    ...monthlySummary.map((row) => [
      row.donem,
      row.hesapKodu,
      row.hesapAdi,
      row.toplamFaiz,
      row.ortalamaBakiye,
      row.gunSayisi,
    ]),
  ];
}

export function exportAdatReportWorkbook({
  summary = {},
  meta = {},
  previewRows = [],
  accountSummary = [],
  monthlySummary = [],
  fileName = "adat-hesaplama-rapor",
}) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildAdatOzetSheetRows(summary, meta)),
    "Özet"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildGunlukDetaySheetRows(previewRows)),
    "Günlük Detay"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildHesapOzetSheetRows(accountSummary)),
    "Hesap Özet"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildAylikOzetSheetRows(monthlySummary)),
    "Aylık Özet"
  );

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
  return { ok: true };
}

export async function exportAdatLucaExcel(previewRows = [], context = {}) {
  const lucaRows = buildAdatLucaRows(previewRows, context);

  if (!lucaRows.length) {
    return { ok: false, message: "Luca fiş satırı oluşturulamadı." };
  }

  const balanceErrors = validateLucaBalance(lucaRows);
  if (balanceErrors.length) {
    return {
      ok: false,
      reason: "validation",
      errors: balanceErrors,
      message: balanceErrors.join("\n"),
    };
  }

  const result = await exportStandardLucaExcel(lucaRows, {
    filePrefix: context.filePrefix || "adat-luca",
    logLabel: "adat-luca-export",
    ignoreWarnings: true,
  });

  return { ...result, lucaRows };
}

export async function exportAdatFullPack({
  summary = {},
  meta = {},
  previewRows = [],
  accountSummary = [],
  monthlySummary = [],
  context = {},
}) {
  exportAdatReportWorkbook({
    summary,
    meta,
    previewRows,
    accountSummary,
    monthlySummary,
    fileName: context.reportFileName || "adat-hesaplama-rapor",
  });

  const lucaResult = await exportAdatLucaExcel(previewRows, {
    ...context,
    filePrefix: context.lucaFilePrefix || "adat-luca",
  });

  if (!lucaResult.ok) return lucaResult;
  return { ok: true, lucaFileCount: lucaResult.fileCount };
}
