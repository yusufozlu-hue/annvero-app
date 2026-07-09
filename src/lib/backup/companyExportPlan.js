/**
 * Firma bazlı yedekleme mimarisi — Güvenlik Faz 1 (plan / altyapı).
 * Henüz otomatik çalıştırıcı yok; export noktaları ve paket şeması tanımlı.
 */

import { ACCOUNT_PLAN_STORAGE_KEY, RULE_ENGINE_STORAGE_KEY } from "@/src/utils/companyCenter";
import { BANK_CARD_OPS_SESSION_KEY } from "@/src/utils/bankCardOpsCenter";

/** Tek firma yedek paketi şeması (v2 — Faz 2 export envelope) */
export const COMPANY_BACKUP_SCHEMA_VERSION = 2;

/**
 * DB tabanlı export kaynakları (API veya service_role ile).
 * Gerçek export: GET /api/backup/company-export?companyId=...
 */
export const COMPANY_DB_EXPORT_SOURCES = [
  {
    key: "companies",
    table: "companies",
    filterColumn: "id",
    apiPath: "/api/backup/company-export?companyId={companyId}",
    description: "Firma ana kaydı (companies.data jsonb)",
  },
  {
    key: "learning_memory",
    table: "learning_memory",
    filterColumn: "company_id",
    apiPath: "/api/backup/company-export?companyId={companyId}",
    description: "Öğrenen hafıza kayıtları",
  },
  {
    key: "learned_bank_rules",
    table: "learned_bank_rules",
    filterColumn: "company_id",
    apiPath: "/api/backup/company-export?companyId={companyId}",
    description: "Öğrenilen banka kuralları",
  },
  {
    key: "normalized_financial_transactions",
    table: "normalized_financial_transactions",
    filterColumn: "company_id",
    apiPath: "/api/backup/company-export?companyId={companyId}",
    description: "Banka & Kart operasyon hareketleri",
  },
  {
    key: "reconciliation_matches",
    table: "reconciliation_matches",
    filterColumn: "company_id",
    apiPath: "/api/backup/company-export?companyId={companyId}",
    description: "Mutabakat eşleşmeleri",
  },
  {
    key: "audit_events",
    table: "audit_events",
    filterColumn: "company_id",
    apiPath: "/api/backup/company-export?companyId={companyId}",
    description: "Audit log kayıtları",
  },
  {
    key: "official_notifications",
    table: "official_notifications",
    filterColumn: "company_id",
    apiPath: "/api/backup/company-export?companyId={companyId}",
    description: "Resmi bildirimler",
  },
  {
    key: "company_gib_credentials",
    table: "company_gib_credentials",
    filterColumn: "company_id",
    apiPath: "/api/backup/company-export?companyId={companyId}",
    description: "GİB kimlik bilgileri (şifreli)",
    optional: true,
  },
  {
    key: "gib_company_query_state",
    table: "gib_company_query_state",
    filterColumn: "company_id",
    apiPath: "/api/backup/company-export?companyId={companyId}",
    description: "GİB sorgu durumu",
    optional: true,
  },
  {
    key: "gib_query_sessions",
    table: "gib_query_sessions",
    filterColumn: "company_id",
    apiPath: "/api/backup/company-export?companyId={companyId}",
    description: "GİB sorgu oturumları",
    optional: true,
  },
  {
    key: "gib_check_reminders",
    table: "gib_check_reminders",
    filterColumn: "company_id",
    apiPath: "/api/backup/company-export?companyId={companyId}",
    description: "GİB kontrol hatırlatmaları",
    optional: true,
  },
  {
    key: "unrecognized_transactions",
    table: "unrecognized_transactions",
    filterColumn: "company_id",
    apiPath: "/api/transaction-memory?companyId={companyId}",
    description: "Tanınmayan işlem kuyruğu",
    optional: true,
  },
];

/**
 * Tarayıcı localStorage export noktaları (manuel veya script ile).
 */
export const COMPANY_LOCAL_EXPORT_SOURCES = [
  {
    key: "account_plan",
    storageKey: ACCOUNT_PLAN_STORAGE_KEY,
    companyScoped: true,
    description: "Hesap planı — annvero_account_plans_v1[companyId]",
  },
  {
    key: "rule_engine",
    storageKey: RULE_ENGINE_STORAGE_KEY,
    companyScoped: true,
    description: "Kural motoru — annvero_rule_engine_v1 içinde firma kuralları",
  },
  {
    key: "bank_card_ops_session",
    storageKey: BANK_CARD_OPS_SESSION_KEY,
    companyScoped: false,
    description: "Son banka operasyon oturumu (geçici)",
  },
];

/**
 * Firma yedek paketi iskeleti (Faz 2 envelope).
 */
export function buildCompanyBackupEnvelope(companyId, partial = {}) {
  return {
    version: COMPANY_BACKUP_SCHEMA_VERSION,
    exported_at: partial.exported_at || new Date().toISOString(),
    company_id: String(companyId || "").trim(),
    company_name: partial.company_name || partial.companyName || "",
    exported_by: partial.exported_by || partial.exportedBy || "",
    tables: partial.tables || partial.data || {},
    metadata: partial.metadata || partial.meta || {},
  };
}

/**
 * Export adımları:
 * 1. GET /api/backup/company-export?companyId=... (management + company access)
 * 2. audit_events + company_backup_runs metadata
 * 3. Import/restore — Faz 3
 */

export const COMPANY_BACKUP_IMPLEMENTATION_CHECKLIST = [
  "Migration 016 uygulandıktan sonra login_events + company_backup_runs hazır",
  "GET /api/backup/company-export — management guard + rate limit",
  "GET /api/recovery/deleted-records — soft delete listeleme",
  "Import/restore — Faz 3",
  "Haftalık Supabase otomatik yedek + manuel export doğrulaması",
];
