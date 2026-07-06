export const E_DEFTER_KAYNAK = {
  MUAVIN: "muavin",
  YEVMIYE: "yevmiye",
  MIZAN: "mizan",
  EDEFTER_LISTE: "edefter_liste",
  YEVMIYE_XML: "yevmiye_xml",
  KEBIR_XML: "kebir_xml",
  BERAT: "berat",
  TEKNIK: "teknik",
  VERGISEL: "vergisel",
};

export const E_DEFTER_TURU = {
  YEVMIYE: "Yevmiye",
  KEBIR: "Kebir",
  BERAT: "Berat",
  ZIP: "ZIP",
};

export const E_DEFTER_KONTROL_STATUS = {
  BEKLIYOR: "Bekliyor",
  CALISIYOR: "Çalışıyor",
  TAMAMLANDI: "Tamamlandı",
  HATALI: "Hatalı",
};

export const E_DEFTER_FINDING_STATUS = {
  YENI: "Yeni",
  COZULDU: "Çözüldü",
  COZULMEDI: "Çözülmedi",
};

export const E_DEFTER_HATA_TURU = {
  TEKNIK: "Teknik",
  MUHASEBESEL: "Muhasebesel",
  VERGISEL: "Vergisel",
};

export const E_DEFTER_RISK_LEVEL = {
  DUSUK: "Düşük",
  ORTA: "Orta",
  YUKSEK: "Yüksek",
  KRITIK: "Kritik",
};

export const E_DEFTER_RECORDS_STORAGE_KEY = "annvero_edefter_kontrol_records_v1";

export const E_DEFTER_KONTROL_GRUP = {
  HATASIZ: "Hatasız kayıtlar",
  KRITIK: "Kritik hatalar",
  MUKERRER: "Mükerrer riskliler",
  TERS_BAKIYE: "Ters bakiye verenler",
  EKSIK_BILGI: "Eksik bilgi olanlar",
  DONEM_SONU: "Dönem sonu kayıt uyarıları",
  KDV_KONTROL: "KDV kontrol uyarıları",
  TEKNIK: "Teknik hatalar",
  VERGISEL: "Vergisel riskler",
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

export function riskLevelFromScore(score) {
  if (score >= 71) return E_DEFTER_RISK_LEVEL.KRITIK;
  if (score >= 51) return E_DEFTER_RISK_LEVEL.YUKSEK;
  if (score >= 31) return E_DEFTER_RISK_LEVEL.ORTA;
  return E_DEFTER_RISK_LEVEL.DUSUK;
}

export function riskLevelBadgeClass(level) {
  if (level === E_DEFTER_RISK_LEVEL.KRITIK) return "bg-red-950 text-red-200 ring-red-700/60";
  if (level === E_DEFTER_RISK_LEVEL.YUKSEK) return "bg-orange-950 text-orange-200 ring-orange-700/60";
  if (level === E_DEFTER_RISK_LEVEL.ORTA) return "bg-amber-950 text-amber-200 ring-amber-700/60";
  return "bg-slate-800 text-slate-200 ring-slate-600/60";
}
