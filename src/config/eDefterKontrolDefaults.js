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
  CAPRAZ: "capraz",
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

/** Sonuç seviyeleri — UI / export */
export const E_DEFTER_SONUC_SEVIYE = {
  UYGUN: "Uygun",
  BILGI: "Bilgi",
  UYARI: "Uyarı",
  KRITIK: "Kritik hata",
};

export const E_DEFTER_RISK_LEVEL = {
  DUSUK: "Düşük",
  ORTA: "Orta",
  YUKSEK: "Yüksek",
  KRITIK: "Kritik",
  /** Yeni 4 seviye ile uyum (alias) */
  UYGUN: E_DEFTER_SONUC_SEVIYE.UYGUN,
  BILGI: E_DEFTER_SONUC_SEVIYE.BILGI,
  UYARI: E_DEFTER_SONUC_SEVIYE.UYARI,
  KRITIK_HATA: E_DEFTER_SONUC_SEVIYE.KRITIK,
};

export const E_DEFTER_RECORDS_STORAGE_KEY = "annvero_edefter_kontrol_records_v1";
export const E_DEFTER_FINGERPRINT_STORAGE_KEY = "annvero_edefter_fingerprints_v1";

/** Kalıcı kayıt / revision anahtarı — motor değişince yeni run üretilir */
export const E_DEFTER_ENGINE_VERSION = "3.1.0";

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
  CAPRAZ: "Çapraz mutabakat",
  INCELEME_GEREKLI: "İnceleme gerekli",
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
  INCELEME_GEREKLI: "İnceleme gerekli",
};

/** Issue severity — structured contract */
export const E_DEFTER_ISSUE_SEVERITY = {
  BILGI: "BILGI",
  UYARI: "UYARI",
  KRITIK: "KRITIK",
};

/**
 * Structured issue codes (engine ↔ UI ↔ persist).
 * Turkish user messages stay on the issue.message field.
 */
export const E_DEFTER_ISSUE_CODE = {
  ACCOUNT_NOT_IN_PLAN: "ACCOUNT_NOT_IN_PLAN",
  DATE_OUT_OF_PERIOD: "DATE_OUT_OF_PERIOD",
  NEGATIVE_AMOUNT: "NEGATIVE_AMOUNT",
  DEBIT_CREDIT_MISMATCH: "DEBIT_CREDIT_MISMATCH",
  DUPLICATE_ENTRY: "DUPLICATE_ENTRY",
  MISSING_DESCRIPTION: "MISSING_DESCRIPTION",
  MISSING_DOCUMENT_INFO: "MISSING_DOCUMENT_INFO",
  JOURNAL_SEQUENCE_GAP: "JOURNAL_SEQUENCE_GAP",
  ZERO_AMOUNT: "ZERO_AMOUNT",
  SUSPICIOUS_ROUNDING: "SUSPICIOUS_ROUNDING",
  DOCUMENT_DATE_GAP: "DOCUMENT_DATE_GAP",
  UNKNOWN_ISSUE: "UNKNOWN_ISSUE",
};

export const E_DEFTER_FINDING_CODE = {
  COMPANY_MISMATCH: "COMPANY_MISMATCH",
  MIXED_COMPANY_OR_PERIOD: "MIXED_COMPANY_OR_PERIOD",
  JOURNAL_LEDGER_MISMATCH: "JOURNAL_LEDGER_MISMATCH",
  EXTERNAL_VERIFICATION_REQUIRED: "EXTERNAL_VERIFICATION_REQUIRED",
  HESAP_PLANINDA_YOK: "HESAP_PLANINDA_YOK",
  DONEM_DISI: "DONEM_DISI",
  NEGATIF_SIFIR: "NEGATIF_SIFIR",
  TOPLAM_BORC_ALACAK: "TOPLAM_BORC_ALACAK",
  ...E_DEFTER_ISSUE_CODE,
};

export const E_DEFTER_REPORT_DISCLAIMER =
  "Bu rapor ANNVERO E-Defter Kontrol Merkezi tarafından üretilmiştir. GİB doğrulaması veya mali mühür kriptografik teyidi içermez; kesin vergi hükmü değildir.";

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

/** Skor → 4 seviye sonuç */
export function sonucSeviyeFromScore(score) {
  if (score >= 71) return E_DEFTER_SONUC_SEVIYE.KRITIK;
  if (score >= 40) return E_DEFTER_SONUC_SEVIYE.UYARI;
  if (score >= 15) return E_DEFTER_SONUC_SEVIYE.BILGI;
  return E_DEFTER_SONUC_SEVIYE.UYGUN;
}

export function mapLegacyLevelToSonuc(level = "") {
  const t = String(level || "");
  if (
    t === E_DEFTER_SONUC_SEVIYE.KRITIK ||
    t === E_DEFTER_RISK_LEVEL.KRITIK ||
    t === "Kritik" ||
    t === "Kritik hata"
  ) {
    return E_DEFTER_SONUC_SEVIYE.KRITIK;
  }
  if (t === E_DEFTER_RISK_LEVEL.YUKSEK || t === "Yüksek" || t === E_DEFTER_SONUC_SEVIYE.UYARI) {
    return E_DEFTER_SONUC_SEVIYE.UYARI;
  }
  if (t === E_DEFTER_RISK_LEVEL.ORTA || t === "Orta" || t === E_DEFTER_SONUC_SEVIYE.BILGI || t === "Bilgi") {
    return E_DEFTER_SONUC_SEVIYE.BILGI;
  }
  return E_DEFTER_SONUC_SEVIYE.UYGUN;
}

export function riskLevelBadgeClass(level) {
  if (
    level === E_DEFTER_RISK_LEVEL.KRITIK ||
    level === E_DEFTER_SONUC_SEVIYE.KRITIK
  ) {
    return "bg-red-950 text-red-200 ring-red-700/60";
  }
  if (level === E_DEFTER_RISK_LEVEL.YUKSEK || level === E_DEFTER_SONUC_SEVIYE.UYARI) {
    return "bg-orange-950 text-orange-200 ring-orange-700/60";
  }
  if (level === E_DEFTER_RISK_LEVEL.ORTA || level === E_DEFTER_SONUC_SEVIYE.BILGI) {
    return "bg-amber-950 text-amber-200 ring-amber-700/60";
  }
  return "bg-slate-800 text-slate-200 ring-slate-600/60";
}
