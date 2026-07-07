export const AI_OFIS_DOCUMENTS_STORAGE_KEY = "annvero_ai_ofis_documents_v1";
export const AI_OFIS_MAILS_STORAGE_KEY = "annvero_ai_ofis_mails_v1";
export const AI_OFIS_TASKS_STORAGE_KEY = "annvero_ai_ofis_tasks_v1";
export const AI_OFIS_REMINDERS_STORAGE_KEY = "annvero_ai_ofis_reminders_v1";
export const AI_OFIS_HISTORY_STORAGE_KEY = "annvero_ai_ofis_history_v1";
export const AI_OFIS_LOCAL_RULES_STORAGE_KEY = "annvero_ai_ofis_local_rules_v1";

export const AI_OFIS_VIEWS = [
  { id: "pool", label: "Evrak Havuzu" },
  { id: "mail", label: "Mail Gelen Kutusu" },
  { id: "classification", label: "AI Sınıflandırma" },
  { id: "matching", label: "Firma Eşleştirme" },
  { id: "tasks", label: "Görevler" },
  { id: "reminders", label: "Hatırlatmalar" },
  { id: "history", label: "İşlem Geçmişi" },
];

export const AI_OFIS_DOCUMENT_STATUS = {
  YENI: "Yeni",
  AI_SINIFLANDIRILDI: "AI Sınıflandırıldı",
  MANUEL_KONTROL: "Manuel Kontrol Bekliyor",
  MODULE_AKTARILDI: "İlgili Modüle Aktarıldı",
  ISLENDI: "İşlendi",
  EKSIK_BILGI: "Eksik Bilgi",
  ARSIV: "Arşivlendi",
};

export const AI_OFIS_WORKFLOW_STATUS = {
  YENI: "Yeni",
  MUHASEBE_ISLIYOR: "Muhasebe İşliyor",
  BORDRO_ISLIYOR: "Bordro İşliyor",
  DENETIM_INCELIYOR: "Denetim İnceliyor",
  EKSIK_EVRAK: "Eksik Evrak",
  TAMAMLANDI: "Tamamlandı",
};

export const AI_OFIS_WORKFLOW_STATUS_LIST = Object.values(AI_OFIS_WORKFLOW_STATUS);

export const AI_OFIS_SOURCES = {
  MANUEL: "Manuel",
  MAIL: "Mail",
  N8N: "n8n",
  IMAP: "IMAP",
};

export const AI_OFIS_DOCUMENT_TYPES = [
  "Fatura",
  "Banka ekstresi",
  "Kredi kartı ekstresi",
  "Dekont",
  "SGK tahakkuk",
  "MUHSGK",
  "KDV beyannamesi",
  "KDV2 beyannamesi",
  "Konaklama vergisi",
  "Turizm payı",
  "Bordro",
  "Personel belgesi",
  "Ticaret sicil evrakı",
  "E-defter dosyası",
  "Sözleşme",
  "Diğer",
];

export const AI_OFIS_MODULE_ROUTES = {
  Fatura: { label: "Luca Fiş Üretici / Fatura Merkezi", href: "/muhasebe/fis-donusturme" },
  "Banka ekstresi": { label: "Banka Parser Merkezi", href: "/muhasebe/banka-ekstresi" },
  "Kredi kartı ekstresi": { label: "Kredi Kartı Parser", href: "/muhasebe/fis-donusturme" },
  Dekont: { label: "Banka Parser Merkezi", href: "/muhasebe/banka-ekstresi" },
  "SGK tahakkuk": { label: "Beyanname / Tahakkuk Merkezi", href: "/muhasebe/beyanname-tahakkuk" },
  MUHSGK: { label: "Beyanname / Tahakkuk Merkezi", href: "/muhasebe/beyanname-tahakkuk" },
  "KDV beyannamesi": { label: "Beyanname / Tahakkuk Merkezi", href: "/muhasebe/beyanname-tahakkuk" },
  "KDV2 beyannamesi": { label: "Beyanname / Tahakkuk Merkezi", href: "/muhasebe/beyanname-tahakkuk" },
  "Konaklama vergisi": { label: "Beyanname / Tahakkuk Merkezi", href: "/muhasebe/beyanname-tahakkuk" },
  "Turizm payı": { label: "Beyanname / Tahakkuk Merkezi", href: "/muhasebe/beyanname-tahakkuk" },
  Bordro: { label: "İK / Personel Merkezi", href: "/ik-personel" },
  "Personel belgesi": { label: "İK / Personel Merkezi", href: "/ik-personel" },
  "Ticaret sicil evrakı": { label: "Ticaret Sicil Merkezi", href: "/ticaret-sicil" },
  "E-defter dosyası": { label: "E-Defter Kontrol Merkezi", href: "/muhasebe/e-defter-kontrol" },
  Sözleşme: { label: "Evrak Arşivi", href: "/ai-ofis-asistani?view=pool&status=Arşivlendi" },
  Diğer: { label: "Evrak Havuzu", href: "/ai-ofis-asistani?view=pool" },
};

export const AI_OFIS_TASK_TYPES = [
  "Eksik evrak",
  "İşlenecek banka ekstresi",
  "Kontrol edilecek beyanname",
  "Süresi yaklaşan işlem",
  "Müşteriden bilgi istenecek belge",
];

export const AI_OFIS_REMINDER_TYPES = {
  BEKLEYEN_EVRAK: "Bekleyen evrak",
  BANKA_EKSTRESI: "İşlenmemiş banka ekstresi",
  BEYANNAME: "Eksik beyanname/tahakkuk",
  PERSONEL: "Eksik personel belgesi",
  TICARET_SICIL: "Ticaret sicil eksik evrak",
  MUSTERI_DONUS: "Müşteri dönüş bekleyenler",
};

export const AI_OFIS_TYPE_KEYWORDS = {
  "Banka ekstresi": ["banka", "ekstre", "hesap hareket", "statement"],
  "Kredi kartı ekstresi": ["kredi kart", "credit card", "kart ekstre"],
  Dekont: ["dekont", "havale", "eft", "swift"],
  Fatura: ["fatura", "invoice", "e-fatura", "efatura"],
  "SGK tahakkuk": ["sgk", "tahakkuk", "ssk"],
  MUHSGK: ["muhsgk", "muh sgk"],
  "KDV beyannamesi": ["kdv beyan", "kdv1", "katma deger"],
  "KDV2 beyannamesi": ["kdv2", "kdv 2"],
  "Konaklama vergisi": ["konaklama vergisi", "konaklama"],
  "Turizm payı": ["turizm pay", "turizm"],
  Bordro: ["bordro", "payroll", "maas listesi"],
  "Personel belgesi": ["personel", "ise giris", "isegiris", "ik belge"],
  "Ticaret sicil evrakı": ["ticaret sicil", "mersis", "ana sozlesme", "kurulus"],
  "E-defter dosyası": ["e-defter", "edefter", "yevmiye", "kebir", ".xml", ".zip"],
  Sözleşme: ["sozlesme", "contract", "kira kontrat"],
};
