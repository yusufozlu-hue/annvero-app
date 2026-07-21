/**
 * Soft-delete restore — dry-run + yönetim yetkisi + entity allowlist + audit.
 * RESTORE_CONFIRM tek başına yetki değildir.
 * DB backup/PITR restore yapmaz — yalnız soft-delete satır geri alma.
 */

import { buildSoftRestorePatch } from "@/src/lib/softDelete";
import {
  applyCompanyIdScopeToQuery,
  applyCompanyScopeToQuery,
  assertCompanyAccess,
} from "@/src/lib/auth/apiGuard";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  writeAuditEvent,
} from "@/src/lib/audit/auditEvents";
import { redactDeep } from "@/src/lib/security/redact";

export const RESTORE_CONFIRMATION_PHRASE = "RESTORE_CONFIRM";

/** Client keyfi tablo adı kabul edilmez — sabit allowlist */
export const RESTORE_ENTITY_ALLOWLIST = Object.freeze([
  "companies",
  "learning_memory",
  "unrecognized_transactions",
  "normalized_financial_transactions",
  "learned_bank_rules",
  "reconciliation_matches",
  "official_notifications",
]);

const TABLE_ENTITY_MAP = {
  companies: AUDIT_ENTITY_TYPES.COMPANY,
  learning_memory: AUDIT_ENTITY_TYPES.LEARNING_MEMORY,
  unrecognized_transactions: AUDIT_ENTITY_TYPES.UNRECOGNIZED_TRANSACTION,
  normalized_financial_transactions: AUDIT_ENTITY_TYPES.BANK_TRANSACTION,
  learned_bank_rules: AUDIT_ENTITY_TYPES.RULE_ENGINE,
  reconciliation_matches: AUDIT_ENTITY_TYPES.BANK_TRANSACTION,
  official_notifications: AUDIT_ENTITY_TYPES.OFFICIAL_NOTIFICATION,
};

const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

function scopeForTable(table) {
  return table === "companies" ? "id" : "company_id";
}

function applyScope(query, access, companyId, table) {
  if (scopeForTable(table) === "id") {
    return applyCompanyIdScopeToQuery(query, access, companyId);
  }
  return applyCompanyScopeToQuery(query, access, companyId);
}

export function normalizeRestoreEntity(table = "") {
  const safe = String(table || "").trim().toLowerCase();
  if (!RESTORE_ENTITY_ALLOWLIST.includes(safe)) return "";
  // SQL/kolon enjeksiyonu engeli
  if (!/^[a-z0-9_]+$/.test(safe)) return "";
  return safe;
}

export function normalizeRestoreRecordId(recordId = "") {
  const id = String(recordId || "").trim();
  if (!id) return "";
  if (UUID_LIKE.test(id) || SAFE_ID.test(id)) return id;
  return "";
}

export function isRecoveryApiEnabled() {
  const env = String(process.env.ANNVERO_APP_ENV || process.env.VERCEL_ENV || "").toLowerCase();
  const isProd =
    env === "production" ||
    (process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview");
  if (!isProd) return true;
  return String(process.env.RECOVERY_API_ENABLED || "").trim() === "true";
}

/**
 * Restore öncesi özet (dry-run). Veri değiştirmez.
 */
export async function buildRestoreDryRun(supabase, access, {
  table,
  recordId,
  companyId = "",
} = {}) {
  const safeTable = normalizeRestoreEntity(table);
  const safeId = normalizeRestoreRecordId(recordId);

  if (!safeTable) {
    return { ok: false, error: "Geçersiz veya izin verilmeyen entity.", code: "ENTITY_NOT_ALLOWED" };
  }
  if (!safeId) {
    return { ok: false, error: "Geçersiz recordId.", code: "INVALID_RECORD_ID" };
  }

  if (companyId) {
    const check = assertCompanyAccess(access, companyId, { required: true });
    if (!check.ok) {
      return { ok: false, error: "Bu firmaya erişim yetkiniz yok.", code: "FORBIDDEN_COMPANY" };
    }
  }

  const { data, error } = await supabase
    .from(safeTable)
    .select("id, company_id, deleted_at, deleted_by, status")
    .eq("id", safeId)
    .not("deleted_at", "is", null)
    .maybeSingle();

  if (error) {
    return { ok: false, error: "Kayıt okunamadı.", code: "READ_FAILED" };
  }
  if (!data) {
    // Idempotent: zaten aktif olabilir
    const { data: active } = await supabase
      .from(safeTable)
      .select("id, company_id, deleted_at, status")
      .eq("id", safeId)
      .maybeSingle();

    if (active && !active.deleted_at) {
      const rowCompanyId =
        safeTable === "companies" ? active.id : active.company_id || companyId || "";
      const accessCheck = assertCompanyAccess(access, rowCompanyId, { required: true });
      if (!accessCheck.ok) {
        return { ok: false, error: "Bu kayda erişim yetkiniz yok.", code: "FORBIDDEN_RECORD" };
      }
      return {
        ok: true,
        dryRun: true,
        alreadyRestored: true,
        summary: {
          table: safeTable,
          recordId: safeId,
          companyId: rowCompanyId,
          deleted_at: null,
          confirmationRequired: RESTORE_CONFIRMATION_PHRASE,
          note: "Kayıt zaten aktif — tekrar restore no-op.",
        },
        preview: redactDeep({ id: active.id, company_id: rowCompanyId, deleted_at: null }),
      };
    }

    return { ok: false, error: "Silinmiş kayıt bulunamadı.", code: "NOT_FOUND" };
  }

  const rowCompanyId =
    safeTable === "companies" ? data.id : data.company_id || companyId || "";
  const accessCheck = assertCompanyAccess(access, rowCompanyId, { required: true });
  if (!accessCheck.ok) {
    return { ok: false, error: "Bu kayda erişim yetkiniz yok.", code: "FORBIDDEN_RECORD" };
  }

  return {
    ok: true,
    dryRun: true,
    alreadyRestored: false,
    summary: {
      table: safeTable,
      recordId: safeId,
      companyId: rowCompanyId,
      deleted_at: data.deleted_at,
      deleted_by: data.deleted_by || null,
      confirmationRequired: RESTORE_CONFIRMATION_PHRASE,
      note: "Gerçek restore için yönetim yetkisi + confirmPhrase gerekir. RESTORE_CONFIRM tek başına yetki değildir.",
    },
    preview: redactDeep({
      id: data.id,
      company_id: data.company_id || data.id,
      deleted_at: data.deleted_at,
      status: data.status || null,
    }),
  };
}

/**
 * Soft-delete geri yükleme.
 * Önkoşullar: management access (çağıran), company access, entity allowlist, confirm.
 */
export async function restoreDeletedRecord(supabase, access, options = {}, auditContext = {}) {
  const {
    table,
    recordId,
    companyId = "",
    confirm = false,
    confirmPhrase = "",
    requestId = "",
  } = options;

  if (!access?.isManagementUser) {
    void writeAuditEvent({
      ...auditContext,
      companyId: companyId || "",
      entityType: "recovery",
      entityId: String(recordId || ""),
      action: AUDIT_ACTIONS.RESTORE,
      result: "failure",
      metadata: redactDeep({ requestId, reason: "not_management", table }),
    });
    return { ok: false, error: "Yönetim yetkisi gerekli.", code: "FORBIDDEN_ROLE" };
  }

  if (!confirm || String(confirmPhrase) !== RESTORE_CONFIRMATION_PHRASE) {
    return {
      ok: false,
      error: `Açık onay gerekli. confirm=true ve confirmPhrase="${RESTORE_CONFIRMATION_PHRASE}" — bu phrase tek başına yetki vermez.`,
      code: "RESTORE_CONFIRMATION_REQUIRED",
    };
  }

  const dry = await buildRestoreDryRun(supabase, access, { table, recordId, companyId });
  if (!dry.ok) {
    void writeAuditEvent({
      ...auditContext,
      companyId: companyId || "",
      entityType: "recovery",
      entityId: String(recordId || ""),
      action: AUDIT_ACTIONS.RESTORE,
      result: "failure",
      metadata: redactDeep({ requestId, reason: dry.code || "dry_run_failed", table }),
    });
    return dry;
  }

  if (dry.alreadyRestored) {
    void writeAuditEvent({
      ...auditContext,
      companyId: dry.summary.companyId,
      entityType: TABLE_ENTITY_MAP[dry.summary.table] || dry.summary.table,
      entityId: dry.summary.recordId,
      action: AUDIT_ACTIONS.RESTORE,
      result: "success",
      metadata: redactDeep({ requestId, idempotent: true, alreadyRestored: true }),
    });
    return {
      ok: true,
      restored: {
        table: dry.summary.table,
        recordId: dry.summary.recordId,
        companyId: dry.summary.companyId,
        idempotent: true,
      },
    };
  }

  const safeTable = dry.summary.table;
  const safeId = dry.summary.recordId;
  const patch = buildSoftRestorePatch();
  if (safeTable === "learning_memory") {
    patch.status = "active";
  }

  let updateQuery = supabase
    .from(safeTable)
    .update(patch)
    .eq("id", safeId)
    .not("deleted_at", "is", null);

  const scoped = applyScope(updateQuery, access, dry.summary.companyId, safeTable);
  if (!scoped) {
    return { ok: false, error: "Firma kapsamı boş.", code: "EMPTY_SCOPE" };
  }

  const { data, error } = await scoped.select("id, deleted_at").maybeSingle();
  if (error) {
    void writeAuditEvent({
      ...auditContext,
      companyId: dry.summary.companyId,
      entityType: TABLE_ENTITY_MAP[safeTable] || safeTable,
      entityId: safeId,
      action: AUDIT_ACTIONS.RESTORE,
      result: "failure",
      metadata: redactDeep({ requestId, reason: "update_failed" }),
    });
    return { ok: false, error: "Restore başarısız.", code: "UPDATE_FAILED" };
  }
  if (!data) {
    // Race: başka süreç restore etmiş olabilir → idempotent success
    return {
      ok: true,
      restored: {
        table: safeTable,
        recordId: safeId,
        companyId: dry.summary.companyId,
        idempotent: true,
      },
    };
  }

  void writeAuditEvent({
    ...auditContext,
    companyId: dry.summary.companyId,
    entityType: TABLE_ENTITY_MAP[safeTable] || safeTable,
    entityId: safeId,
    action: AUDIT_ACTIONS.RESTORE,
    result: "success",
    beforeState: dry.preview,
    afterState: { id: safeId, deleted_at: null },
    metadata: redactDeep({
      requestId,
      table: safeTable,
      humanApproved: true,
      managementAuthorized: true,
    }),
  });

  try {
    await supabase.from("recovery_restore_approvals").insert([
      {
        company_id: dry.summary.companyId,
        table_name: safeTable,
        record_id: safeId,
        approved_by: auditContext.actorId || null,
        request_id: requestId,
        dry_run_summary: dry.summary,
        executed: true,
      },
    ]);
  } catch {
    // tablo yoksa (024 öncesi) ana işlem bozulmaz
  }

  return {
    ok: true,
    restored: {
      table: safeTable,
      recordId: safeId,
      companyId: dry.summary.companyId,
    },
  };
}
