export const KDV_KAYNAK = {
  ALIS: "alis",
  SATIS: "satis",
  KDV_LISTE: "kdv_liste",
  MUAVIN: "muavin",
};

export const KDV_KONTROL_GRUP = {
  HATASIZ: "Hatasız kayıtlar",
  KDV_FARKI: "KDV farkı olanlar",
  ORAN_HATASI: "Oran hatası olanlar",
  MUKERRER: "Mükerrer riskliler",
  TEVKIFAT: "Tevkifat kontrolü gerekenler",
  ISTISNA: "İstisna kontrolü gerekenler",
  EKSIK_BILGI: "Eksik bilgi olanlar",
};

export const KDV_KONTROL_DURUM = {
  HATASIZ: "Hatasız",
  KDV_FARKI: "KDV farkı",
  ORAN_HATASI: "Oran hatası",
  MUKERRER: "Mükerrer risk",
  TEVKIFAT: "Tevkifat kontrol",
  ISTISNA: "İstisna kontrol",
  EKSIK_BILGI: "Eksik bilgi",
  TERS_KAYIT: "Ters/negatif kayıt",
};

export const VALID_KDV_ORANLARI = [0, 1, 8, 10, 18, 20];

export const RISK_BAND = {
  DUSUK: "Düşük",
  KONTROL: "Kontrol edilmeli",
  YUKSEK: "Yüksek",
};

export function riskBandFromScore(score) {
  if (score >= 70) return RISK_BAND.YUKSEK;
  if (score >= 31) return RISK_BAND.KONTROL;
  return RISK_BAND.DUSUK;
}
