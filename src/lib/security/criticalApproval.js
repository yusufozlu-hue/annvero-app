/**
 * Kritik işlemler için insan onayı kapısı.
 * Kod bu onay olmadan production'da otomatik çalıştırmamalı.
 */

export const CRITICAL_OPERATIONS = Object.freeze({
  PRODUCTION_MIGRATION: "production_migration",
  ROLE_OR_MEMBERSHIP_CHANGE: "role_or_membership_change",
  CREDENTIAL_CHANGE: "credential_change",
  BULK_DATA_OPERATION: "bulk_data_operation",
  RESTORE: "restore",
  BACKUP_RETENTION_DELETE: "backup_retention_delete",
  COMPANY_RESTORE: "company_restore",
  GRANT_ADMIN: "grant_admin",
});

export const CRITICAL_CONFIRMATION_PHRASES = Object.freeze({
  [CRITICAL_OPERATIONS.RESTORE]: "RESTORE_CONFIRM",
  [CRITICAL_OPERATIONS.PRODUCTION_MIGRATION]: "MIGRATE_PRODUCTION_CONFIRM",
  [CRITICAL_OPERATIONS.BACKUP_RETENTION_DELETE]: "BACKUP_DELETE_CONFIRM",
  [CRITICAL_OPERATIONS.GRANT_ADMIN]: "GRANT_ADMIN_CONFIRM",
  [CRITICAL_OPERATIONS.ROLE_OR_MEMBERSHIP_CHANGE]: "MEMBERSHIP_CHANGE_CONFIRM",
  [CRITICAL_OPERATIONS.CREDENTIAL_CHANGE]: "CREDENTIAL_CHANGE_CONFIRM",
  [CRITICAL_OPERATIONS.BULK_DATA_OPERATION]: "BULK_OPERATION_CONFIRM",
  [CRITICAL_OPERATIONS.COMPANY_RESTORE]: "COMPANY_RESTORE_CONFIRM",
});

/**
 * @returns {{ ok: boolean, error?: string, phrase?: string }}
 */
export function assertCriticalHumanApproval({
  operation,
  confirm = false,
  confirmPhrase = "",
  summary = null,
} = {}) {
  const expected = CRITICAL_CONFIRMATION_PHRASES[operation];
  if (!expected) {
    return { ok: false, error: `Bilinmeyen kritik işlem: ${operation}` };
  }

  if (!summary || typeof summary !== "object") {
    return {
      ok: false,
      error: "Kritik işlem için işlem özeti (summary) zorunludur.",
      phrase: expected,
    };
  }

  if (confirm !== true || String(confirmPhrase) !== expected) {
    return {
      ok: false,
      error: `İnsan onayı gerekli. confirm=true ve confirmPhrase="${expected}" gönderin.`,
      phrase: expected,
      code: "HUMAN_APPROVAL_REQUIRED",
    };
  }

  return { ok: true, phrase: expected };
}

export function isProductionRuntime() {
  return (
    process.env.ANNVERO_APP_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    (process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview")
  );
}

/**
 * Production'da otomatik destructive/kritik script engeli.
 */
export function assertNotAutoProductionCritical(operation) {
  if (!isProductionRuntime()) return { ok: true };
  if (process.env.ANNVERO_CRITICAL_AUTO_EXECUTE === "1") {
    return {
      ok: false,
      error: "ANNVERO_CRITICAL_AUTO_EXECUTE production'da desteklenmez; insan onayı zorunlu.",
      operation,
    };
  }
  return {
    ok: false,
    error: `Production'da ${operation} otomatik çalıştırılamaz; insan onayı + özet gerekir.`,
    operation,
  };
}
