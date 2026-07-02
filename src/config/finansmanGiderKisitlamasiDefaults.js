export const DEFAULT_FINANSMAN_HESAPLARI = [
  { id: "660", label: "660 Kısa Vadeli Borçlanma Giderleri", prefix: "660" },
  { id: "661", label: "661 Uzun Vadeli Borçlanma Giderleri", prefix: "661" },
  { id: "656", label: "656 Kur Farkı Giderleri", prefix: "656" },
];

export const DISARIDA_BIRAKMA_NEDENLERI = [
  { id: "YATIRIM_FINANSMANI", label: "Yatırım finansmanı" },
  { id: "MALIYETE_EKLENEN", label: "Maliyete eklenen finansman gideri" },
  { id: "KAMBIYO_ZARARI", label: "Kambiyo zararı ayrımı" },
  { id: "BANKA_MASRAFI", label: "Banka masrafı" },
  { id: "KREDI_FAIZ_GIDERI", label: "Kredi faiz gideri (istisna)" },
  { id: "DIGER", label: "Diğer" },
];

export const DEFAULT_KKEG_HESAP = "689";
export const DEFAULT_NAZIM_HESAP = "";

export function buildKkegFisAciklama(donemYili) {
  return `${donemYili} Finansman gider kısıtlaması KKEG kaydı`;
}
