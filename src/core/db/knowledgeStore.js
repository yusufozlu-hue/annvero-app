/**
 * Knowledge Engine DB erişimi — service_role, server-only.
 */

import { KNOWLEDGE_TABLES } from "../../lib/knowledge-engine/constants.js";

let adminClientPromise = null;

export function getKnowledgeSupabase(context = {}) {
  return context.supabase || null;
}

/** Next.js API — service_role client (Node script'lerde context.supabase kullanın). */
export async function resolveKnowledgeSupabase(context = {}) {
  if (context.supabase) return context.supabase;

  if (!adminClientPromise) {
    adminClientPromise = import("../../lib/supabase/serverAdmin.js")
      .then((mod) => {
        const client = mod.getServerSupabaseAdmin({ requireServiceRole: true });
        if (!client) {
          console.error("[annvero-core] SUPABASE_SERVICE_ROLE_KEY eksik — Knowledge DB kullanılamaz");
        }
        return client;
      })
      .catch((error) => {
        console.error("[annvero-core] serverAdmin import failed", error?.message || error);
        return null;
      });
  }

  return adminClientPromise;
}

function isMissingTableError(error) {
  const text = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /does not exist/i.test(text) ||
    /could not find/i.test(text) ||
    /schema cache/i.test(text)
  );
}

function readEnvFlag(name) {
  return String(process.env[name] ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

/** Tanı — hangi env eksik, client tipi (log/health endpoint). */
export function getKnowledgeEnvDiagnostics() {
  const url = readEnvFlag("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRole = readEnvFlag("SUPABASE_SERVICE_ROLE_KEY");
  const anon = readEnvFlag("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const missing = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRole) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  return {
    hasSupabaseUrl: Boolean(url),
    hasServiceRoleKey: Boolean(serviceRole),
    hasAnonKey: Boolean(anon),
    missingEnv: missing,
    recommendedClient: "service_role (SUPABASE_SERVICE_ROLE_KEY)",
  };
}

async function probeTable(supabase, table, buildQuery) {
  if (!supabase) {
    return { ok: false, count: 0, error: "no_client", clientType: "none" };
  }

  let query = supabase.from(table).select("id", { count: "exact", head: true });
  if (buildQuery) query = buildQuery(query);

  const { count, error } = await query;

  if (error) {
    return {
      ok: false,
      count: 0,
      error: error.message || String(error),
      code: error.code || null,
      hint: isMissingTableError(error) ? "table_or_schema_cache_missing" : "query_failed",
    };
  }

  return { ok: true, count: count ?? 0, error: null };
}

/**
 * Knowledge Engine tablolarına basit SELECT probe (health / debug).
 */
export async function probeKnowledgeDatabase(context = {}, companyId = "") {
  const env = getKnowledgeEnvDiagnostics();
  const supabase = await resolveKnowledgeSupabase(context);
  const clientType = context.supabase
    ? "context_service_role"
    : supabase
      ? "service_role_admin"
      : "none";

  if (!supabase) {
    return {
      ok: false,
      clientType,
      env,
      reason:
        env.missingEnv.length > 0
          ? `Eksik env: ${env.missingEnv.join(", ")}`
          : "Supabase service_role client oluşturulamadı",
      tables: {},
    };
  }

  const [entities, patterns, rules, memory] = await Promise.all([
    probeTable(supabase, KNOWLEDGE_TABLES.ENTITIES, (q) =>
      q.eq("is_active", true).is("deleted_at", null)
    ),
    probeTable(supabase, KNOWLEDGE_TABLES.MATCH_PATTERNS, (q) =>
      q.eq("is_active", true).is("deleted_at", null)
    ),
    probeTable(supabase, KNOWLEDGE_TABLES.ACCOUNTING_RULES, (q) =>
      q.eq("is_active", true).is("deleted_at", null)
    ),
    companyId
      ? probeTable(supabase, KNOWLEDGE_TABLES.COMPANY_MEMORY, (q) =>
          q.eq("company_id", companyId).eq("is_active", true).is("deleted_at", null)
        )
      : probeTable(supabase, KNOWLEDGE_TABLES.COMPANY_MEMORY, (q) =>
          q.eq("is_active", true).is("deleted_at", null)
        ),
  ]);

  const tables = {
    knowledge_entities: entities,
    knowledge_match_patterns: patterns,
    knowledge_accounting_rules: rules,
    knowledge_company_memory: memory,
  };

  const tableErrors = Object.entries(tables).filter(([, v]) => !v.ok);
  const ok = tableErrors.length === 0;

  let reason = null;
  if (!ok) {
    const first = tableErrors[0];
    reason = `${first[0]}: ${first[1].error} (${first[1].hint || first[1].code || "error"})`;
    if (first[1].hint === "table_or_schema_cache_missing") {
      reason += " — migration 017_knowledge_engine.sql çalıştırılmamış olabilir";
    }
  }

  if (process.env.NODE_ENV === "development" || process.env.ANNVERO_CORE_DB_PROBE_LOG === "1") {
    console.info("[annvero-core:knowledge-db-probe]", {
      clientType,
      env: env.missingEnv,
      entities: entities.count,
      patterns: patterns.count,
      rules: rules.count,
      memory: memory.count,
      ok,
      reason,
    });
  }

  return { ok, clientType, env, reason, tables };
}

async function queryActiveRows(supabase, table, buildQuery) {
  if (!supabase) return { data: [], error: null, unavailable: true };

  let query = supabase.from(table).select("*").eq("is_active", true).is("deleted_at", null);
  query = buildQuery(query);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      return { data: [], error: null, unavailable: true };
    }
    return { data: [], error, unavailable: false };
  }

  return { data: data || [], error: null, unavailable: false };
}

export async function fetchKnowledgeEntities(supabase, { companyId } = {}) {
  const globalResult = await queryActiveRows(supabase, KNOWLEDGE_TABLES.ENTITIES, (q) =>
    q.eq("is_global", true).is("company_id", null)
  );

  let companyRows = [];
  if (companyId) {
    const companyResult = await queryActiveRows(supabase, KNOWLEDGE_TABLES.ENTITIES, (q) =>
      q.eq("company_id", companyId)
    );
    companyRows = companyResult.data;
    if (companyResult.unavailable) return { entities: [], unavailable: true, error: companyResult.error };
  }

  return {
    entities: [...companyRows, ...globalResult.data],
    unavailable: globalResult.unavailable,
    error: globalResult.error,
  };
}

export async function fetchKnowledgePatterns(supabase, { companyId, globalOnly = false } = {}) {
  if (globalOnly) {
    return queryActiveRows(supabase, KNOWLEDGE_TABLES.MATCH_PATTERNS, (q) =>
      q.eq("is_global", true).is("company_id", null)
    );
  }

  if (!companyId) {
    return { data: [], error: null, unavailable: false };
  }

  return queryActiveRows(supabase, KNOWLEDGE_TABLES.MATCH_PATTERNS, (q) =>
    q.eq("company_id", companyId)
  );
}

export async function fetchCompanyMemoryRecords(supabase, companyId) {
  if (!companyId) return { data: [], error: null, unavailable: false };

  return queryActiveRows(supabase, KNOWLEDGE_TABLES.COMPANY_MEMORY, (q) =>
    q.eq("company_id", companyId).order("use_count", { ascending: false })
  );
}

export async function fetchAccountingRules(supabase, { companyId, entityId, globalOnly = false } = {}) {
  const applyFilters = (q) => {
    let next = q;
    if (globalOnly) {
      next = next.eq("is_global", true).is("company_id", null);
    } else if (companyId) {
      next = next.eq("company_id", companyId);
    }
    if (entityId) next = next.eq("entity_id", entityId);
    return next.order("priority", { ascending: true });
  };

  return queryActiveRows(supabase, KNOWLEDGE_TABLES.ACCOUNTING_RULES, applyFilters);
}

/**
 * Tek istekte CORE pipeline için knowledge paketi yükler.
 */
export async function loadKnowledgeBundle(context = {}, companyId = "") {
  const supabase = await resolveKnowledgeSupabase(context);
  if (!supabase) {
    const dbProbe = await probeKnowledgeDatabase(context, companyId);
    return {
      unavailable: true,
      supabase: null,
      dbProbe,
      entities: [],
      companyPatterns: [],
      globalPatterns: [],
      companyMemory: [],
      companyRules: [],
      globalRules: [],
      entitiesById: new Map(),
      error: new Error(dbProbe.reason || "Supabase service role unavailable"),
    };
  }

  const [
    entityResult,
    companyPatternResult,
    globalPatternResult,
    memoryResult,
    companyRuleResult,
    globalRuleResult,
  ] = await Promise.all([
    fetchKnowledgeEntities(supabase, { companyId }),
    fetchKnowledgePatterns(supabase, { companyId }),
    fetchKnowledgePatterns(supabase, { globalOnly: true }),
    fetchCompanyMemoryRecords(supabase, companyId),
    fetchAccountingRules(supabase, { companyId }),
    fetchAccountingRules(supabase, { globalOnly: true }),
  ]);

  const unavailable =
    entityResult.unavailable ||
    companyPatternResult.unavailable ||
    globalPatternResult.unavailable;

  const entities = entityResult.entities || [];
  let dbProbe = null;
  if (unavailable || !entities.length) {
    dbProbe = await probeKnowledgeDatabase(context, companyId);
  }

  const entitiesById = new Map(entities.map((row) => [row.id, row]));

  return {
    unavailable,
    supabase,
    dbProbe,
    entities,
    entitiesById,
    companyPatterns: companyPatternResult.data || [],
    globalPatterns: globalPatternResult.data || [],
    companyMemory: memoryResult.data || [],
    companyRules: companyRuleResult.data || [],
    globalRules: globalRuleResult.data || [],
    error:
      entityResult.error ||
      companyPatternResult.error ||
      globalPatternResult.error ||
      memoryResult.error ||
      null,
  };
}

export async function insertDecisionHistory(supabase, record = {}) {
  if (!supabase) return { ok: false, skipped: true };

  const payload = {
    company_id: record.company_id || "",
    source_type: record.source_type || "",
    source_record_id: record.source_record_id || "",
    raw_input: record.raw_input || {},
    matched_entity_id: record.matched_entity_id || null,
    matched_pattern_id: record.matched_pattern_id || null,
    matched_rule_id: record.matched_rule_id || null,
    decision_source: record.decision_source || "unknown",
    decision_status: record.decision_status || "unknown",
    confidence: Number(record.confidence) || 0,
    suggested_result: record.suggested_result || {},
    risk_flags: record.risk_flags || [],
    created_by: record.created_by || null,
  };

  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.DECISION_HISTORY)
    .insert([payload])
    .select("id")
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return { ok: false, skipped: true };
    return { ok: false, error };
  }

  return { ok: true, id: data?.id || null };
}
