/**
 * Developer-only CORE smoke test.
 * Çalıştırma: node --experimental-vm-modules scripts/test-annvero-core.mjs
 * veya import { runCoreSmokeTest } from '@/src/core/dev/smokeTest'
 */

import { resolveAccountingDecision } from "../annveroCore.js";

const SAMPLE_CASES = [
  {
    name: "Google Ads bank transaction",
    input: {
      source_type: "bank",
      company_id: "demo-company-1",
      raw_description: "GOOGLE ADS IRELAND CC CHARGE",
      amount: -1500,
      currency: "TRY",
      bank_name: "Garanti",
    },
    context: {
      user_id: "dev-user",
      user_role: "admin",
      company_access: ["demo-company-1"],
      module: "smoke_test",
      request_id: "smoke-001",
    },
  },
  {
    name: "Unknown transaction",
    input: {
      source_type: "bank",
      company_id: "demo-company-1",
      raw_description: "RASTGELE ODEME XYZ",
      amount: -100,
    },
    context: {
      user_id: "dev-user",
      user_role: "admin",
      company_access: ["demo-company-1"],
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

/**
 * @returns {Promise<{ passed: number, failed: number, results: object[] }>}
 */
export async function runCoreSmokeTest() {
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const testCase of SAMPLE_CASES) {
    const result = await resolveAccountingDecision(testCase.input, testCase.context);
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
      trace_stages: (result?.debug_trace || []).map((t) => t.stage),
    });
  }

  return { passed, failed, results };
}
