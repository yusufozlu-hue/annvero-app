export const ANNVERO_NAV_GROUPS = [
  { title: "Dashboard", href: "/dashboard" },
  {
    title: "Muhasebe Merkezi",
    items: [
      { label: "Muhasebe Ana Sayfa", href: "/muhasebe" },
      { label: "Firma Yönetimi", href: "/muhasebe/firma-yonetimi" },
      { label: "Hesap Planı", href: "/muhasebe/hesap-plani" },
      { label: "Kural Motoru", href: "/muhasebe/kural-motoru" },
      { label: "Öğrenen Hafıza", href: "/muhasebe/ogrenen-hafiza" },
      { label: "İşlem Hafızası", href: "/muhasebe/islem-hafizasi" },
      { label: "Fiş Dönüştürme", href: "/muhasebe/fis-donusturme" },
      { label: "Luca Dönüştürücü", href: "/muhasebe/luca-donusturucu" },
      { label: "Banka Parser", href: "/muhasebe/banka-ekstresi" },
      { label: "Banka Mutabakat", href: "/muhasebe/banka-mutabakat" },
      { label: "ElektraWeb", href: "/muhasebe/elektraweb" },
      { label: "Ofis Takip", href: "/ofis-takip" },
    ],
  },
  {
    title: "Risk & Denetim Merkezi",
    items: [
      { label: "Risk Denetim Merkezi", href: "/muhasebe/risk-denetim-merkezi" },
      { label: "AI Kontrol", href: "/muhasebe/ai-kontrol" },
      { label: "Fiş Kontrol", href: "/muhasebe/fis-kontrol" },
      { label: "KDV Matrah Kontrol", href: "/muhasebe/kdv-matrah-kontrol" },
    ],
  },
  {
    title: "E-Defter Merkezi",
    items: [
      { label: "e-Defter Kontrol", href: "/muhasebe/e-defter-kontrol" },
      { label: "Luca Aktarım Kontrol", href: "/muhasebe/luca-aktarim-kontrol" },
    ],
  },
  {
    title: "Beyanname Merkezi",
    items: [
      { label: "Beyanname / Tahakkuk", href: "/muhasebe/beyanname-tahakkuk" },
      { label: "Poliçe Giderleştirme", href: "/muhasebe/police-giderlestirme" },
      { label: "Resmi Bildirimler", href: "/dashboard/ofis-takip/resmi-bildirimler" },
    ],
  },
  {
    title: "İK / Personel Merkezi",
    items: [
      { label: "Personel Operasyon Merkezi", href: "/ik-personel" },
      { label: "Toplu Kıdem İhbar", href: "/muhasebe/toplu-kidem-ihbar" },
      { label: "Kıdem İhbar", href: "/hesaplama-araclari/kidem-ihbar" },
    ],
  },
  {
    title: "Ticaret Sicil Merkezi",
    items: [
      { label: "Operasyon Merkezi", href: "/ticaret-sicil" },
      { label: "Firma Yönetimi", href: "/muhasebe/firma-yonetimi" },
    ],
  },
  {
    title: "AI Ofis Asistanı",
    items: [
      { label: "AI Sınıflandırma", href: "/ai-ofis-asistani?view=classification" },
      { label: "Firma Eşleştirme", href: "/ai-ofis-asistani?view=matching" },
      { label: "Görevler", href: "/ai-ofis-asistani?view=tasks" },
      { label: "Hatırlatmalar", href: "/ai-ofis-asistani?view=reminders" },
      { label: "İşlem Geçmişi", href: "/ai-ofis-asistani?view=history" },
    ],
  },
  {
    title: "Evrak Havuzu",
    items: [
      { label: "Evrak Havuzu", href: "/ai-ofis-asistani?view=pool" },
      { label: "Mail Gelen Kutusu", href: "/ai-ofis-asistani?view=mail" },
    ],
  },
  {
    title: "Otomasyon Merkezi",
    items: [
      { label: "Akışlar", href: "/otomasyon?view=flows" },
      { label: "Görev Kuyruğu", href: "/otomasyon?view=queue" },
      { label: "Sistem Logları", href: "/otomasyon?view=logs" },
      { label: "Hata Yönetimi", href: "/otomasyon?view=errors" },
      { label: "Zamanlanmış İşlemler", href: "/otomasyon?view=schedules" },
      { label: "Entegrasyonlar", href: "/otomasyon?view=integrations" },
    ],
  },
  {
    title: "Finansal Analiz Merkezi",
    items: [
      { label: "Adat Hesaplama", href: "/muhasebe/adat-hesaplama" },
      { label: "Kur Değerleme", href: "/muhasebe/kur-degerleme" },
      { label: "Finansman Gider Kısıtlaması", href: "/muhasebe/finansman-gider-kisitlamasi" },
    ],
  },
  {
    title: "Hesaplama Araçları",
    items: [
      { label: "Araçlar Merkezi", href: "/hesaplama-araclari" },
      { label: "Kıdem İhbar", href: "/hesaplama-araclari/kidem-ihbar" },
      { label: "Maaş Hesaplama", href: "/hesaplama-araclari/maas-hesaplama" },
    ],
  },
  {
    title: "Sistem Yönetimi",
    items: [
      { label: "Sistem Hata ve İşlem Logları", href: "/sistem-loglari", roles: ["admin", "partner", "mudur", "denetim_personeli"] },
      { label: "Parametreler", href: "/admin/parametre-yonetimi", roles: ["admin"] },
      { label: "Mevzuat Hap Notları", href: "/admin/mevzuat-hap-notlari", roles: ["admin"] },
      { label: "Firma Yönetimi", href: "/muhasebe/firma-yonetimi", roles: ["admin", "partner"] },
      { label: "Entegrasyonlar", href: "/otomasyon?view=integrations", roles: ["admin", "partner", "mudur", "muhasebe_personeli"] },
      { label: "Kullanıcılar & Roller", href: "/admin/kullanicilar-roller", roles: ["admin", "partner"] },
      { label: "Sistem Ayarları", href: "/admin/parametre-yonetimi", roles: ["admin"] },
      { label: "Backup / Migration", href: "/muhasebe/firma-yonetimi", roles: ["admin", "partner"] },
      { label: "Mevzuat Hap Notları (Genel)", href: "/mevzuat-hap-notlari" },
    ],
  },
];

export const ANNVERO_SELECTED_COMPANY_KEY = "annvero_selected_company_v1";
export const ANNVERO_FAVORITE_COMPANIES_KEY = "annvero_favorite_companies_v1";
export const ANNVERO_RECENT_COMPANIES_KEY = "annvero_recent_companies_v1";
export const ANNVERO_THEME_KEY = "annvero_theme_v1";
export const ANNVERO_COMPANY_CHANGED_EVENT = "annvero:company-changed";
