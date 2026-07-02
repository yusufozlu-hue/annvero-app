import * as XLSX from "xlsx";
import { KDV_KONTROL_GRUP } from "@/src/config/kdvMatrahKontrolDefaults";

function rowToExcelLine(row) {
  return [
    row.tarih,
    row.belgeNo,
    row.cariUnvan,
    row.vergiNo,
    row.matrah,
    row.kdvOrani,
    row.kdvTutari,
    row.toplamTutar,
    row.tevkifat,
    row.istisnaKodu,
    row.kaynak,
    row.grup,
    row.durum,
    row.riskScore,
    row.riskBand,
    row.kdvFarki,
    (row.issues || []).join(" | "),
    row.aciklama,
  ];
}

const HEADERS = [
  "Tarih",
  "Belge No",
  "Cari Ünvan",
  "Vergi No",
  "Matrah",
  "KDV Oranı",
  "KDV Tutarı",
  "Toplam Tutar",
  "Tevkifat",
  "İstisna Kodu",
  "Kaynak",
  "Grup",
  "Durum",
  "Risk Puanı",
  "Risk Bandı",
  "KDV Farkı",
  "Sorunlar",
  "Açıklama",
];

export function buildKdvMatrahSheetRows(rows = []) {
  return [HEADERS, ...rows.map(rowToExcelLine)];
}

export function buildKdvMatrahOzetRows(summary = {}, meta = {}) {
  return [
    ["KDV Matrah Kontrol Özeti"],
    ["Firma", meta.firmaAdi || ""],
    [],
    ["Toplam Belge", summary.toplamBelge ?? 0],
    ["Hatasız Belge", summary.hatasizBelge ?? 0],
    ["Riskli Belge", summary.riskliBelge ?? 0],
    ["KDV Farkı Toplamı", summary.kdvFarkiToplami ?? 0],
    ["Mükerrer Risk Sayısı", summary.mukerrerRiskSayisi ?? 0],
    ["Eksik Bilgi Sayısı", summary.eksikBilgiSayisi ?? 0],
  ];
}

export function exportKdvMatrahReportWorkbook({
  rows = [],
  summary = {},
  meta = {},
  fileName = "kdv-matrah-kontrol",
}) {
  const activeRows = rows.filter((row) => !row.disaridaBirak);
  const hataliRows = activeRows.filter((row) => row.grup !== KDV_KONTROL_GRUP.HATASIZ);
  const mukerrerRows = activeRows.filter((row) => row.grup === KDV_KONTROL_GRUP.MUKERRER);
  const kdvFarkRows = activeRows.filter((row) => row.grup === KDV_KONTROL_GRUP.KDV_FARKI);

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildKdvMatrahOzetRows(summary, meta)),
    "Özet"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildKdvMatrahSheetRows(activeRows)),
    "Tüm Liste"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildKdvMatrahSheetRows(hataliRows)),
    "Hatalılar"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildKdvMatrahSheetRows(mukerrerRows)),
    "Mükerrer Risk"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildKdvMatrahSheetRows(kdvFarkRows)),
    "KDV Fark"
  );

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
  return { ok: true };
}
