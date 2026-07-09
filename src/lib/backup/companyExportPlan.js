/**
 * Firma bazlı yedekleme mimarisi — Güvenlik Faz 1 (plan / altyapı).
 * Henüz otomatik çalıştırıcı yok; export noktaları ve paket şeması tanımlı.
 */

import { ACCOUNT_PLAN_STORAGE_KEY, RULE_ENGINE_STORAGE_KEY } from "@/src/utils/companyCenter";
import { BANK_CARD_OPS_SESSION_KEY } from "@/src/utils/bankCardOpsCenter";

/** Tek firma yedek paketi şeması (v1) */
export const COMPANY_BACKUP_SCHEMA_VERSION = 1;

/**
 * DB tabanlı export kaynakları (API veya service_role ile).
 */
export const COMPANY_DB_EXPORT_SOURCES = [
  {
    key: "company",
    table: "companies",
    filterColumn: "id",
    apiPath: null,
    description: "Firma ana kaydı (companies.data jsonb)",
  },
  {
    key: "learning_memory",
    table: "learning_memory",
    filterColumn: "company_id",
    apiPath: "/api/learning-memory?companyId={companyId}",
    description: "Öğrenen hafıza kayıtları",
  },
  {
    key: "unrecognized_transactions",
    table: "unrecognized_transactions",
    filterColumn: "company_id",
    apiPath: "/api/transaction-memory?companyId={companyId}",
    description: "Tanınmayan işlem kuyruğu",
  },
  {
    key: "normalized_financial_transactions",
    table: "normalized_financial_transactions",
    filterColumn: "company_id",
    apiPath: "/api/bank-card-ops?companyId={companyId}",
    description: "Banka & Kart operasyon hareketleri",
  },
  {
    key: "learned_bank_rules",
    table: "learned_bank_rules",
    filterColumn: "company_id",
    apiPath: "/api/learned-bank-rules?companyId={companyId}",
    description: "Öğrenilen banka kuralları",
  },
  {
    key: "reconciliation_matches",
    table: "reconciliation_matches",
    filterColumn: "company_id",
    apiPath: "/api/reconciliation-matches?companyId={companyId}",
    description: "Mutabakat eşleşmeleri",
  },
  {
    key: "official_notifications",
    table: "official_notifications",
    filterColumn: "company_id",
    apiPath: "/api/official-notifications?companyId={companyId}",
    description: "Resmi bildirimler",
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
 * Firma yedek paketi iskeleti (export implementasyonu için).
 */
export function buildCompanyBackupEnvelope(companyId, partial = {}) {
  return {
    schemaVersion: COMPANY_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    companyId: String(companyId || "").trim(),
    sources: {
      database: COMPANY_DB_EXPORT_SOURCES.map((s) => s.key),
      localStorage: COMPANY_LOCAL_EXPORT_SOURCES.filter((s) => s.companyScoped).map(
        (s) => s.key
      ),
    },
    data: partial.data || {},
    meta: partial.meta || {},
  };
}

/**
 * Gelecekteki `scripts/export-company-backup.mjs` için adımlar:
 * 1. Oturumlu kullanıcı veya service_role ile DB kaynaklarını çek
 * 2. Browser export script ile localStorage birleştir (opsiyonel)
 * 3. buildCompanyBackupEnvelope ile tek JSON üret
 * 4. audit_events: action=export
 */

export const COMPANY_BACKUP_IMPLEMENTATION_CHECKLIST = [
  "Migration 015 uygulandıktan sonra API'ler auth + company scope ile export",
  "scripts/export-company-backup.mjs — service_role + companyId argümanı",
  "Import: scripts/import-companies-json.mjs genişletilecek (learning_memory dahil)",
  "Haftalık Supabase otomatik yedek + manuel export doğrulaması",
];
