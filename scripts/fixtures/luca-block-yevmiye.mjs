/** Anonymous 2-voucher Luca block yevmiye fixture (no customer data). */

const COLUMN_HEADERS = [
  "HESAP KODU",
  "HESAP ADI",
  "AÇIKLAMA",
  "DETAY",
  "BORÇ",
  "ALACAK",
];

export function buildLucaBlockYevmiyeFixture() {
  return [
    ["YEVMİYE DEFTERİ"],
    ["Dönem", "2026/03"],
    ["00001-----00001-----AÇILIŞ-----01/01/2026"],
    COLUMN_HEADERS,
    ["100", "KASA", "", "", "1000", "0"],
    [" 100.01", "Kasa TL", "Anon açılış", "1000", "", ""],
    ["500", "SERMAYE", "", "", "0", "1000"],
    [" 500.01", "Sermaye", "Anon açılış", "1000", "", ""],
    ["TOPLAM", "", "", "1000", "1000", "0"],
    ["00002-----00002-----MAHSUP-----15/01/2026"],
    COLUMN_HEADERS,
    ["320", "ALACAKLAR", "", "", "500", "0"],
    [" 320.01", "Anon cari", "Anon satış", "500", "", ""],
    ["600", "GELİRLER", "", "", "0", "500"],
    [" 600.01", "Gelir", "Anon satış", "500", "", ""],
    ["Genel Toplam", "", "", "500", "500", "0"],
  ];
}

export const LUCA_BLOCK_YEVMIYE_ROWS = buildLucaBlockYevmiyeFixture();
