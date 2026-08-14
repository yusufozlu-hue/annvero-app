/**
 * Kimliksiz minimal Excel sheet-row fixture’ları (gerçek müşteri verisi yok).
 * Header + kurumsal metadata gerçek export yapısını temsil eder.
 */

export const FIXTURE_TEB_XLSX_ROWS = [
  ["Türkiye Ekonomi Bankası A.Ş.", "", "", "", "", ""],
  ["IBAN", "TR330003200000000000000001", "", "", "", ""],
  ["BIC/SWIFT", "TEBUTRIS", "", "", "", ""],
  ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye", "İşlem No"],
  ["10.01.2026", "HAVALE REF 998877", "0", "300,00", "1300", "D100"],
  ["10.01.2026", "MASRAF BSMV", "12,00", "", "1288", "D101"],
];

export const FIXTURE_TEB_XLS_ROWS = [
  ["TEB Hesap Ekstresi", "", "", "", ""],
  ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye", "İşlem No"],
  ["11.01.2026", "EFT GELEN", "", "500,00", "1800", "T200"],
  ["12.01.2026", "POS", "50,00", "", "1750", "T201"],
];

export const FIXTURE_ZIRAAT_XLSX_ROWS = [
  ["T.C. Ziraat Bankası A.Ş.", "", "", "", ""],
  ["Hesap IBAN", "TR120001000000000000000002", "", "", ""],
  ["SWIFT", "TCZBTR2A", "", "", ""],
  ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye", "Dekont No"],
  ["11.01.2026", "ZIRAAT HAVALE", "100,00", "", "900", "Z1"],
  ["12.01.2026", "ZIRAAT TAHSILAT", "", "250,00", "1150", "Z2"],
];

export const FIXTURE_ZIRAAT_XLS_ROWS = [
  ["Ziraat Bankası Hesap Hareketleri", "", "", "", ""],
  ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"],
  ["13.01.2026", "MAAS", "", "1000,00", "2000"],
  ["14.01.2026", "FATURA", "200,00", "", "1800"],
];

export const FIXTURE_KUVEYTTURK_XLSX_ROWS = [
  ["Kuveyt Türk Katılım Bankası A.Ş.", "", "", "", ""],
  ["IBAN", "TR450020500000000000000003", "", "", ""],
  ["BIC", "KTEFTRIS", "", "", ""],
  ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"],
  ["13.01.2026", "EFT GIDEN", "75,00", "", "925"],
  ["14.01.2026", "GELEN HAVALE", "", "40,00", "965"],
];

export const FIXTURE_KUVEYT_ALIAS_ROWS = [
  ["KUVEYTTURK Hesap Özeti", "", "", "", ""],
  ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"],
  ["15.01.2026", "TAKSIT", "10,00", "", "955"],
];

export const FIXTURE_VAKIF_ROWS = [
  ["Hesap No", "Fiş No", "İşlem Tarihi", "Açıklama", "Tutar", "B/A"],
  ["123", "1", "01.02.2026", "EFT GELEN", "1500,00", "A"],
  ["123", "2", "02.02.2026", "HAVALE GIDEN", "200,00", "B"],
];

export const FIXTURE_GARANTI_ROWS = [
  ["Tarih", "Açıklama", "Etiket", "Tutar", "Bakiye", "Dekont No"],
  ["01.03.2026", "EFT ALACAK", "", "1000,00", "1000", "G1"],
  ["02.03.2026", "POS HARCAMASI", "", "-50,00", "950", "G2"],
];

export const FIXTURE_GENERIC_COLUMNS = [
  ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"],
  ["01.01.2026", "GENEL HAREKET", "10,00", "", "90"],
];

export const FIXTURE_EMPTY = [];

export const FIXTURE_AMBIGUOUS_TEB_ZIRAAT = [
  ["Çoklu banka dışa aktarım", "", "", "", ""],
  ["TEB unvan satırı", "Türkiye Ekonomi Bankası", "", "", ""],
  ["Ziraat unvan satırı", "T.C. Ziraat Bankası", "", "", ""],
  ["IBAN TEB", "TR330003200000000000000001", "", "", ""],
  ["IBAN Ziraat", "TR120001000000000000000002", "", "", ""],
  ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"],
  ["10.01.2026", "X", "1", "", "1"],
];

export const FIXTURE_MULTI_SHEET_SIGNAL = {
  sheetName: "Kuveyt Hareket",
  rows: [
    ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"],
    ["IBAN", "TR450020500000000000000003", "", "", ""],
    ["16.01.2026", "ODEME", "5,00", "", "100"],
  ],
};
