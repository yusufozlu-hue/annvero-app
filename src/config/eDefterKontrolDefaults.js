export const E_DEFTER_KAYNAK = {
  MUAVIN: "muavin",
  YEVMIYE: "yevmiye",
  MIZAN: "mizan",
  EDEFTER_LISTE: "edefter_liste",
};

export const E_DEFTER_KONTROL_GRUP = {
  HATASIZ: "Hatasız kayıtlar",
  KRITIK: "Kritik hatalar",
  MUKERRER: "Mükerrer riskliler",
  TERS_BAKIYE: "Ters bakiye verenler",
  EKSIK_BILGI: "Eksik bilgi olanlar",
  DONEM_SONU: "Dönem sonu kayıt uyarıları",
  KDV_KONTROL: "KDV kontrol uyarıları",
};

export const E_DEFTER_KONTROL_DURUM = {
  HATASIZ: "Hatasız",
  KRITIK: "Kritik hata",
  MUKERRER: "Mükerrer risk",
  TERS_BAKIYE: "Ters bakiye",
  EKSIK_BILGI: "Eksik bilgi",
  DONEM_SONU: "Dönem sonu uyarı",
  KDV_KONTROL: "KDV kontrol uyarı",
  FIS_DENGESIZ: "Fiş dengesiz",
};

export const RISK_BAND = {
  DUSUK: "Düşük",
  KONTROL: "Kontrol edilmeli",
  YUKSEK: "Yüksek",
};

export const KASA_BAKIYE_ESIK = 50000;
export const NEAR_DATE_DAYS = 3;
export const BORC_ALACAK_TOLERANCE = 0.05;
export const BELGE_TARIH_FARK_GUN = 7;

export function riskBandFromScore(score) {
  if (score >= 70) return RISK_BAND.YUKSEK;
  if (score >= 31) return RISK_BAND.KONTROL;
  return RISK_BAND.DUSUK;
}
