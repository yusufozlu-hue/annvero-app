/**
 * Firma bazlı DB export — Güvenlik Faz 2.
 */

import {
  GIB_CREDENTIALS_TABLE,
  GIB_QUERY_SESSIONS_TABLE,
  GIB_QUERY_STATE_TABLE,
} from "@/src/lib/supabase/gibSupabase";

export const COMPANY_EXPORT_VERSION = 2;

/** Zorunlu export tabloları */
export const COMPANY_EXPORT_TABLE_SPECS = [
  { key: "companies", table: "companies", scope: "id" },
  { key: "learning_memory", table: "learning_memory", scope: "company_id" },
  { key: "learned_bank_rules", table: "learned_bank_rules", scope: "company_id" },
  {
    key: "normalized_financial_transactions",
    table: "normalized_financial_transactions",
    scope: "company_id",
  },
  { key: "reconciliation_matches", table: "reconciliation_matches", scope: "company_id" },
  { key: "audit_events", table: "audit_events", scope: "company_id" },
  { key: "official_notifications", table: "official_notifications", scope: "company_id" },
];

/** GİB tebligat — tablo yoksa atlanır */
export const COMPANY_EXPORT_GIB_TABLE_SPECS = [
  { key: "company_gib_credentials", table: GIB_CREDENTIALS_TABLE, scope: "company_id" },
  { key: "gib_company_query_state", table: GIB_QUERY_STATE_TABLE, scope: "company_id" },
  { key: "gib_query_sessions", table: GIB_QUERY_SESSIONS_TABLE, scope: "company_id" },
  { key: "gib_check_reminders", table: "gib_check_reminders", scope: "company_id" },
];

function resolveCompanyDisplayName(companyRow = {}) {
  const data = companyRow.data || {};
  return (
    data.name ||
    data.companyName ||
    data.firmaAdi ||
    data.title ||
    companyRow.name ||
    companyRow.id ||
    ""
  );
}

async function tableExists(supabase, tableName) {
  const { error } = await supabase.from(tableName).select("*", { head: true, count: "exact" }).limit(0);
  if (!error) return true;
  const message = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return !(
    error.code === "42P01" ||
    /does not exist/i.test(message) ||
    /could not find/i.test(message)
  );
}

async function exportTableRows(supabase, spec, companyId) {
  let query = supabase.from(spec.table).select("*");

  if (spec.scope === "id") {
    query = query.eq("id", companyId);
  } else {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query;
  if (error) {
    return { rows: [], error: error.message };
  }

  return { rows: data || [], error: null };
}

/**
 * Firma bazlı JSON export envelope üretir.
 */
export async function buildCompanyExportEnvelope(supabase, { companyId, actor = {} }) {
  const metadata = {
    skipped_tables: [],
    table_errors: {},
    row_counts: {},
  };

  const tables = {};
  const allSpecs = [...COMPANY_EXPORT_TABLE_SPECS, ...COMPANY_EXPORT_GIB_TABLE_SPECS];

  const { data: companyRow, error: companyError } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) {
    throw new Error(companyError.message || "Firma kaydı okunamadı.");
  }

  if (!companyRow) {
    throw new Error("Firma bulunamadı.");
  }

  tables.companies = [companyRow];
  metadata.row_counts.companies = 1;

  for (const spec of allSpecs) {
    if (spec.key === "companies") continue;

    const exists = await tableExists(supabase, spec.table);
    if (!exists) {
      metadata.skipped_tables.push(spec.table);
      continue;
    }

    const { rows, error } = await exportTableRows(supabase, spec, companyId);
    if (error) {
      metadata.table_errors[spec.key] = error;
      tables[spec.key] = [];
      metadata.row_counts[spec.key] = 0;
      continue;
    }

    tables[spec.key] = rows;
    metadata.row_counts[spec.key] = rows.length;
  }

  return {
    version: COMPANY_EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    company_id: companyId,
    company_name: resolveCompanyDisplayName(companyRow),
    exported_by: String(actor.email || actor.actorEmail || "").trim().toLowerCase(),
    tables,
    metadata,
  };
}
