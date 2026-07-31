/**
 * Hesap planı Supabase okuma yardımcıları.
 * PostgREST varsayılan max-rows=1000 — tüm satırlar .range() ile sayfalanır.
 */

export const ACCOUNT_PLAN_PAGE_CHUNK = 1000;
export const ACCOUNT_PLAN_UI_MAX_PAGE_SIZE = 200;

const ACCOUNT_COLUMNS =
  "id, company_id, upload_id, account_code, account_name, currency, is_active";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} table
 * @param {(q: any) => any} applyFilters
 * @param {{ chunkSize?: number, orderBy?: string, ascending?: boolean }} [options]
 */
export async function fetchAllSupabaseRows(
  supabase,
  table,
  applyFilters,
  { chunkSize = ACCOUNT_PLAN_PAGE_CHUNK, orderBy = "account_code", ascending = true } = {}
) {
  const size = Math.max(1, Math.min(1000, Number(chunkSize) || ACCOUNT_PLAN_PAGE_CHUNK));
  const all = [];
  let from = 0;
  for (;;) {
    let query = supabase.from(table).select(ACCOUNT_COLUMNS);
    query = applyFilters(query);
    if (orderBy) query = query.order(orderBy, { ascending });
    const to = from + size - 1;
    const { data, error } = await query.range(from, to);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < size) break;
    from += size;
  }
  return all;
}

export async function loadAllAccountsForUpload(supabase, table, companyId, uploadId) {
  return fetchAllSupabaseRows(supabase, table, (q) =>
    q
      .eq("company_id", companyId)
      .eq("upload_id", uploadId)
      .is("deleted_at", null)
  );
}

/**
 * Exact counts — truncated page length kullanılmaz.
 */
export async function countAccountsForUpload(supabase, table, companyId, uploadId) {
  const base = () =>
    supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("upload_id", uploadId)
      .is("deleted_at", null);

  const [{ count: total, error: tErr }, { count: active, error: aErr }] =
    await Promise.all([
      base(),
      base().eq("is_active", true),
    ]);
  if (tErr) throw tErr;
  if (aErr) throw aErr;
  const totalCount = Number(total) || 0;
  const activeCount = Number(active) || 0;
  return {
    total: totalCount,
    activeCount,
    inactiveCount: Math.max(0, totalCount - activeCount),
  };
}

/**
 * Sunucu tarafı arama + sayfalama (DOM’a binlerce satır basılmaz).
 */
export async function queryAccountsPage(
  supabase,
  table,
  { companyId, uploadId, page = 1, pageSize = 50, query = "" } = {}
) {
  const size = Math.min(
    ACCOUNT_PLAN_UI_MAX_PAGE_SIZE,
    Math.max(10, Number(pageSize) || 50)
  );
  const q = String(query || "").trim();

  const applySearch = (builder) => {
    let b = builder
      .eq("company_id", companyId)
      .eq("upload_id", uploadId)
      .is("deleted_at", null);
    if (q) {
      const escaped = q.replace(/[%_,]/g, "");
      if (escaped) {
        b = b.or(
          `account_code.ilike.%${escaped}%,account_name.ilike.%${escaped}%`
        );
      }
    }
    return b;
  };

  const countQuery = applySearch(
    supabase.from(table).select("id", { count: "exact", head: true })
  );
  const { count: filteredTotal, error: cErr } = await countQuery;
  if (cErr) throw cErr;

  const total = Number(filteredTotal) || 0;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(pageCount, Math.max(1, Number(page) || 1));
  const from = (safePage - 1) * size;
  const to = from + size - 1;

  let dataQuery = applySearch(supabase.from(table).select(ACCOUNT_COLUMNS));
  dataQuery = dataQuery.order("account_code", { ascending: true }).range(from, to);
  const { data, error } = await dataQuery;
  if (error) throw error;

  const rows = data || [];
  const activeCount = rows.filter((r) => r.is_active !== false).length;

  return {
    rows,
    total,
    page: safePage,
    pageSize: size,
    pageCount,
    /** Sayfa dilimindeki aktif — UI rozetleri planCounts kullanmalı */
    pageActiveCount: activeCount,
  };
}
