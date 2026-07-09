/**
 * ANNVERO merkezi audit log — altyapı (Güvenlik Faz 1).
 * Modüller kademeli olarak bu servisi çağıracak.
 */

import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";

export const AUDIT_ENTITY_TYPES = {
  COMPANY: "company",
  COMPANY_BACKUP: "company_backup",
  LEARNING_MEMORY: "learning_memory",
  RULE_ENGINE: "rule_engine",
  ACCOUNT_PLAN: "account_plan",
  BANK_TRANSACTION: "bank_transaction",
  UNRECOGNIZED_TRANSACTION: "unrecognized_transaction",
  USER_PROFILE: "user_profile",
  GIB_CREDENTIALS: "gib_credentials",
  OFFICIAL_NOTIFICATION: "official_notification",
};

export const AUDIT_ACTIONS = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  SOFT_DELETE: "soft_delete",
  RESTORE: "restore",
  EXPORT: "export",
  IMPORT: "import",
  LOGIN: "login",
};

export const AUDIT_EVENTS_TABLE = "audit_events";

function sanitizeState(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { value: String(value) };
  }
}

/**
 * Audit kaydı yazar (service_role). Hata olursa ana işlemi bozmaz.
 */
export async function writeAuditEvent(partial = {}) {
  const guard = getServerSupabaseAdminGuardResponse("audit:write", AUDIT_EVENTS_TABLE);
  if (guard) {
    console.warn("[audit] service role unavailable, event skipped");
    return { ok: false, skipped: true };
  }

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  if (!supabase) {
    return { ok: false, skipped: true };
  }

  const payload = {
    actor_id: String(partial.actorId || partial.actor_id || "").trim(),
    actor_email: String(partial.actorEmail || partial.actor_email || "")
      .trim()
      .toLowerCase(),
    company_id: String(partial.companyId || partial.company_id || "").trim(),
    entity_type: String(partial.entityType || partial.entity_type || "unknown").trim(),
    entity_id: String(partial.entityId || partial.entity_id || "").trim(),
    action: String(partial.action || "update").trim(),
    before_state: sanitizeState(partial.beforeState ?? partial.before_state),
    after_state: sanitizeState(partial.afterState ?? partial.after_state),
    metadata: sanitizeState(partial.metadata) || {},
    ip_address: partial.ipAddress || partial.ip_address || null,
    user_agent: partial.userAgent || partial.user_agent || null,
  };

  const { data, error } = await supabase
    .from(AUDIT_EVENTS_TABLE)
    .insert([payload])
    .select("id")
    .maybeSingle();

  if (error) {
    logSupabaseQueryError("audit:write", error, AUDIT_EVENTS_TABLE);
    return { ok: false, error };
  }

  return { ok: true, id: data?.id || null };
}

/** Request + session bağlamından audit payload üretir */
export function buildAuditContextFromRequest(request, session = {}) {
  const headers = request?.headers;
  return {
    actorId: session.user?.id || "",
    actorEmail: session.user?.email || session.profile?.email || "",
    ipAddress: headers?.get?.("x-forwarded-for")?.split(",")?.[0]?.trim() || "",
    userAgent: headers?.get?.("user-agent") || "",
  };
}
