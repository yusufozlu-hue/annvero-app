/**
 * Staging/production-safe probe: MARE hesap planı sayıları (1000 cap doğrulama).
 * Müşteri dosyası yüklemez / silmez.
 *
 * Env (staging): NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * Opsiyonel: ANNVERO_PROBE_COMPANY_ID (default MARE staging id)
 *
 * Run:
 *   node --env-file=../annvero-app/.env.staging.local --import ./scripts/_alias-loader.mjs ./scripts/probe-account-plan-counts.mjs
 */
import { createClient } from "@supabase/supabase-js";
import {
  countAccountsForUpload,
  loadAllAccountsForUpload,
  queryAccountsPage,
} from "@/src/utils/accountPlanQuery.js";

const UPLOADS = "company_account_plan_uploads";
const ACCOUNTS = "company_account_plan_accounts";
const DEFAULT_MARE = "84384297-270c-47cd-ac5a-d693ba80b84a";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const companyId = process.env.ANNVERO_PROBE_COMPANY_ID || DEFAULT_MARE;

if (!url || !key) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "MISSING_ENV",
      need: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    })
  );
  process.exit(2);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: active, error: aErr } = await supabase
  .from(UPLOADS)
  .select(
    "id, file_name, total_rows, status, is_active, archive_status, file_content_hash, original_file_name, created_at"
  )
  .eq("company_id", companyId)
  .eq("is_active", true)
  .is("deleted_at", null)
  .maybeSingle();

if (aErr) {
  console.error(JSON.stringify({ ok: false, error: aErr.message }));
  process.exit(1);
}

if (!active) {
  console.log(JSON.stringify({ ok: true, companyId, active: null, message: "no active upload" }));
  process.exit(0);
}

const counts = await countAccountsForUpload(
  supabase,
  ACCOUNTS,
  companyId,
  active.id
);
const all = await loadAllAccountsForUpload(
  supabase,
  ACCOUNTS,
  companyId,
  active.id
);
const pageBeyond = await queryAccountsPage(supabase, ACCOUNTS, {
  companyId,
  uploadId: active.id,
  page: 21,
  pageSize: 50,
  query: "",
});

// Search for an account that would sit beyond first 1000 by code order
const beyondCode = all.length > 1000 ? all[1500]?.account_code : all[all.length - 1]?.account_code;
const search = beyondCode
  ? await queryAccountsPage(supabase, ACCOUNTS, {
      companyId,
      uploadId: active.id,
      page: 1,
      pageSize: 10,
      query: beyondCode,
    })
  : { total: 0, rows: [] };

const { data: history } = await supabase
  .from(UPLOADS)
  .select("id, file_name, total_rows, status, is_active, archive_status, created_at")
  .eq("company_id", companyId)
  .is("deleted_at", null)
  .order("created_at", { ascending: false })
  .limit(10);

const result = {
  ok: true,
  companyId,
  activeUpload: {
    id: active.id,
    fileName: active.file_name,
    totalRowsClaimed: active.total_rows,
    archiveStatus: active.archive_status || "none",
  },
  realCounts: counts,
  fullFetchLength: all.length,
  beyond1000: all.length > 1000,
  page21RowCount: pageBeyond.rows.length,
  searchBeyondFirst1000: {
    query: beyondCode || null,
    hits: search.total,
    matched: Boolean(search.rows?.length),
  },
  historySample: (history || []).map((h) => ({
    fileName: h.file_name,
    totalRows: h.total_rows,
    status: h.status,
    isActive: h.is_active,
    archiveStatus: h.archive_status || "none",
  })),
  pass:
    counts.total === all.length &&
    counts.total > 1000 &&
    counts.total === Number(active.total_rows) &&
    Boolean(search.rows?.length),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
