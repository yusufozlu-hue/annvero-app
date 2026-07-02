import * as XLSX from "xlsx";
import { E_DEFTER_KONTROL_GRUP } from "@/src/config/eDefterKontrolDefaults";

function rowToExcelLine(row) {
  return [
    row.tarih,
    row.fisNo,
    row.yevmiyeNo,
    row.hesapKodu,
    row.hesapAdi,
    row.aciklama,
    row.belgeTuru,
    row.belgeNo,
    row.borc,
    row.alacak,
    row.kaynak,
    row.grup,
    row.durum,
    row.riskScore,
    row.riskBand,
    row.duzeltildiMi ? "Evet" : "Hayır",
    (row.issues || []).join(" | "),
    row.not,
    row.kontrolDurumu,
  ];
}

const HEADERS = [
  "Tarih",
  "Fiş No",
  "Yevmiye No",
  "Hesap Kodu",
  "Hesap Adı",
  "Açıklama",
  "Belge Türü",
  "Belge No",
  "Borç",
  "Alacak",
  "Kaynak",
  "Grup",
  "Durum",
  "Risk Puanı",
  "Risk Bandı",
  "Düzeltildi mi",
  "Sorunlar",
  "Not",
  "Kontrol Durumu",
];

export function buildEDefterSheetRows(rows = []) {
  return [HEADERS, ...rows.map(rowToExcelLine)];
}

export function buildEDefterOzetRows(summary = {}, meta = {}) {
  return [
    ["E-Defter Kontrol Özeti"],
    ["Firma", meta.firmaAdi || ""],
    ["Dönem", meta.donem || ""],
    [],
    ["Toplam Fiş", summary.toplamFis ?? 0],
    ["Toplam Satır", summary.toplamSatir ?? 0],
    ["Kritik Hata", summary.kritikHata ?? 0],
    ["Yüksek Risk", summary.yuksekRisk ?? 0],
    ["Mükerrer Risk", summary.mukerrerRisk ?? 0],
    ["Ters Bakiye", summary.tersBakiye ?? 0],
    ["Eksik Bilgi", summary.eksikBilgi ?? 0],
  ];
}

export function exportEDefterReportWorkbook({
  rows = [],
  summary = {},
  meta = {},
  fileName = "e-defter-kontrol",
}) {
  const activeRows = rows.filter((row) => !row.disaridaBirak);
  const kritikRows = activeRows.filter((row) => row.grup === E_DEFTER_KONTROL_GRUP.KRITIK);
  const mukerrerRows = activeRows.filter((row) => row.grup === E_DEFTER_KONTROL_GRUP.MUKERRER);
  const tersBakiyeRows = activeRows.filter((row) => row.grup === E_DEFTER_KONTROL_GRUP.TERS_BAKIYE);
  const donemSonuRows = activeRows.filter((row) => row.grup === E_DEFTER_KONTROL_GRUP.DONEM_SONU);

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterOzetRows(summary, meta)),
    "Özet"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(activeRows)),
    "Tüm Kontrol Listesi"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(kritikRows)),
    "Kritik Hatalar"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(mukerrerRows)),
    "Mükerrer Riskler"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(tersBakiyeRows)),
    "Ters Bakiye"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(donemSonuRows)),
    "Dönem Sonu Uyarıları"
  );

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
  return { ok: true };
}
