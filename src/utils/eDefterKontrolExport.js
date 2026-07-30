import * as XLSX from "xlsx";
import {
  E_DEFTER_KONTROL_GRUP,
  E_DEFTER_REPORT_DISCLAIMER,
  E_DEFTER_SONUC_SEVIYE,
} from "@/src/config/eDefterKontrolDefaults";

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
    row.hataTuru,
    row.riskScore,
    row.riskLevel,
    row.sonucSeviye,
    row.riskBand,
    row.onerilenKontrol,
    row.cozumDurumu,
    row.duzeltildiMi ? "Evet" : "Hayır",
    (row.issues || []).join(" | "),
    row.smartExplanation,
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
  "Hata Türü",
  "Risk Puanı",
  "Risk Seviyesi",
  "Sonuç Seviyesi",
  "Risk Bandı",
  "Önerilen Kontrol",
  "Çözüm Durumu",
  "Düzeltildi mi",
  "Sorunlar",
  "Akıllı Açıklama",
  "Not",
  "Kontrol Durumu",
];

export function canApproveEDefterExportLocal(overallSonuc) {
  return overallSonuc !== E_DEFTER_SONUC_SEVIYE.KRITIK;
}

export function buildEDefterSheetRows(rows = []) {
  return [HEADERS, ...rows.map(rowToExcelLine)];
}

export function buildEDefterOzetRows(summary = {}, meta = {}) {
  return [
    ["E-Defter Kontrol — Yönetici Özeti"],
    ["Firma", meta.firmaAdi || ""],
    ["Dönem", meta.donem || ""],
    ["Uygulama Sürümü", meta.appVersion || meta.buildLabel || ""],
    ["Genel Sonuç", summary.overallSonuc || ""],
    ["E-Defter Uygun", summary.edefterUygun ? "Evet" : "Hayır"],
    [],
    ["Toplam Fiş", summary.toplamFis ?? 0],
    ["Toplam Satır", summary.toplamSatir ?? 0],
    ["Yüklenen Defter", summary.yuklenenDefterSayisi ?? 0],
    ["Kritik Hata", summary.kritikHata ?? 0],
    ["Uyarı", summary.uyariSayisi ?? 0],
    ["Teknik Hata", summary.teknikHata ?? 0],
    ["Vergisel Risk", summary.vergiselRisk ?? 0],
    ["Yüksek Risk", summary.yuksekRisk ?? 0],
    ["Mükerrer Risk", summary.mukerrerRisk ?? 0],
    ["Ters Bakiye", summary.tersBakiye ?? 0],
    ["Eksik Bilgi", summary.eksikBilgi ?? 0],
    [],
    ["Uyarı / Disclaimer", meta.disclaimer || E_DEFTER_REPORT_DISCLAIMER],
  ];
}

export function exportEDefterReportWorkbook({
  rows = [],
  summary = {},
  meta = {},
  fileName = "e-defter-kontrol",
  force = false,
  writeFile = true,
}) {
  const overall = summary.overallSonuc || "";
  if (!force && !canApproveEDefterExportLocal(overall)) {
    return {
      ok: false,
      blocked: true,
      message: "Kritik hata varken onaylı E-Defter uygun export'u yapılamaz.",
    };
  }

  const activeRows = rows.filter((row) => !row.disaridaBirak);
  const kritikRows = activeRows.filter((row) => row.grup === E_DEFTER_KONTROL_GRUP.KRITIK);
  const mukerrerRows = activeRows.filter((row) => row.grup === E_DEFTER_KONTROL_GRUP.MUKERRER);
  const tersBakiyeRows = activeRows.filter((row) => row.grup === E_DEFTER_KONTROL_GRUP.TERS_BAKIYE);
  const donemSonuRows = activeRows.filter((row) => row.grup === E_DEFTER_KONTROL_GRUP.DONEM_SONU);
  const teknikRows = activeRows.filter((row) => row.grup === E_DEFTER_KONTROL_GRUP.TEKNIK);
  const vergiselRows = activeRows.filter((row) => row.grup === E_DEFTER_KONTROL_GRUP.VERGISEL);
  const caprazRows = activeRows.filter((row) => row.grup === E_DEFTER_KONTROL_GRUP.CAPRAZ);

  const workbook = XLSX.utils.book_new();
  const reportMeta = {
    ...meta,
    disclaimer: meta.disclaimer || E_DEFTER_REPORT_DISCLAIMER,
  };

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterOzetRows(summary, reportMeta)),
    "Yonetici Ozeti"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(activeRows)),
    "Tum Kontrol Listesi"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(kritikRows)),
    "Kritik Hatalar"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(mukerrerRows)),
    "Mukerrer Riskler"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(tersBakiyeRows)),
    "Ters Bakiye"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(donemSonuRows)),
    "Donem Sonu"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(teknikRows)),
    "Teknik"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(vergiselRows)),
    "Vergisel"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildEDefterSheetRows(caprazRows)),
    "Capraz Mutabakat"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Disclaimer"],
      [E_DEFTER_REPORT_DISCLAIMER],
      ["App Version", reportMeta.appVersion || reportMeta.buildLabel || ""],
    ]),
    "Disclaimer"
  );

  if (writeFile && typeof XLSX.writeFile === "function") {
    XLSX.writeFile(workbook, `${fileName}.xlsx`);
  }

  return { ok: true, workbook, sheetCount: workbook.SheetNames?.length || 0 };
}

export function prepareEDefterPdfReport({ summary = {}, meta = {} } = {}) {
  return {
    ready: true,
    title: "ANNVERO E-Defter Kontrol Raporu",
    overallSonuc: summary.overallSonuc || "",
    disclaimer: E_DEFTER_REPORT_DISCLAIMER,
    appVersion: meta.appVersion || meta.buildLabel || "",
    message: "PDF özeti hazır (yazdırılabilir HTML/metin). GİB doğrulaması içermez.",
  };
}

/** Test/CI: workbook üret, dosya yazmadan */
export function buildEDefterReportWorkbookInMemory(args = {}) {
  return exportEDefterReportWorkbook({ ...args, force: true, writeFile: false });
}
