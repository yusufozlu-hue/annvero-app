import * as XLSX from "xlsx";

export function validateFinansmanGiderExport(params = {}) {
  const errors = [];

  if (!params.muavinFileLoaded && !params.mizanFileLoaded) {
    errors.push("Muavin veya mizan dosyası yüklenmelidir.");
  }

  if (params.kisitlamaOrani === "" || params.kisitlamaOrani === null || params.kisitlamaOrani === undefined) {
    if (params.kisitlamaUygulanir) {
      errors.push("Kısıtlama oranı boş olamaz.");
    }
  }

  if (params.ozKaynak === "" || params.ozKaynak === null || params.ozKaynak === undefined) {
    errors.push("Öz kaynak tutarı boş olamaz.");
  }

  if (
    params.yabanciKaynak === "" ||
    params.yabanciKaynak === null ||
    params.yabanciKaynak === undefined
  ) {
    errors.push("Yabancı kaynak tutarı boş olamaz.");
  }

  if (!params.selectedAccounts?.length) {
    errors.push("Kısıtlamaya tabi en az bir hesap seçilmelidir.");
  }

  if (!params.previewRows?.length) {
    errors.push("Hesaplanacak muavin satırı bulunamadı.");
  }

  return {
    ok: errors.length === 0,
    errors,
    hasBlockingErrors: errors.length > 0,
  };
}

export function buildFinansmanOzetSheetRows(summary = {}, meta = {}) {
  return [
    ["Finansman Gider Kısıtlaması Özeti"],
    ["Firma", meta.firmaAdi || ""],
    ["Dönem Yılı", meta.donemYili || ""],
    ["Dönem Başlangıç", meta.donemBaslangic || ""],
    ["Dönem Bitiş", meta.donemBitis || ""],
    [],
    ["Öz Kaynak", summary.ozKaynak ?? ""],
    ["Yabancı Kaynak", summary.yabanciKaynak ?? ""],
    ["Kısıtlama Oranı (%)", summary.kisitlamaOrani ?? ""],
    ["Önerilen Oran (%)", summary.suggestedOran ?? ""],
    ["Kısıtlama Uygulanır", summary.kisitlamaUygulanir ? "Evet" : "Hayır"],
    [],
    ["Toplam Finansman Gideri", summary.toplamFinansmanGideri ?? 0],
    ["Kısıtlamaya Tabi Gider", summary.kisitlamayaTabiGider ?? 0],
    ["Kısıtlama Dışı Gider", summary.kisitlamaDisiGider ?? 0],
    ["KKEG Tutarı", summary.kkegTutari ?? 0],
    ["Kabul Edilen Gider", summary.kabulEdilenGider ?? 0],
    [],
    ["Uyarı", summary.uyari || ""],
  ];
}

export function buildHesapDagilimSheetRows(accountDistribution = []) {
  return [
    [
      "Hesap Kodu",
      "Hesap Adı",
      "Toplam Gider",
      "Kısıtlamaya Tabi",
      "Kısıtlama Dışı",
      "KKEG Tutarı",
    ],
    ...accountDistribution.map((row) => [
      row.hesapKodu,
      row.hesapAdi,
      row.toplamGider,
      row.kisitlamayaTabi,
      row.kisitlamaDisi,
      row.kkegTutari,
    ]),
  ];
}

export function buildMuavinDetaySheetRows(previewRows = []) {
  return [
    [
      "Tarih",
      "Hesap Kodu",
      "Hesap Adı",
      "Açıklama",
      "Borç",
      "Alacak",
      "Net Finansman Gideri",
      "Kısıtlamaya Tabi",
      "Dışarıda Bırak",
      "Dışarıda Bırakma Nedeni",
      "KKEG Tutarı",
    ],
    ...previewRows.map((row) => [
      row.tarih,
      row.hesapKodu,
      row.hesapAdi,
      row.aciklama,
      row.borc,
      row.alacak,
      row.netFinansmanGideri,
      row.kisitlamayaTabi ? "Evet" : "Hayır",
      row.disaridaBirak ? "Evet" : "Hayır",
      row.disaridaNeden || "",
      row.kkegTutari,
    ]),
  ];
}

export function buildKkegListSheetRows(kkegList = []) {
  return [
    ["Tarih", "Hesap Kodu", "Hesap Adı", "Açıklama", "Net Gider", "KKEG Tutarı"],
    ...kkegList.map((row) => [
      row.tarih,
      row.hesapKodu,
      row.hesapAdi,
      row.aciklama,
      row.netFinansmanGideri,
      row.kkegTutari,
    ]),
  ];
}

export function buildLucaSuggestionSheetRows(lucaSuggestion = {}) {
  if (!lucaSuggestion.enabled || !lucaSuggestion.rows?.length) {
    return [["Luca KKEG Fiş Önerisi"], ["Durum", "KKEG tutarı yok veya kısıtlama uygulanmadı."]];
  }

  return [
    ["Luca KKEG Fiş Önerisi"],
    ["Fiş Açıklama", lucaSuggestion.fisAciklama || ""],
    ["KKEG Hesabı", lucaSuggestion.kkegHesap || ""],
    ["Nazım / Karşı Hesap", lucaSuggestion.nazimHesap || ""],
    [],
    ["Fiş No", "Hesap Kodu", "Detay Açıklama", "Borç", "Alacak"],
    ...lucaSuggestion.rows.map((row) => [
      row.fisNo,
      row.hesapKodu,
      row.detayAciklama,
      row.borc,
      row.alacak,
    ]),
  ];
}

export function exportFinansmanGiderReportWorkbook({
  summary = {},
  meta = {},
  accountDistribution = [],
  previewRows = [],
  kkegList = [],
  lucaSuggestion = {},
  fileName = "finansman-gider-kisitlamasi",
}) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildFinansmanOzetSheetRows(summary, meta)),
    "Özet"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildHesapDagilimSheetRows(accountDistribution)),
    "Hesap Dağılım"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildMuavinDetaySheetRows(previewRows)),
    "Muavin Detay"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildKkegListSheetRows(kkegList)),
    "KKEG Listesi"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildLucaSuggestionSheetRows(lucaSuggestion)),
    "Luca KKEG Önerisi"
  );

  XLSX.writeFile(workbook, `${fileName}.xlsx`);

  return { ok: true };
}
