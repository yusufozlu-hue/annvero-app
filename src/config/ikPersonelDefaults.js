export const IK_PERSONEL_PROFILES_STORAGE_KEY = "annvero_ik_personel_profiles_v1";
export const IK_PERSONEL_MOVEMENTS_STORAGE_KEY = "annvero_ik_personel_movements_v1";
export const IK_PERSONEL_LEAVES_STORAGE_KEY = "annvero_ik_personel_leaves_v1";
export const KIDEM_IHBAR_PREFILL_STORAGE_KEY = "annvero_kidem_ihbar_prefill_v1";

export const IK_MINIMUM_WAGE_2026 = 26005.5;

export const IK_WORK_TYPES = ["Tam zamanlı", "Yarı zamanlı", "Stajyer", "Geçici"];

export const IK_MOVEMENT_TYPES = [
  "İşe giriş",
  "İşten çıkış",
  "Ücret değişikliği",
  "Departman değişikliği",
  "Görev değişikliği",
  "Ücretsiz izin",
  "Rapor",
  "Yıllık izin",
];

export const IK_LEAVE_TYPES = [
  "Yıllık izin",
  "Ücretsiz izin",
  "Rapor",
  "Doğum izni",
  "Evlilik izni",
  "Ölüm izni",
];

export const IK_RISK_LEVEL = {
  LOW: "Düşük",
  MEDIUM: "Orta",
  HIGH: "Yüksek",
  CRITICAL: "Kritik",
};

export const IK_SGK_CHECK_TYPES = {
  EKSIK_GUN: "Eksik gün",
  MESLEK_KODU: "Meslek kodu riski",
  TARIH_UYUMU: "İşe giriş/çıkış tarih uyumu",
  UCRET_PRIM: "Ücret / prime esas kazanç",
  LISTE_UYUMU: "SGK tahakkuk ile personel listesi uyumu",
};

export const IK_PAYROLL_RISK_TYPES = {
  ASGARI_UCRET: "Asgari ücret altında ücret",
  EKSIK_GUN_ACIKLAMA: "Eksik gün açıklaması eksikliği",
  MUKERRER_TC: "Mükerrer personel",
  UCRET_DEGISIMI: "Uzun süre ücret değişmeyen personel",
  CIKIS_KODU: "İşten çıkış kodu kontrolü",
  KIDEM_KARSILIK: "Kıdem/ihbar karşılığı kontrolü",
};

export const IK_PERSONEL_EXCEL_HEADERS = [
  "Ad Soyad",
  "TC No",
  "SGK Sicil No",
  "İşe Giriş Tarihi",
  "İşten Çıkış Tarihi",
  "Meslek Kodu",
  "Departman",
  "Görev",
  "Brüt Ücret",
  "Net Ücret",
  "Çalışma Türü",
  "Aktif/Pasif",
];
