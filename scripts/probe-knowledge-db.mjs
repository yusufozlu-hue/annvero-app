#!/usr/bin/env node
/**
 * Knowledge Engine DB probe — service_role ile tablo erişim testi.
 *
 * Usage:
 *   node scripts/probe-knowledge-db.mjs
 *   node scripts/probe-knowledge-db.mjs 114f98b5-0411-45c5-a7c6-8061c9f06699
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KNOWLEDGE_TABLES } from "../src/lib/knowledge-engine/constants.js";

function loadEnvLocal() {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      value = value.replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore
  }
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

async function probeTable(supabase, table, buildQuery) {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  if (buildQuery) query = buildQuery(query);
  const { count, error } = await query;
  if (error) {
    return {
      ok: false,
      count: 0,
      error: error.message,
      code: error.code,
      hint: isMissingTableError(error) ? "table_or_schema_cache_missing" : "query_failed",
    };
  }
  return { ok: true, count: count ?? 0 };
}

loadEnvLocal();

const companyId = process.argv[2] || process.env.ANNVERO_CORE_TEST_COMPANY_ID || "";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const missingEnv = [];
if (!url) missingEnv.push("NEXT_PUBLIC_SUPABASE_URL");
if (!serviceRole) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY");

console.log("\n=== Knowledge DB Probe (service_role) ===\n");
console.log("Client type: service_role (SUPABASE_SERVICE_ROLE_KEY)");
console.log("Missing env:", missingEnv.length ? missingEnv.join(", ") : "(none)");

if (missingEnv.length) {
  console.log("\nDB bağlantısı: BAŞARISIZ — eksik environment variable");
  process.exit(1);
}

const supabase = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

for (const [name, result] of Object.entries(tables)) {
  console.log(`\n${name}:`);
  if (result.ok) {
    console.log(`  OK — count=${result.count}`);
  } else {
    console.log(`  FAIL — ${result.error} [${result.code || "no-code"}] hint=${result.hint}`);
  }
}

const ok = Object.values(tables).every((t) => t.ok);
const rootCause = !ok
  ? Object.entries(tables)
      .filter(([, v]) => !v.ok)
      .map(([k, v]) => `${k}: ${v.hint}`)
      .join("; ")
  : "none";

console.log("\n--- Özet ---");
console.log(`DB bağlantısı: ${ok ? "BAŞARILI" : "BAŞARISIZ"}`);
console.log(`Entity sayısı: ${entities.count}`);
console.log(`Pattern sayısı: ${patterns.count}`);
console.log(`Accounting rule sayısı: ${rules.count}`);
console.log(`Company memory (${companyId || "all"}): ${memory.ok ? memory.count : "okunamadı"}`);
console.log(`RLS: service_role bypass — RLS engeli beklenmez`);
console.log(`Gerçek neden: ${rootCause}`);
console.log("");

process.exit(ok ? 0 : 1);
