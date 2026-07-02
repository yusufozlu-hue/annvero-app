import * as XLSX from "xlsx";
import { BULK_EXCEL_HEADERS } from "@/src/config/kidemIhbarBulkDefaults";

function rowToExcelLine(row) {
  return [
    row.adSoyad,
    row.tcKimlikNo,
    row.iseGirisTarihi,
    row.istenCikisTarihi,
    row.brutUcret,
    row.yemekYardimi,
    row.yolYardimi,
    row.duzenliYanHaklar,
    row.cikisNedeni,
    row.ihbarKullandirildi ? "Evet" : "Hayır",
    row.kullanilmayanIzinGunu,
    row.calismaSuresi,
    row.kidemTazminati,
    row.ihbarTazminati,
    row.damgaVergisi,
    row.gelirVergisi,
    row.kullanilmayanIzinUcreti,
    row.toplamVergi,
    row.netOdeme,
    (row.errors || []).join(" | "),
    (row.warnings || []).join(" | "),
  ];
}

const DETAIL_HEADERS = [
  "Ad Soyad",
  "TC Kimlik No",
  "İşe Giriş",
  "İşten Çıkış",
  "Brüt Ücret",
  "Yemek Yardımı",
  "Yol Yardımı",
  "Düzenli Yan Haklar",
  "Çıkış Nedeni",
  "İhbar Kullandırıldı",
  "Kullanılmayan İzin Günü",
  "Çalışma Süresi",
  "Kıdem Tazminatı",
  "İhbar Tazminatı",
  "Damga Vergisi",
  "Gelir Vergisi",
  "Kullanılmayan İzin Ücreti",
  "Toplam Vergi",
  "Net Ödeme",
  "Hatalar",
  "Uyarılar",
];

export function buildBulkDetailSheetRows(rows = []) {
  return [DETAIL_HEADERS, ...rows.map(rowToExcelLine)];
}

export function buildBulkSummarySheetRows(summary = {}, meta = {}) {
  return [
    ["Toplu Kıdem ve İhbar Tazminat Özeti"],
    ["Firma", meta.firmaAdi || ""],
    ["Parametre Kaynağı", meta.paramSource || ""],
    [],
    ["Personel Sayısı", summary.personelSayisi ?? 0],
    ["Başarılı Hesap", summary.basariliPersonel ?? 0],
    ["Hatalı Kayıt", summary.hataliPersonel ?? 0],
    ["Toplam Kıdem", summary.toplamKidem ?? 0],
    ["Toplam İhbar", summary.toplamIhbar ?? 0],
    ["Toplam Vergi", summary.toplamVergi ?? 0],
    ["Toplam Net Ödeme", summary.toplamNetOdeme ?? 0],
  ];
}

export function buildBulkErrorSheetRows(rows = []) {
  const errorRows = rows.filter((row) => row.hasError);
  return [DETAIL_HEADERS, ...errorRows.map(rowToExcelLine)];
}

export function downloadPersonelBulkTemplate(fileName = "toplu-kidem-ihbar-sablonu") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([BULK_EXCEL_HEADERS]),
    "Personel Listesi"
  );
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

export function exportKidemIhbarBulkWorkbook({
  rows = [],
  summary = {},
  meta = {},
  fileName = "toplu-kidem-ihbar",
}) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildBulkSummarySheetRows(summary, meta)),
    "Toplam Özet"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildBulkDetailSheetRows(rows)),
    "Personel Detay"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildBulkErrorSheetRows(rows)),
    "Hata Eksik Bilgi"
  );

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
  return { ok: true };
}
