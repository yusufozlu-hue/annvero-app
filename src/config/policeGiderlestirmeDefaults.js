export const GIDERLESTIRME_TIPI = {
  AYLIK: "aylik",
  Uc_AYLIK: "uc_aylik",
};

export const ARAC_TIPI = {
  BINEK: "binek",
  TICARI: "ticari",
};

export const ARAC_SAHIPLIK = {
  SAHIP: "sahip",
  KIRALIK: "kiralik",
};

export const KDV_DURUMU = {
  DAHIL: "dahil",
  HARIC: "haric",
};

export const DEFAULT_GIDER_HESABI = "770";
export const DEFAULT_GELECEK_DONEM_HESABI = "180";
export const DEFAULT_KKEG_HESAP = "689";

export const DEFAULT_BINEK_KISIT_ORANI = 100;

export function buildGiderlestirmeFisAciklama(donem, plaka, policeTipi = "trafik sigortası") {
  return `${donem} ${plaka} ${policeTipi} giderleştirme kaydı`;
}

export function buildBinekKkegFisAciklama(donemYili) {
  return `${donemYili} binek araç sigorta gider kısıtı KKEG kaydı`;
}
