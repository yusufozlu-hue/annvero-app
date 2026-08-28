/** Anonymous 2-account Luca multi-block muavin fixture (no customer data). */

const LUCA_HEADERS = [
  "TARİH",
  "TİP",
  "FİŞ NO",
  "AÇIKLAMA",
  "BORÇ",
  "ALACAK",
  "BAKİYE",
  "B/A",
];

/** Excel export pattern: calendar day at 21:00 UTC (= next-day midnight in UTC+3). */
export function lucaExcelDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day - 1, 21, 0, 0));
}

export function buildLucaMultiAccountMuavinFixture() {
  return [
    ["102.01.012 ANON BANKA HESABI"],
    LUCA_HEADERS,
    [lucaExcelDate(2026, 1, 1), "AÇ", "00001", "Açılış", 1000, 0, 1000, "B"],
    [lucaExcelDate(2026, 1, 15), "FT", "00002", "Anon hareket", 0, 250, 750, "B"],
    [lucaExcelDate(2026, 2, 10), "FT", "00003", "Şubat hareket", 100, 0, 850, "B"],
    ["Nakli Yekün Hariç"],
    ["Genel Toplam", "", "", "", 1100, 250, 850, "B"],
    ["320.01.001 ANON TİCARİ ALACAK"],
    LUCA_HEADERS,
    [lucaExcelDate(2026, 1, 20), "FT", "00010", "Alacak hareket", 0, 500, 500, "A"],
    [lucaExcelDate(2026, 4, 1), "FT", "00011", "Nisan dışı", 50, 0, 550, "A"],
    ["Nakli Yekün Hariç"],
    ["Genel Toplam", "", "", "", 50, 500, 550, "A"],
  ];
}

export const LUCA_MULTI_ACCOUNT_MUAVIN_ROWS = buildLucaMultiAccountMuavinFixture();

/** Anonymous Turkish-letter account codes (İ/Ç) — regression for header regex. */
export function buildLucaTurkishAccountMuavinFixture() {
  return [
    ["120.01.B0027 ANON CARI B"],
    LUCA_HEADERS,
    [lucaExcelDate(2026, 1, 1), "AÇ", "00001", "Açılış B", 79685.24, 0, 79685.24, "B"],
    ["Nakli Yekün Hariç"],
    ["Genel Toplam", "", "", "", 79685.24, 0, 79685.24, "B"],
    ["120.01.PDİ01 ANON CARI PDI"],
    LUCA_HEADERS,
    [lucaExcelDate(2026, 1, 1), "AÇ", "00001", "Açılış PDI", 89415.37, 0, 89415.37, "B"],
    ["Nakli Yekün Hariç"],
    ["Genel Toplam", "", "", "", 89415.37, 0, 89415.37, "B"],
    ["320.10.B0021 ANON CARI B21"],
    LUCA_HEADERS,
    [lucaExcelDate(2026, 1, 30), "FT", "00028", "B21 hareket", 0, 5750, 5750, "A"],
    ["Nakli Yekün Hariç"],
    ["Genel Toplam", "", "", "", 0, 5750, 5750, "A"],
    ["320.10.Ç0005 ANON CARI C5"],
    LUCA_HEADERS,
    [lucaExcelDate(2026, 3, 4), "FT", "00077", "C5 hareket", 11220.95, 0, 11220.95, "B"],
    ["Nakli Yekün Hariç"],
    ["Genel Toplam", "", "", "", 11220.95, 0, 11220.95, "B"],
  ];
}

export function buildLucaTurkishAccountYevmiyeFixture() {
  return [
    ["00001-----00001-----AÇILIŞ-----01/01/2026"],
    ["HESAP KODU", "HESAP ADI", "AÇIKLAMA", "DETAY", "BORÇ", "ALACAK"],
    ["120", "ALICILAR", "", "", "169100.61", "0"],
    ["   120.01.B0027", "ANON CARI B", "Açılış B", 79685.24, "", ""],
    ["   120.01.PDİ01", "ANON CARI PDI", "Açılış PDI", 89415.37, "", ""],
    ["TOPLAM", "", "", "169100.61", "169100.61", "0"],
    ["00028-----00028-----MAHSUP-----30/01/2026"],
    ["HESAP KODU", "HESAP ADI", "AÇIKLAMA", "DETAY", "BORÇ", "ALACAK"],
    ["320", "SATICILAR", "", "", "0", "5750"],
    ["   320.10.B0021", "ANON CARI B21", "B21 hareket", 5750, "", ""],
    ["TOPLAM", "", "", "5750", "0", "5750"],
    ["00077-----00077-----MAHSUP-----04/03/2026"],
    ["HESAP KODU", "HESAP ADI", "AÇIKLAMA", "DETAY", "BORÇ", "ALACAK"],
    ["320", "SATICILAR", "", "", "11220.95", "0"],
    ["   320.10.Ç0005", "ANON CARI C5", "C5 hareket", 11220.95, "", ""],
    ["TOPLAM", "", "", "11220.95", "11220.95", "0"],
  ];
}