/**
 * Güvenlik ve Sistem Merkezi — Faz 2 planı.
 * Tam dashboard UI Faz 3'te; bu dosya metrik kaynaklarını ve API iskeletini tanımlar.
 */

export const SYSTEM_HEALTH_CENTER_ID = "security-system-center";

/** İleride admin dashboard'da gösterilecek metrik kartları */
export const SYSTEM_HEALTH_METRICS = [
  {
    key: "last_backup",
    label: "Son firma yedeği",
    source: "audit_events",
    filter: { action: "export", entity_type: "company_backup" },
    description: "Son başarılı company-export audit kaydı",
  },
  {
    key: "last_audit_event",
    label: "Son audit event",
    source: "audit_events",
    orderBy: "created_at desc",
    limit: 1,
  },
  {
    key: "last_login_event",
    label: "Son login event",
    source: "login_events",
    orderBy: "created_at desc",
    limit: 1,
  },
  {
    key: "last_migration",
    label: "Son migration",
    source: "manual",
    description: "Supabase migration geçmişi / deploy notu (Faz 3)",
  },
  {
    key: "api_error_rate",
    label: "API hata oranı",
    source: "system_logs",
    description: "systemLogEngine + Vercel function logs (Faz 3)",
  },
  {
    key: "gib_connection",
    label: "GİB bağlantı durumu",
    source: "gib_company_query_state",
    description: "Son sorgu durumu ve hata sayısı",
  },
  {
    key: "storage_status",
    label: "Storage durumu",
    source: "supabase_storage",
    description: "Bucket kullanımı (Faz 3)",
  },
  {
    key: "cron_automation",
    label: "Cron / automation",
    source: "automation_webhooks",
    description: "Son webhook ve zamanlanmış görev (Faz 3)",
  },
  {
    key: "rls_api_guard",
    label: "RLS / API guard",
    source: "static_checklist",
    description: "Migration 015/016 + route guard coverage",
  },
];

/** Önerilen admin route (UI Faz 3) */
export const SYSTEM_HEALTH_ADMIN_ROUTE = "/admin/guvenlik-sistem-merkezi";

/** Faz 2'de hazır API uçları */
export const SYSTEM_HEALTH_API_ENDPOINTS = [
  "/api/backup/company-export",
  "/api/recovery/deleted-records",
  "/api/auth/login-event",
];

/** Faz 3 backlog */
export const SYSTEM_HEALTH_PHASE3_TASKS = [
  "Admin dashboard UI — metrik kartları ve durum özeti",
  "Otomatik haftalık company-export zamanlayıcısı",
  "Redis/Upstash rate limit (production)",
  "API hata oranı toplama (middleware veya log drain)",
  "Recovery restore işlemleri",
  "Sistem sağlığı e-posta / push uyarıları",
];

export const SYSTEM_HEALTH_IMPLEMENTATION_NOTES = [
  "Faz 2: export + recovery list + login_events + rate limit altyapısı tamamlandı.",
  "Audit export action: AUDIT_ACTIONS.EXPORT + entity_type company_backup.",
  "Health merkezi verileri service_role API üzerinden okunmalı; RLS bypass + management guard.",
];
