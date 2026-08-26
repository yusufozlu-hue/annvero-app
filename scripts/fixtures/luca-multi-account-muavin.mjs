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
