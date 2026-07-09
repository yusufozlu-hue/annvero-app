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
  if (!error) return false;
  // Sütun eksikliği tablo yok sanılmasın (42703 = undefined_column)
  if (error.code === "42703") return false;

  const text = `${error.message || ""} ${error.code || ""}`.toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .* does not exist/i.test(text) ||
    /could not find the table/i.test(text) ||
    /could not find the '.*' table/i.test(text) ||
    /schema cache/i.test(text)
  );
}

/** PostgREST / Supabase hata objesini debug_trace için serialize eder. */
export function serializePostgrestError(error) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
    status: error.status ?? null,
    statusText: error.statusText ?? null,
  };
}

function formatQueryOutcome({ data, error, count } = {}) {
  return {
    ok: !error,
    count: count ?? (Array.isArray(data) ? data.length : null),
    row_count: Array.isArray(data) ? data.length : null,
    data: Array.isArray(data) ? data.slice(0, 5) : data ?? null,
    error: serializePostgrestError(error),
    status: error?.status ?? null,
    statusText: error?.statusText ?? null,
  };
}

/** CORE debug — bağlantı meta (URL, project ref, client tipi). */
export async function getKnowledgeConnectionMeta(context = {}) {
  const env = getKnowledgeEnvDiagnostics();
  const supabaseUrl = readEnvFlag("NEXT_PUBLIC_SUPABASE_URL");
  let projectRef = "unknown";

  try {
    const mod = await import("../../lib/supabase/serverAdmin.js");
    projectRef = mod.extractSupabaseProjectRef(supabaseUrl);
  } catch {
    try {
      const host = new URL(supabaseUrl).hostname;
      const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
      projectRef = match?.[1] || host;
    } catch {
      projectRef = "unknown";
    }
  }

  const supabase = await resolveKnowledgeSupabase(context);
  const hasContextClient = Boolean(context.supabase);

  let clientType = "none";
  if (hasContextClient && supabase && context.supabase === supabase) {
    clientType = "context_service_role";
  } else if (hasContextClient && supabase) {
    clientType = "context_other";
  } else if (supabase) {
    clientType = "service_role_admin";
  } else if (env.hasAnonKey && !env.hasServiceRoleKey) {
    clientType = "anon_fallback_blocked";
  }

  return {
    supabaseUrl,
    projectRef,
    clientType,
    hasContextClient,
    usedContextClient: hasContextClient && context.supabase === supabase,
    clientResolved: Boolean(supabase),
    missingEnv: env.missingEnv,
  };
}

/**
 * knowledge_entities üzerinde gerçek SELECT — debug_trace için.
 */
export async function runKnowledgeEntitiesSelectDiagnostic(context = {}) {
  const connection = await getKnowledgeConnectionMeta(context);
  const supabase = await resolveKnowledgeSupabase(context);

  if (!supabase) {
    return {
      connection,
      queries: null,
      error: serializePostgrestError(
        new Error(connection.missingEnv.length ? `Eksik env: ${connection.missingEnv.join(", ")}` : "Supabase client oluşturulamadı")
      ),
    };
  }

  const table = KNOWLEDGE_TABLES.ENTITIES;

  const [rawHead, pipelineGlobal, relaxedGlobal, bareSample] = await Promise.all([
    supabase.from(table).select("id", { count: "exact", head: true }),
    supabase
      .from(table)
      .select("id, entity_name, is_global, company_id")
      .eq("is_global", true)
      .is("company_id", null)
      .limit(5),
    supabase
      .from(table)
      .select("id, entity_name, is_global, company_id")
      .eq("is_global", true)
      .or("company_id.is.null,company_id.eq.")
      .limit(5),
    supabase.from(table).select("id, entity_name").limit(5),
  ]);

  return {
    connection,
    queries: {
      raw_head_count: formatQueryOutcome(rawHead),
      pipeline_global_filter: formatQueryOutcome(pipelineGlobal),
      relaxed_global_filter: formatQueryOutcome(relaxedGlobal),
      bare_sample: formatQueryOutcome(bareSample),
    },
  };
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
      supabase_error: serializePostgrestError(error),
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
    probeTable(supabase, KNOWLEDGE_TABLES.ENTITIES),
    probeTable(supabase, KNOWLEDGE_TABLES.MATCH_PATTERNS),
    probeTable(supabase, KNOWLEDGE_TABLES.ACCOUNTING_RULES),
    companyId
      ? probeTable(supabase, KNOWLEDGE_TABLES.COMPANY_MEMORY, (q) => q.eq("company_id", companyId))
      : probeTable(supabase, KNOWLEDGE_TABLES.COMPANY_MEMORY),
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

function filterRowsInMemory(rows) {
  return (rows || []).filter((row) => {
    if (!row || typeof row !== "object") return false;
    if (Object.prototype.hasOwnProperty.call(row, "is_active") && row.is_active === false) {
      return false;
    }
    if (
      Object.prototype.hasOwnProperty.call(row, "deleted_at") &&
      row.deleted_at != null &&
      row.deleted_at !== ""
    ) {
      return false;
    }
    return true;
  });
}

async function queryActiveRows(supabase, table, buildQuery) {
  if (!supabase) {
    return {
      data: [],
      error: null,
      queryError: serializePostgrestError(new Error("no_supabase_client")),
      unavailable: true,
      unavailableReason: "no_client",
    };
  }

  // Production şemasında is_active / deleted_at olmayabilir — SQL'de filtreleme yok.
  let query = supabase.from(table).select("*");
  query = buildQuery(query);

  const { data, error } = await query;
  if (error) {
    const queryError = serializePostgrestError(error);
    if (isMissingTableError(error)) {
      return {
        data: [],
        error,
        queryError,
        unavailable: true,
        unavailableReason: "missing_table_or_schema",
      };
    }
    return { data: [], error, queryError, unavailable: false, unavailableReason: null };
  }

  return {
    data: filterRowsInMemory(data),
    error: null,
    queryError: null,
    unavailable: false,
    unavailableReason: null,
  };
}

export async function fetchKnowledgeEntities(supabase, { companyId } = {}) {
  const globalResult = await queryActiveRows(supabase, KNOWLEDGE_TABLES.ENTITIES, (q) =>
    q.eq("is_global", true).or("company_id.is.null,company_id.eq.")
  );

  let companyRows = [];
  if (companyId) {
    const companyResult = await queryActiveRows(supabase, KNOWLEDGE_TABLES.ENTITIES, (q) =>
      q.eq("company_id", companyId)
    );
    companyRows = companyResult.data;
    if (companyResult.unavailable) {
      return {
        entities: [],
        unavailable: true,
        error: companyResult.error,
        queryError: companyResult.queryError,
        unavailableReason: companyResult.unavailableReason,
      };
    }
  }

  return {
    entities: [...companyRows, ...globalResult.data],
    unavailable: globalResult.unavailable,
    error: globalResult.error,
    queryError: globalResult.queryError,
    unavailableReason: globalResult.unavailableReason,
  };
}

export async function fetchKnowledgePatterns(supabase, { companyId, globalOnly = false } = {}) {
  if (globalOnly) {
    return queryActiveRows(supabase, KNOWLEDGE_TABLES.MATCH_PATTERNS, (q) =>
      q.eq("is_global", true).or("company_id.is.null,company_id.eq.")
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
      next = next.eq("is_global", true).or("company_id.is.null,company_id.eq.");
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
function collectUnavailableSources(parts = []) {
  return parts.filter((p) => p?.unavailable);
}

export async function loadKnowledgeBundle(context = {}, companyId = "") {
  const connectionMeta = await getKnowledgeConnectionMeta(context);
  const entitiesDiagnostic = await runKnowledgeEntitiesSelectDiagnostic(context);

  const supabase = await resolveKnowledgeSupabase(context);
  if (!supabase) {
    const dbProbe = await probeKnowledgeDatabase(context, companyId);
    return {
      unavailable: true,
      supabase: null,
      connectionMeta,
      entitiesDiagnostic,
      dbProbe,
      unavailableSources: [{ source: "client", queryError: entitiesDiagnostic.error }],
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

  const unavailableSources = collectUnavailableSources([
    { source: "knowledge_entities", ...entityResult },
    { source: "knowledge_match_patterns_company", ...companyPatternResult },
    { source: "knowledge_match_patterns_global", ...globalPatternResult },
  ]);

  const unavailable = unavailableSources.length > 0;

  const entities = entityResult.entities || [];
  let dbProbe = null;
  if (unavailable || !entities.length) {
    dbProbe = await probeKnowledgeDatabase(context, companyId);
  }

  const entitiesById = new Map(entities.map((row) => [row.id, row]));

  const firstQueryError =
    unavailableSources[0]?.queryError ||
    entityResult.queryError ||
    companyPatternResult.queryError ||
    globalPatternResult.queryError ||
    memoryResult.queryError ||
    null;

  return {
    unavailable,
    supabase,
    connectionMeta,
    entitiesDiagnostic,
    dbProbe,
    unavailableSources: unavailableSources.map((s) => ({
      source: s.source,
      reason: s.unavailableReason,
      error: s.queryError,
    })),
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
      (firstQueryError ? new Error(firstQueryError.message) : null),
    queryError: firstQueryError,
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

function normalizeWriteText(value = "") {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/\s+/g, " ");
}

export async function findGlobalEntityByName(supabase, entityName = "") {
  if (!supabase || !entityName) return null;
  const normalized = normalizeWriteText(entityName);

  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.ENTITIES)
    .select("*")
    .eq("is_global", true)
    .is("deleted_at", null);

  if (error) return null;

  return (
    (data || []).find(
      (row) =>
        row.is_active !== false &&
        (normalizeWriteText(row.entity_name) === normalized ||
          (Array.isArray(row.aliases) &&
            row.aliases.some((alias) => normalizeWriteText(alias) === normalized)))
    ) || null
  );
}

export async function findCompanyMemoryDuplicate(supabase, companyId = "", keyword = "") {
  if (!supabase || !companyId || !keyword) return null;
  const normalized = normalizeWriteText(keyword);

  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.COMPANY_MEMORY)
    .select("*")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  if (error) return null;

  return (
    (data || []).find((row) => {
      const candidates = [row.normalized_description, row.raw_description]
        .map(normalizeWriteText)
        .filter(Boolean);
      return candidates.includes(normalized);
    }) || null
  );
}

export async function findGlobalPatternDuplicate(supabase, entityId = "", keyword = "") {
  if (!supabase || !entityId || !keyword) return null;
  const normalized = normalizeWriteText(keyword);

  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.MATCH_PATTERNS)
    .select("*")
    .eq("entity_id", entityId)
    .eq("pattern_type", "keyword")
    .is("deleted_at", null);

  if (error) return null;

  return (
    (data || []).find(
      (row) =>
        normalizeWriteText(row.normalized_value || row.pattern_value) === normalized
    ) || null
  );
}

export async function findGlobalRuleDuplicate(supabase, entityId = "", sourceType = "bank") {
  if (!supabase || !entityId) return null;

  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.ACCOUNTING_RULES)
    .select("*")
    .eq("entity_id", entityId)
    .eq("source_type", sourceType)
    .is("company_id", null)
    .is("deleted_at", null);

  if (error) return null;

  return (data || [])[0] || null;
}

export async function insertCompanyMemoryRecord(supabase, record = {}) {
  const payload = {
    company_id: record.company_id,
    entity_id: record.entity_id || null,
    raw_description: record.raw_description || "",
    normalized_description:
      record.normalized_description || normalizeWriteText(record.raw_description),
    bank_name: record.bank_name || null,
    transaction_type: record.transaction_type || null,
    suggested_account_code: record.suggested_account_code || null,
    suggested_account_name: record.suggested_account_name || null,
    suggested_counter_account_code: record.suggested_counter_account_code || null,
    suggested_cari: record.suggested_cari || null,
    suggested_document_type: record.suggested_document_type || null,
    suggested_description: record.suggested_description || record.raw_description || "",
    suggested_vat_rate:
      record.suggested_vat_rate == null ? null : Number(record.suggested_vat_rate),
    confidence: Number(record.confidence) || 1,
    learned_from: record.learned_from || "manual",
    is_active: record.is_active !== false,
    created_by: record.created_by || null,
    updated_by: record.updated_by || null,
  };

  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.COMPANY_MEMORY)
    .insert([payload])
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error };
  return { ok: true, record: data };
}

export async function updateCompanyMemoryRecord(supabase, id, patch = {}) {
  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.COMPANY_MEMORY)
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error };
  return { ok: true, record: data };
}

export async function insertKnowledgeEntity(supabase, record = {}) {
  const payload = {
    entity_name: record.entity_name,
    entity_family: record.entity_family || "other",
    entity_type: record.entity_type || "other",
    aliases: Array.isArray(record.aliases) ? record.aliases : [],
    risk_level: record.risk_level || "low",
    default_confidence: Number(record.default_confidence) || 0.8,
    is_global: record.is_global !== false,
    company_id: record.company_id || null,
    is_active: true,
    created_by: record.created_by || null,
    updated_by: record.updated_by || null,
  };

  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.ENTITIES)
    .insert([payload])
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error };
  return { ok: true, record: data };
}

export async function updateKnowledgeEntity(supabase, id, patch = {}) {
  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.ENTITIES)
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error };
  return { ok: true, record: data };
}

export async function insertKnowledgePattern(supabase, record = {}) {
  const payload = {
    entity_id: record.entity_id,
    company_id: record.company_id || null,
    pattern_type: record.pattern_type || "keyword",
    pattern_value: record.pattern_value,
    normalized_value:
      record.normalized_value || normalizeWriteText(record.pattern_value),
    priority: Number(record.priority) || 100,
    confidence: Number(record.confidence) || 0.85,
    is_global: record.is_global !== false,
    is_active: true,
    created_by: record.created_by || null,
    updated_by: record.updated_by || null,
  };

  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.MATCH_PATTERNS)
    .insert([payload])
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error };
  return { ok: true, record: data };
}

export async function updateKnowledgePattern(supabase, id, patch = {}) {
  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.MATCH_PATTERNS)
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error };
  return { ok: true, record: data };
}

export async function insertKnowledgeAccountingRule(supabase, record = {}) {
  const payload = {
    entity_id: record.entity_id,
    company_id: record.company_id || null,
    source_type: record.source_type || "bank",
    transaction_direction: record.transaction_direction || "debit",
    debit_account_code: record.debit_account_code || null,
    debit_account_name: record.debit_account_name || null,
    credit_account_code: record.credit_account_code || null,
    credit_account_name: record.credit_account_name || null,
    vat_rate: record.vat_rate == null ? null : Number(record.vat_rate),
    document_type: record.document_type || null,
    cari_name: record.cari_name || null,
    description_template: record.description_template || null,
    rule_source: record.rule_source || "manual",
    priority: Number(record.priority) || 100,
    confidence: Number(record.confidence) || 0.85,
    risk_level: record.risk_level || "low",
    is_global: record.is_global !== false,
    is_active: true,
    created_by: record.created_by || null,
    updated_by: record.updated_by || null,
  };

  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.ACCOUNTING_RULES)
    .insert([payload])
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error };
  return { ok: true, record: data };
}

export async function updateKnowledgeAccountingRule(supabase, id, patch = {}) {
  const { data, error } = await supabase
    .from(KNOWLEDGE_TABLES.ACCOUNTING_RULES)
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error };
  return { ok: true, record: data };
}
