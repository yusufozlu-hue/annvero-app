export const N8N_AUTOMATION_FLOWS_STORAGE_KEY = "annvero_n8n_flows_v1";
export const N8N_AUTOMATION_QUEUE_STORAGE_KEY = "annvero_n8n_queue_v1";
export const N8N_AUTOMATION_LOGS_STORAGE_KEY = "annvero_n8n_logs_v1";
export const N8N_AUTOMATION_TRIGGERS_STORAGE_KEY = "annvero_n8n_triggers_v1";
export const N8N_AUTOMATION_SCHEDULES_STORAGE_KEY = "annvero_n8n_schedules_v1";
export const N8N_AUTOMATION_ERRORS_STORAGE_KEY = "annvero_n8n_errors_v1";
export const N8N_AUTOMATION_RULES_STORAGE_KEY = "annvero_n8n_learned_rules_v1";
export const N8N_AUTOMATION_APPROVALS_STORAGE_KEY = "annvero_n8n_approvals_v1";

export const N8N_AUTOMATION_VIEWS = [
  { id: "flows", label: "Akışlar" },
  { id: "triggers", label: "Tetikleyiciler" },
  { id: "queue", label: "Görev Kuyruğu" },
  { id: "logs", label: "Sistem Logları" },
  { id: "errors", label: "Hata Yönetimi" },
  { id: "schedules", label: "Zamanlanmış İşlemler" },
  { id: "integrations", label: "Entegrasyonlar" },
];

export const N8N_JOB_STATUS = {
  BEKLIYOR: "Bekliyor",
  CALISIYOR: "Çalışıyor",
  TAMAMLANDI: "Tamamlandı",
  UYARI: "Uyarı",
  HATA: "Hata",
  RETRY: "Retry Bekliyor",
  IPTAL: "İptal Edildi",
};

export const N8N_SCHEDULE_TYPES = {
  DAILY: "Günlük",
  WEEKLY: "Haftalık",
  MONTHLY: "Aylık",
  MANUAL: "Manuel",
};

export const N8N_FLOW_DEFINITIONS = [
  {
    id: "mail-to-pool",
    name: "Mail → Evrak Havuzu",
    module: "AI Ofis Asistanı",
    description: "Gelen mail eki AI ile sınıflandırılır, firmaya ve modüle yönlendirilir.",
    steps: ["mail_received", "ai_classify", "company_match", "route_module"],
  },
  {
    id: "bank-parser",
    name: "Banka Ekstresi → Parser",
    module: "Banka Parser Merkezi",
    description: "Yeni banka ekstresi parser çalıştırır, öğrenen hafıza ve unknown queue kontrol eder.",
    steps: ["file_uploaded", "run_parser", "learning_memory_check", "unknown_queue"],
  },
  {
    id: "declaration-distribution",
    name: "SGK / Beyanname → Dağılım Merkezi",
    module: "Beyanname / Tahakkuk",
    description: "Tahakkuk evrağı tanınır, dağılım merkezine aktarılır, eksik eşleşmede görev oluşturulur.",
    steps: ["detect_declaration", "route_distribution", "create_task_if_missing"],
  },
  {
    id: "risk-daily",
    name: "Risk Merkezi Günlük Analiz",
    module: "Kurgan Risk Denetim",
    description: "Gece otomatik risk analizi çalıştırır, kritik riskleri dashboard ve görevlere yazar.",
    steps: ["scheduled_run", "analyze_risks", "write_dashboard", "create_tasks"],
  },
  {
    id: "edefter-check",
    name: "E-Defter Kontrol Otomasyonu",
    module: "E-Defter Kontrol",
    description: "XML/ZIP yükleme sonrası otomatik kontrol başlatır, teknik hataları loglar.",
    steps: ["file_uploaded", "parse_xml", "run_controls", "write_logs"],
  },
];

export const N8N_INTEGRATION_PLACEHOLDERS = [
  { id: "gmail", label: "Gmail", status: "altyapi" },
  { id: "outlook", label: "Outlook", status: "altyapi" },
  { id: "google-drive", label: "Google Drive", status: "altyapi" },
  { id: "dropbox", label: "Dropbox", status: "altyapi" },
  { id: "gib", label: "GİB", status: "altyapi" },
  { id: "sgk", label: "SGK", status: "altyapi" },
  { id: "whatsapp", label: "WhatsApp", status: "altyapi" },
  { id: "sms", label: "SMS", status: "altyapi" },
  { id: "slack", label: "Slack", status: "altyapi" },
  { id: "n8n", label: "n8n Webhook", status: "hazir" },
];

export const N8N_MAX_RETRY = 3;

export const N8N_CRITICAL_FLOWS = new Set(["risk-daily", "bank-parser"]);

export const N8N_FLOW_MODULE_ROUTES = {
  "mail-to-pool": "/evrak-havuzu",
  "bank-parser": "/muhasebe/banka-ekstresi",
  "declaration-distribution": "/muhasebe/beyanname-tahakkuk",
  "risk-daily": "/muhasebe/risk-denetim-merkezi",
  "edefter-check": "/muhasebe/e-defter-kontrol",
};
