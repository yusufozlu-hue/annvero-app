/**
 * Banka açıklamasındaki kısa kodları cari adaylarına eşler.
 * Yeni kayıt eklemek veya sırayı değiştirmek için bu dosyayı düzenleyin.
 * Daha spesifik eşleşmeler listenin üstünde olmalıdır.
 */
export const CARI_SHORT_CODE_MAPPINGS = [
  {
    keys: [
      "TTLKOM",
      "TURK TELEKOM",
      "TURK TELEKOMUNIKASYON",
      "TURK TELEKOMUNIKASYON AS",
    ],
    names: ["TURK TELEKOMUNIKASYON A S", "TURK TELEKOMUNIKASYON AS"],
  },
  {
    keys: ["TTNET"],
    names: ["TTNET A S", "TTNET AS"],
  },
  {
    keys: ["GARANTI", "GARANTIBANK", "GARANTI BBVA"],
    names: ["GARANTI BANKASI", "TURKIYE GARANTI BANKASI A S"],
  },
  {
    keys: ["VAKIF", "VAKIFBANK", "VAKIF BANK"],
    names: ["VAKIFBANK", "TURKIYE VAKIFLAR BANKASI T A O"],
  },
  {
    keys: ["TURKCELL"],
    names: ["TURKCELL", "TURKCELL ILETISIM HIZMETLERI A S"],
  },
  {
    keys: ["VODAFONE"],
    names: ["VODAFONE", "VODAFONE TELEKOMUNIKASYON A S"],
  },
  {
    keys: ["AYDEM", "AYDEME"],
    names: ["AYDEM", "AYDEM ELEKTRIK"],
  },
  {
    keys: ["BEDAS", "BEDAŞ"],
    names: ["BEDAS", "BOGAZICI ELEKTRIK DAGITIM A S"],
  },
];
