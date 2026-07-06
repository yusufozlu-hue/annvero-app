export const KURGAN_RISK_LEVEL = {
  DUSUK: "Düşük",
  ORTA: "Orta",
  YUKSEK: "Yüksek",
  KRITIK: "Kritik",
};

export const KURGAN_RISK_STATUS = {
  YENI: "Yeni",
  INCELENIYOR: "İnceleniyor",
  ACIKLANDI: "Açıklandı",
  RISK_YOK: "Risk Yok",
  DUZELTME_GEREKLI: "Düzeltme Gerekli",
};

export const KURGAN_RISK_TYPE = {
  KASA_YUKSEK_BAKIYE: "Kasa hesabı yüksek bakiye riski",
  ORTAKLARDAN_ALACAK: "Ortaklardan alacaklar riski",
  ORTAKLARA_BORC: "Ortaklara borçlar riski",
  DEVREDEN_KDV: "Devreden KDV süreklilik riski",
  ODENECEK_KDV_TUTARSIZ: "Ödenecek KDV tutarsızlık riski",
  POS_BANKA_UYUMSUZ: "POS tahsilatı ile banka uyumsuzluğu",
  BANKA_MUHASEBE_FARK: "Banka hareketi ile muhasebe kaydı uyumsuzluğu",
  SGK_BORDRO_UYUMSUZ: "SGK/bordro ödeme uyumsuzluğu",
  KDV_MATRAH_ANOMALI: "KDV matrah değişim anomalisi",
  KARLILIK_ANOMALI: "Karlılık oranı anomalisi",
  GIDER_ARTISI: "Olağandışı gider artışı",
  SUPHELI_CARI: "Şüpheli cari hareketler",
  MUKERRER_KAYIT: "Mükerrer kayıt riski",
  EKSIK_BELGE: "Eksik belge / açıklama riski",
};

export const KURGAN_DATA_SOURCE = {
  MIZAN: "Mizan",
  MUAVIN: "Muavin",
  BANKA: "Banka ekstresi",
  LUCA: "Luca fiş üretimi",
  BEYANNAME: "Beyanname/tahakkuk",
  SGK: "SGK/tahakkuk",
};

export const KURGAN_RISK_THRESHOLDS = {
  kasaHighBalance: 50000,
  ortakAlacakHighBalance: 100000,
  ortakBorcHighBalance: 100000,
  devredenKdvHighBalance: 50000,
  giderRevenueRatio: 0.35,
  karlilikMinRatio: 0.05,
  kdvMatrahChangeRatio: 0.25,
};

export const KURGAN_STORAGE_KEY = "annvero_kurgan_risk_findings_v1";
export const KURGAN_SNAPSHOT_KEY = "annvero_kurgan_risk_snapshots_v1";

export function resolveRiskLevelFromRatio(value, threshold) {
  if (!threshold || value <= 0) return KURGAN_RISK_LEVEL.DUSUK;
  const ratio = value / threshold;
  if (ratio >= 3) return KURGAN_RISK_LEVEL.KRITIK;
  if (ratio >= 2) return KURGAN_RISK_LEVEL.YUKSEK;
  if (ratio >= 1) return KURGAN_RISK_LEVEL.ORTA;
  return KURGAN_RISK_LEVEL.DUSUK;
}

export function riskLevelBadgeClass(level) {
  if (level === KURGAN_RISK_LEVEL.KRITIK) return "bg-red-950 text-red-200 ring-red-700/60";
  if (level === KURGAN_RISK_LEVEL.YUKSEK) return "bg-orange-950 text-orange-200 ring-orange-700/60";
  if (level === KURGAN_RISK_LEVEL.ORTA) return "bg-amber-950 text-amber-200 ring-amber-700/60";
  return "bg-slate-800 text-slate-200 ring-slate-600/60";
}
