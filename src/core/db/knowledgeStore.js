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
      .then((mod) => mod.getServerSupabaseAdmin({ requireServiceRole: true }))
      .catch(() => null);
  }

  return adminClientPromise;
}

function isMissingTableError(error) {
  const text = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    /does not exist/i.test(text) ||
    /could not find/i.test(text)
  );
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
    return {
      unavailable: true,
      entities: [],
      companyPatterns: [],
      globalPatterns: [],
      companyMemory: [],
      companyRules: [],
      globalRules: [],
      entitiesById: new Map(),
      error: new Error("Supabase service role unavailable"),
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
  const entitiesById = new Map(entities.map((row) => [row.id, row]));

  return {
    unavailable,
    supabase,
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
