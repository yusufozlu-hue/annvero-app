/**
 * Soft delete recovery listeleme — Güvenlik Faz 2 (geri yükleme yok).
 */

import { SOFT_DELETE_TABLES } from "@/src/lib/softDelete";
import {
  applyCompanyIdScopeToQuery,
  applyCompanyScopeToQuery,
} from "@/src/lib/auth/apiGuard";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export const RECOVERY_TABLE_SPECS = SOFT_DELETE_TABLES.map((table) => ({
  key: table,
  table,
  scope: table === "companies" ? "id" : "company_id",
}));

async function tableExists(supabase, tableName) {
  const { error } = await supabase.from(tableName).select("id", { head: true, count: "exact" }).limit(0);
  if (!error) return true;
  const message = `${error.message || ""}`.toLowerCase();
  return !(/does not exist/i.test(message) || /could not find/i.test(message));
}

function applyRecoveryScope(query, access, companyId, scope) {
  if (scope === "id") {
    return applyCompanyIdScopeToQuery(query, access, companyId);
  }
  return applyCompanyScopeToQuery(query, access, companyId);
}

/**
 * Soft delete yapılmış kayıtları listeler.
 */
export async function listDeletedRecords(supabase, access, options = {}) {
  const companyId = String(options.companyId || "").trim();
  const tableFilter = String(options.table || "").trim();
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(options.limit) || DEFAULT_LIMIT)
  );

  const specs = tableFilter
    ? RECOVERY_TABLE_SPECS.filter((spec) => spec.key === tableFilter)
    : RECOVERY_TABLE_SPECS;

  if (tableFilter && !specs.length) {
    return {
      data: {},
      meta: {
        error: `Geçersiz tablo: ${tableFilter}`,
        tables_queried: [],
        skipped_tables: [],
        total: 0,
      },
    };
  }

  const data = {};
  const skippedTables = [];
  const tablesQueried = [];
  let total = 0;

  for (const spec of specs) {
    const exists = await tableExists(supabase, spec.table);
    if (!exists) {
      skippedTables.push(spec.table);
      continue;
    }

    let query = supabase
      .from(spec.table)
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(limit);

    const scoped = applyRecoveryScope(query, access, companyId, spec.scope);
    if (!scoped) {
      data[spec.key] = [];
      tablesQueried.push(spec.key);
      continue;
    }

    const { data: rows, error } = await scoped;

    if (error) {
      const message = `${error.message || ""}`.toLowerCase();
      if (/deleted_at/i.test(message) || /column/i.test(message)) {
        skippedTables.push(spec.table);
        continue;
      }
      data[spec.key] = [];
      data[`${spec.key}_error`] = error.message;
    } else {
      data[spec.key] = rows || [];
      total += (rows || []).length;
    }

    tablesQueried.push(spec.key);
  }

  return {
    data,
    meta: {
      company_id: companyId || null,
      table_filter: tableFilter || null,
      limit,
      tables_queried: tablesQueried,
      skipped_tables: skippedTables,
      total,
    },
  };
}
