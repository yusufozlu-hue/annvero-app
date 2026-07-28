/**
 * Idempotent production merge for AYSU duplicate (decision B).
 * Default: dry-run. Execute: --execute
 *
 * Never hard-deletes companies or Drive folders.
 * Masks identifiers in stdout.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  choosePrimaryCompany,
  classifyDuplicatePair,
  rehearseCompanyMerge,
} from "../src/utils/companyDuplicateMerge.js";

function loadEnvFile(p) {
  try {
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // ignore
  }
}

loadEnvFile(resolve(process.cwd(), "../annvero-app/.env.local"));
loadEnvFile(resolve(process.cwd(), ".env.local"));

const EXECUTE = process.argv.includes("--execute");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function projectRefFromUrl(u) {
  try {
    return new URL(u).hostname.split(".")[0] || "(unknown)";
  } catch {
    return "(invalid)";
  }
}

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function maskVkn(v) {
  const d = digitsOnly(v);
  if (!d) return "(empty)";
  return `******${d.slice(-4)}`;
}

function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr");
}

function jsonCounts(data = {}) {
  return {
    bankAccounts: Array.isArray(data.bankAccounts) ? data.bankAccounts.length : 0,
    creditCards: Array.isArray(data.creditCards) ? data.creditCards.length : 0,
    employees: Array.isArray(data.employees) ? data.employees.length : 0,
    vehicles: Array.isArray(data.vehicles) ? data.vehicles.length : 0,
    documentSeriesRules: Array.isArray(data.documentSeriesRules)
      ? data.documentSeriesRules.length
      : 0,
    contacts: Array.isArray(data.contacts) ? data.contacts.length : 0,
  };
}

if (!url || !key) {
  console.log(JSON.stringify({ ok: false, error: "missing_credentials" }));
  process.exit(2);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const projectRef = projectRefFromUrl(url);

const { data: companies, error } = await supabase
  .from("companies")
  .select("id, company_name, data, created_at, updated_at");
if (error) {
  console.log(JSON.stringify({ ok: false, error: "companies_query_failed" }));
  process.exit(1);
}

const aysu = (companies || []).filter((c) => {
  const n = normalizeName(c.company_name || c.data?.companyName || "");
  return n.includes("aysu") && (n.includes("dis") || n.includes("dış") || n.includes("ticaret"));
});

if (aysu.length !== 2) {
  console.log(
    JSON.stringify({
      ok: false,
      projectRef,
      error: "unexpected_aysu_count",
      count: aysu.length,
    })
  );
  process.exit(1);
}

async function enrich(row) {
  const id = String(row.id);
  const relatedTables = [
    "learning_memory",
    "company_cloud_folders",
    "document_index",
    "document_sync_events",
    "annvero_company_members",
    "official_notifications",
    "reconciliation_matches",
    "normalized_financial_transactions",
    "unrecognized_transactions",
    "audit_events",
  ];
  let related_total = 0;
  const related = {};
  for (const table of relatedTables) {
    const { count, error: cErr } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("company_id", id);
    related[table] = cErr ? { error: true } : { count: count || 0 };
    if (!cErr) related_total += count || 0;
  }
  const { data: folder } = await supabase
    .from("company_cloud_folders")
    .select("company_id,root_folder_id,connection_id")
    .eq("company_id", id)
    .maybeSingle();

  return {
    ...row,
    company_id: id,
    vkn_masked: maskVkn(row.data?.taxNumber || row.data?.vkn),
    mersis_masked: "(empty)",
    json_counts: jsonCounts(row.data || {}),
    related,
    related_total,
    has_drive_binding: Boolean(folder?.root_folder_id),
    folder: folder || null,
  };
}

const [rawA, rawB] = aysu;
const a = await enrich(rawA);
const b = await enrich(rawB);
const decision = classifyDuplicatePair(a, b);

if (decision.decision !== "B") {
  console.log(
    JSON.stringify({
      ok: false,
      projectRef,
      decision,
      message: "Production write blocked — not definitive B",
      a: { id: a.company_id, vkn: a.vkn_masked },
      b: { id: b.company_id, vkn: b.vkn_masked },
    })
  );
  process.exit(1);
}

const primary = choosePrimaryCompany(a, b);
const duplicate = primary.company_id === a.company_id ? b : a;

// Collect learning_memory ids to move
const { data: memRows } = await supabase
  .from("learning_memory")
  .select("id")
  .eq("company_id", duplicate.company_id);

const plan = rehearseCompanyMerge({
  primary: { id: primary.company_id, data: primary.data || {} },
  duplicate: { id: duplicate.company_id, data: duplicate.data || {} },
  relatedMoves: {
    learning_memory: (memRows || []).map((r) => r.id),
  },
  primaryFolder: primary.folder,
  duplicateFolder: duplicate.folder,
});

const summary = {
  ok: true,
  projectRef,
  mode: EXECUTE ? "execute" : "dry-run",
  decision,
  primary_id: primary.company_id,
  duplicate_id: duplicate.company_id,
  vkn_masked: primary.vkn_masked,
  moved_planned: plan.moved,
  drive_note: plan.driveNote,
  primary_weight: {
    related_total: primary.related_total,
    json_counts: primary.json_counts,
  },
  duplicate_weight: {
    related_total: duplicate.related_total,
    json_counts: duplicate.json_counts,
  },
};

if (!EXECUTE) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

// Idempotent execute
// 1) If duplicate already soft-deactivated pointing to primary → noop success
const dupFresh = duplicate.data || {};
if (
  dupFresh.isActive === false &&
  String(dupFresh.duplicate_of || "") === String(primary.company_id)
) {
  console.log(
    JSON.stringify({ ...summary, already_applied: true }, null, 2)
  );
  process.exit(0);
}

// 2) Move learning_memory rows
if ((memRows || []).length > 0) {
  const { error: moveErr } = await supabase
    .from("learning_memory")
    .update({ company_id: primary.company_id, updated_at: new Date().toISOString() })
    .eq("company_id", duplicate.company_id);
  if (moveErr) {
    console.log(
      JSON.stringify({ ok: false, error: "learning_memory_move_failed" })
    );
    process.exit(1);
  }
}

// 3) Merge JSON into primary (prefer non-empty)
const { error: primaryErr } = await supabase
  .from("companies")
  .update({
    data: plan.primaryData,
    updated_at: new Date().toISOString(),
  })
  .eq("id", primary.company_id);
if (primaryErr) {
  console.log(JSON.stringify({ ok: false, error: "primary_update_failed" }));
  process.exit(1);
}

// 4) Soft-deactivate duplicate
const { error: dupErr } = await supabase
  .from("companies")
  .update({
    data: plan.duplicateData,
    updated_at: new Date().toISOString(),
  })
  .eq("id", duplicate.company_id);
if (dupErr) {
  console.log(JSON.stringify({ ok: false, error: "duplicate_update_failed" }));
  process.exit(1);
}

// 5) Audit without tokens / Drive IDs
try {
  await supabase.from("audit_events").insert({
    company_id: primary.company_id,
    entity_type: "company",
    entity_id: duplicate.company_id,
    action: "duplicate_merge",
    after_state: {
      primary_id: primary.company_id,
      duplicate_id: duplicate.company_id,
      moved: plan.moved,
      drive_note: plan.driveNote,
      vkn_masked: primary.vkn_masked,
    },
  });
} catch {
  // audit best-effort
}

console.log(
  JSON.stringify({ ...summary, applied: true, already_applied: false }, null, 2)
);
