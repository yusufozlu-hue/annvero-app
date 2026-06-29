export const OFIS_TAKIP_STORAGE_KEY = "annvero-ofis-takip-v1";

export const OFIS_TAKIP_TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "mukellefler", label: "Firmalar" },
  { id: "yapilacaklar", label: "Yapılacaklar" },
  { id: "tamamlananlar", label: "Tamamlananlar" },
  { id: "vergi-takvimi", label: "Vergi Takvimi" },
  { id: "hatirlatmalar", label: "Hatırlatmalar" },
  { id: "ayarlar", label: "Ayarlar" },
];

export const ONCELIK_OPTIONS = [
  { value: "dusuk", label: "Düşük" },
  { value: "normal", label: "Normal" },
  { value: "yuksek", label: "Yüksek" },
];

export const MUKELLEF_EXCEL_HEADERS = [
  "Unvan",
  "Vergi No",
  "Telefon",
  "E-posta",
  "Notlar",
];

export const DEFAULT_WHATSAPP_TEMPLATE =
  "Sayın {mukellef}, {konu} için son tarih {tarih}. Bilgi rica ederiz.";
