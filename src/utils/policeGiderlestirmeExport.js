import * as XLSX from "xlsx";
import { parseDateTR } from "@/src/utils/formatDateTR";

export function validatePoliceGiderlestirmeExport(params = {}) {
  const errors = [];

  if (!params.policeList?.length) {
    errors.push("Poliçe listesi yüklenmeli veya manuel poliçe eklenmelidir.");
  }

  if (!params.previewRows?.length) {
    errors.push("Hesaplanacak dönem satırı bulunamadı.");
  }

  if (!params.donemYili) {
    errors.push("Dönem yılı seçilmelidir.");
  }

  for (const police of params.policeList || []) {
    if (!police.baslangic) errors.push(`${police.plaka || "Poliçe"}: başlangıç tarihi boş.`);
    if (!police.bitis) errors.push(`${police.plaka || "Poliçe"}: bitiş tarihi boş.`);

    const start = parseDateTR(police.baslangic);
    const end = parseDateTR(police.bitis);
    if (start && end && end < start) {
      errors.push(`${police.plaka}: bitiş tarihi başlangıçtan önce.`);
    }

    if (!police.toplamTutar || police.toplamTutar < 0.01) {
      errors.push(`${police.plaka || "Poliçe"}: tutar boş veya sıfır.`);
    }

    if (!police.plaka) errors.push("Plaka boş satır var.");
    if (!police.aracTipi) errors.push(`${police.plaka}: araç tipi seçilmemiş.`);
  }

  for (const row of params.previewRows || []) {
    if (!row.donem) errors.push(`${row.plaka}: dönem boş.`);
    if (!row.giderHesabi) errors.push(`${row.plaka} ${row.donem}: gider hesabı boş.`);
    if (!row.giderlesecekTutar || row.giderlesecekTutar < 0.01) {
      errors.push(`${row.plaka} ${row.donem}: tutar boş veya sıfır.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    hasBlockingErrors: errors.length > 0,
  };
}

export function buildPoliceOzetSheetRows(summary = {}, meta = {}) {
  return [
    ["Poliçe Giderleştirme Özeti"],
    ["Firma", meta.firmaAdi || ""],
    ["Dönem Yılı", meta.donemYili || ""],
    ["Giderleştirme Tipi", meta.giderlestirmeTipi || ""],
    [],
    ["Toplam Poliçe Tutarı", summary.toplamPoliceTutari ?? 0],
    ["Cari Yıl Gideri / 770", summary.buDonemGider ?? 0],
    ["Aynı Yıl Gelecek Ay / 180", summary.gelecekAyGider ?? 0],
    ["Sonraki Mali Yıl / 280", summary.gelecekYilGider ?? 0],
    ["Toplam Kontrol", summary.dagitimToplami ?? 0],
    ["Kontrol Farkı", summary.kontrolFarki ?? 0],
    ["Kabul Edilen Gider", summary.kabulEdilenGider ?? 0],
    ["KKEG Tutarı", summary.kkegTutari ?? 0],
    ["Binek Araç Poliçe Sayısı", summary.binekPoliceSayisi ?? 0],
    ["Ticari Araç Poliçe Sayısı", summary.ticariPoliceSayisi ?? 0],
  ];
}

export function buildDonemDagilimSheetRows(previewRows = []) {
  return [
    [
      "Dönem",
      "Sınıf",
      "Plaka",
      "Poliçe No",
      "Araç Tipi",
      "Giderleşecek Tutar",
      "Kabul Edilen",
      "KKEG",
      "Gider Hesabı",
      "Açıklama",
    ],
    ...previewRows.map((row) => [
      row.donem,
      row.giderSinifi === "gelecek_yil"
        ? "280 Gelecek Yıllara Ait Gider"
        : row.giderSinifi === "gelecek_ay"
          ? "180 Gelecek Aylara Ait Gider"
          : "770 Cari Yıl Gideri",
      row.plaka,
      row.policeNo,
      row.aracTipi,
      row.giderlesecekTutar,
      row.kabulEdilenGider,
      row.kkegTutari,
      row.giderHesabi,
      row.aciklama,
    ]),
  ];
}

export function buildAracDagilimSheetRows(aracDistribution = []) {
  return [
    ["Plaka", "Araç Adı", "Araç Tipi", "Toplam Gider", "Kabul Edilen", "KKEG"],
    ...aracDistribution.map((row) => [
      row.plaka,
      row.aracAdi,
      row.aracTipi,
      row.toplamGider,
      row.kabulEdilenGider,
      row.kkegTutari,
    ]),
  ];
}

export function buildKkegListSheetRows(kkegList = []) {
  return [
    [
      "Dönem",
      "Plaka",
      "Poliçe No",
      "Araç Tipi",
      "Giderleşecek Tutar",
      "KKEG Tutarı",
      "Açıklama",
    ],
    ...kkegList.map((row) => [
      row.donem,
      row.plaka,
      row.policeNo,
      row.aracTipi,
      row.giderlesecekTutar,
      row.kkegTutari,
      row.aciklama,
    ]),
  ];
}

export function buildLucaSuggestionSheetRows(lucaGiderlestirme = {}, lucaKkeg = {}) {
  const rows = [
    ["Luca Fiş Önerileri"],
    [],
    ["Giderleştirme Fişleri"],
    ["Fiş No", "Hesap Kodu", "Detay Açıklama", "Borç", "Alacak"],
  ];

  if (lucaGiderlestirme.enabled) {
    rows.push(
      ...lucaGiderlestirme.rows.map((row) => [
        row.fisNo,
        row.hesapKodu,
        row.detayAciklama,
        row.borc,
        row.alacak,
      ])
    );
  } else {
    rows.push(["—", "Giderleştirme fişi önerisi yok"]);
  }

  rows.push([], ["KKEG Fişleri"], ["Fiş No", "Hesap Kodu", "Detay Açıklama", "Borç", "Alacak"]);

  if (lucaKkeg.enabled) {
    rows.push(
      ...lucaKkeg.rows.map((row) => [
        row.fisNo,
        row.hesapKodu,
        row.detayAciklama,
        row.borc,
        row.alacak,
      ])
    );
  } else {
    rows.push(["—", "KKEG fişi önerisi yok"]);
  }

  return rows;
}

export function exportPoliceGiderlestirmeReportWorkbook({
  summary = {},
  meta = {},
  previewRows = [],
  aracDistribution = [],
  kkegList = [],
  lucaGiderlestirme = {},
  lucaKkeg = {},
  fileName = "police-giderlestirme",
}) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildPoliceOzetSheetRows(summary, meta)),
    "Özet"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildDonemDagilimSheetRows(previewRows)),
    "Dönem Dağılım"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildAracDagilimSheetRows(aracDistribution)),
    "Araç Dağılım"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildKkegListSheetRows(kkegList)),
    "KKEG Listesi"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildLucaSuggestionSheetRows(lucaGiderlestirme, lucaKkeg)),
    "Luca Fiş Önerisi"
  );

  XLSX.writeFile(workbook, `${fileName}.xlsx`);

  return { ok: true };
}
