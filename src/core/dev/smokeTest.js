/**
 * Developer-only CORE smoke test.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAccountingDecision } from "../annveroCore.js";

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
    // .env.local yoksa ortam değişkenleri kullanılır
  }
}

function createSmokeTestSupabase() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const SAMPLE_CASES = [
  {
    name: "Google Ads bank transaction",
    input: {
      source_type: "bank",
      company_id: process.env.ANNVERO_CORE_TEST_COMPANY_ID || "demo-company-1",
      raw_description: "GOOGLE ADS IRELAND CC CHARGE",
      amount: -1500,
      currency: "TRY",
      bank_name: "Garanti",
    },
    context: {
      user_id: "dev-user",
      user_role: "admin",
      company_access: ["*"],
      module: "smoke_test",
      request_id: "smoke-001",
    },
  },
  {
    name: "Unknown transaction",
    input: {
      source_type: "bank",
      company_id: process.env.ANNVERO_CORE_TEST_COMPANY_ID || "demo-company-1",
      raw_description: "RASTGELE ODEME XYZ",
      amount: -100,
    },
    context: {
      user_id: "dev-user",
      user_role: "admin",
      company_access: ["*"],
      module: "smoke_test",
      request_id: "smoke-002",
    },
  },
  {
    name: "Missing company_id (should fail validation)",
    input: {
      source_type: "bank",
      raw_description: "TEST",
    },
    context: {
      user_id: "dev-user",
      module: "smoke_test",
    },
  },
];

async function runViaApi(baseUrl, cookie) {
  const caseOne = SAMPLE_CASES[0];
  const response = await fetch(`${baseUrl}/api/dev/core-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(caseOne.input),
  });

  const payload = await response.json().catch(() => ({}));
  return {
    name: "API core-test endpoint",
    ok: response.ok && payload?.data?.status,
    status: payload?.data?.status,
    decision_source: payload?.data?.decision_source,
    confidence_score: payload?.data?.confidence_score,
    needs_manual_review: payload?.data?.needs_manual_review,
    trace_stages: (payload?.data?.debug_trace || []).map((t) => t.stage),
    http_status: response.status,
  };
}

/**
 * @param {{ mode?: 'local'|'api', apiBaseUrl?: string, apiCookie?: string }} options
 */
export async function runCoreSmokeTest(options = {}) {
  const mode = options.mode || process.env.ANNVERO_CORE_TEST_MODE || "local";
  const results = [];
  let passed = 0;
  let failed = 0;

  if (mode === "api") {
    const apiResult = await runViaApi(
      options.apiBaseUrl || process.env.ANNVERO_CORE_TEST_URL || "http://localhost:3000",
      options.apiCookie || process.env.ANNVERO_CORE_TEST_COOKIE || ""
    );
    results.push(apiResult);
    if (apiResult.ok) passed += 1;
    else failed += 1;
    return { passed, failed, results, mode };
  }

  const useDb = process.env.ANNVERO_CORE_USE_DB === "1";
  const dbClient = useDb ? createSmokeTestSupabase() : null;

  for (const testCase of SAMPLE_CASES) {
    const context = {
      ...testCase.context,
      company_access: useDb ? ["*"] : testCase.context.company_access,
      ...(dbClient ? { supabase: dbClient } : {}),
    };

    const result = await resolveAccountingDecision(testCase.input, context);
    const ok = result && typeof result.status === "string" && Array.isArray(result.debug_trace);

    if (ok) passed += 1;
    else failed += 1;

    results.push({
      name: testCase.name,
      ok,
      status: result?.status,
      decision_source: result?.decision_source,
      confidence_score: result?.confidence_score,
      needs_manual_review: result?.needs_manual_review,
      matched_entity: result?.matched_entity?.entity_name || null,
      trace_stages: (result?.debug_trace || []).map((t) => t.stage),
      db_mode: useDb,
    });
  }

  return { passed, failed, results, mode: useDb ? "local+db" : "local+fallback" };
}
