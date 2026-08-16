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

/**
 * Gerçek Ziraat Excel export yapısal anonim fixture
 * (Muh Tarih | Valor | Şube | Fiş No | İşl Kd | Borç | Alacak | …).
 * Hassas veri yok.
 */
export const FIXTURE_ZIRAAT_REAL_EXPORT_ANON = {
  sheetName: "TL Hesap",
  fileName: "ekstre.xlsx",
  rows: [
    ["T.C. Ziraat Bankası A.Ş.", "", "", "", "", "", "", "", ""],
    [
      "Muh Tarih",
      "Valor",
      "Şube",
      "Fiş No",
      "İşl Kd",
      "Borç",
      "Alacak",
      "Bakiye",
      "İşlem Açıklaması",
    ],
    ["10.01.2026", "10.01.2026", "ANON", "F1", "EFT", "100,00", "", "900,00", "EFT GIDEN ANON"],
    ["11.01.2026", "11.01.2026", "ANON", "F2", "GEL", "", "250,00", "1150,00", "GELEN HAVALE ANON"],
  ],
};

/** TEB adlı fakat Garanti kolonları (yapısal anon fixture) → UNKNOWN */
export const FIXTURE_TEB_NAMED_GARANTI_COLUMNS = {
  sheetName: "Hesap Hareketleri",
  fileName: "teb-named-garanti-columns.xlsx",
  rows: [
    ["Tarih", "Açıklama", "Unvan", "Özel İşlem Açıklaması", "Tutar", "Bakiye", "Dekont"],
    ["01.03.2026", "EFT ANON", "ANON FIRMA", "", "1000,00", "1000", "D1"],
    ["02.03.2026", "ODEME VAKIFBANK KREDI KARTI ANON", "ANON", "", "-50,00", "950", "D2"],
  ],
};

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

/** Ortak Kuveyt kolon satırı (tek başına kimlik değil) */
export const KUVEYT_COLUMN_HEADER = [
  "İşlem Tarihi",
  "Açıklama",
  "Tutar",
  "Bakiye",
  "İşlem Referans Numarası",
];

/** A: kolon + Kuveyt sheet corroborator → DETECTED */
export const FIXTURE_A_KUVEYT_COLS_SHEET = {
  sheetName: "KUVEYTTURK ORNEK",
  fileName: "ekstre.xlsx",
  rows: [
    ["Hesap", "ANON-1 TL", "", "", ""],
    ["Şube", "ANON", "", "", ""],
    ["Hesap Hareketleri", "", "", "", ""],
    KUVEYT_COLUMN_HEADER,
    ["10.01.2026", "GELEN EFT ANONIM", "50,00", "950,00", "REFANON001"],
  ],
};

/** B: aynı kolonlar, nötr sheet/meta/filename → UNKNOWN */
export const FIXTURE_B_KUVEYT_COLS_NEUTRAL = {
  sheetName: "Sheet1",
  fileName: "ekstre.xlsx",
  rows: [
    KUVEYT_COLUMN_HEADER,
    ["10.01.2026", "GELEN EFT ANONIM", "50,00", "950,00", "REFANON001"],
  ],
};

/** C: kolonlar + açıklamada VakıfBank → UNKNOWN (VAKIF değil) */
export const FIXTURE_C_KUVEYT_COLS_VAKIF_NARRATIVE = {
  sheetName: "Sheet1",
  fileName: "ekstre.xlsx",
  rows: [
    KUVEYT_COLUMN_HEADER,
    [
      "10.01.2026",
      "ODEME VAKIFBANK KREDI KARTI REF-ANON",
      "-100,00",
      "900,00",
      "REFANON002",
    ],
  ],
};

/** D: yalnız KUVEYTTURK filename → UNKNOWN */
export const FIXTURE_D_FILENAME_ONLY_KUVEYT = {
  sheetName: "Sheet1",
  fileName: "KUVEYTTURK ORNEK.xlsx",
  rows: [
    ["Tarih", "Açıklama", "Tutar"],
    ["10.01.2026", "X", "1"],
  ],
};

/** E: TEB adlı + güçlü Garanti identity → GARANTI */
export const FIXTURE_E_TEB_NAMED_STRONG_GARANTI = {
  sheetName: "Hesap Hareketleri",
  fileName: "TEB ORNEK.xlsx",
  rows: [
    ["Türkiye Garanti Bankası A.Ş.", "", "", "", "", ""],
    ["IBAN", "TR620006200000000000000099", "", "", "", ""],
    ["Tarih", "Açıklama", "Etiket", "Tutar", "Bakiye", "Dekont No"],
    ["01.03.2026", "EFT ALACAK", "", "1000,00", "1000", "G1"],
  ],
};

/** F: TEB adlı + yalnız zayıf Garanti kolonları → UNKNOWN */
export const FIXTURE_F_TEB_NAMED_WEAK_GARANTI = {
  sheetName: "Hesap Hareketleri",
  fileName: "TEB ORNEK.xlsx",
  rows: [
    ["Tarih", "Açıklama", "Etiket", "Tutar", "Bakiye", "Dekont No"],
    ["01.03.2026", "EFT ALACAK", "", "1000,00", "1000", "G1"],
  ],
};

/**
 * Geriye dönük: gerçek export yapısal anonim (sheet corroborator).
 * Veri satırında karşı taraf VAKIFBANK — statement bankası değil.
 */
export const FIXTURE_KUVEYT_REAL_EXPORT_ANON = {
  sheetName: "kuveytturk",
  fileName: "KUVEYTTURK ORNEK.xlsx",
  rows: [
    ["Hesap", "ANON-HESAP - 1 TL", "", "", ""],
    ["Şube", "ANON SUBE", "", "", ""],
    ["Hesap Hareketleri", "", "", "", ""],
    KUVEYT_COLUMN_HEADER,
    [
      "10.01.2026",
      "ODEME VAKIFBANK KREDI KARTI REF-ANON",
      "-100,00",
      "900,00",
      "REFANON001",
    ],
    ["11.01.2026", "GELEN EFT ANONIM", "50,00", "950,00", "REFANON002"],
  ],
};

export const FIXTURE_VAKIF_ROWS = [
  ["Hesap No", "Fiş No", "İşlem Tarihi", "Açıklama", "Tutar", "B/A"],
  ["123", "1", "01.02.2026", "EFT GELEN", "1500,00", "A"],
  ["123", "2", "02.02.2026", "HAVALE GIDEN", "200,00", "B"],
];

/** Güçlü Garanti (brand + native kolon) */
export const FIXTURE_GARANTI_ROWS = [
  ["Türkiye Garanti Bankası A.Ş.", "", "", "", "", ""],
  ["Tarih", "Açıklama", "Etiket", "Tutar", "Bakiye", "Dekont No"],
  ["01.03.2026", "EFT ALACAK", "", "1000,00", "1000", "G1"],
  ["02.03.2026", "POS HARCAMASI", "", "-50,00", "950", "G2"],
];

/** Zayıf Garanti kolonları (brand yok) */
export const FIXTURE_GARANTI_WEAK_COLUMNS = [
  ["Tarih", "Açıklama", "Etiket", "Tutar", "Bakiye", "Dekont No"],
  ["01.03.2026", "EFT ALACAK", "", "1000,00", "1000", "G1"],
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
    ["IBAN", "TR450020500000000000000003", "", "", ""],
    ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"],
    ["16.01.2026", "ODEME", "5,00", "", "100"],
  ],
};
