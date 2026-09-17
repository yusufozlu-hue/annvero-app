/**
 * Learning Memory audit afterState — dar metadata allowlist.
 * Global redactDeep / sanitizeState değiştirilmez; yalnız LM route afterState için.
 */

import { SAFE_LEARNING_MEMORY_COLUMNS } from "@/src/utils/learningMemorySafePayload";

export const LEARNING_MEMORY_AUDIT_SCHEMA_VERSION = 1;

const SAFE_STATUS = Object.freeze(
  new Set(["active", "passive", "deleted", "superseded", "review", "conflict"])
);

const SAFE_DOCUMENT_TYPE = Object.freeze(
  new Set(["DK", "MM", "SM", "BANK_STATEMENT_FORMAT", "BANK_STATEMENT_ACCOUNTING"])
);

const CHANGED_FIELD_ALLOW = Object.freeze(new Set(SAFE_LEARNING_MEMORY_COLUMNS));

function asTrimmedString(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

/**
 * Canonical LM audit afterState.
 * @param {object} record DB sonucu (mutate edilmez)
 * @param {{ companyId?: string, entityId?: string, changedFields?: string[] }} context
 *   companyId / entityId server-derived; changedFields yalnız alan adları
 */
export function buildLearningMemoryAuditState(record = {}, context = {}) {
  try {
    const out = {
      schemaVersion: LEARNING_MEMORY_AUDIT_SCHEMA_VERSION,
    };

    const entityId = asTrimmedString(context.entityId ?? record?.id);
    if (entityId) out.entityId = entityId;

    // Tenant scope yalnız context'ten — record.company_id istemci/DB karışımı authority sayılmaz
    const companyId = asTrimmedString(context.companyId);
    if (companyId) out.companyId = companyId;

    const status = asTrimmedString(record?.status).toLowerCase();
    if (SAFE_STATUS.has(status)) out.status = status;

    const documentType = asTrimmedString(
      record?.document_type ?? record?.documentType
    ).toUpperCase();
    if (SAFE_DOCUMENT_TYPE.has(documentType)) out.documentType = documentType;

    const sourceModule = asTrimmedString(record?.source_module ?? record?.sourceModule);
    if (sourceModule && sourceModule.length <= 64 && /^[A-Za-z0-9._:\-]+$/.test(sourceModule)) {
      out.sourceModule = sourceModule;
    }

    if (Array.isArray(context.changedFields)) {
      const fields = [
        ...new Set(
          context.changedFields
            .map((name) => asTrimmedString(name))
            .filter((name) => CHANGED_FIELD_ALLOW.has(name))
        ),
      ].sort((a, b) => a.localeCompare(b));
      if (fields.length > 0) out.changedFields = fields;
    }

    return out;
  } catch {
    return { schemaVersion: LEARNING_MEMORY_AUDIT_SCHEMA_VERSION };
  }
}
