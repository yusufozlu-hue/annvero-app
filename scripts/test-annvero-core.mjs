#!/usr/bin/env node
/**
 * ANNVERO CORE smoke test script (developer-only).
 *
 * Usage:
 *   node scripts/test-annvero-core.mjs
 *   ANNVERO_CORE_USE_DB=1 node scripts/test-annvero-core.mjs
 *   ANNVERO_CORE_TEST_MODE=api ANNVERO_CORE_TEST_URL=http://localhost:3000 node scripts/test-annvero-core.mjs
 */

import { runCoreSmokeTest } from "../src/core/dev/smokeTest.js";

const summary = await runCoreSmokeTest();

console.log(`\n=== ANNVERO CORE Smoke Test (${summary.mode}) ===\n`);
for (const row of summary.results) {
  console.log(`${row.ok ? "✓" : "✗"} ${row.name}`);
  console.log(`  status=${row.status} source=${row.decision_source} confidence=${row.confidence_score}`);
  if (row.matched_entity) console.log(`  entity=${row.matched_entity}`);
  if (row.http_status) console.log(`  http=${row.http_status}`);
  console.log(`  stages: ${(row.trace_stages || []).join(" → ")}`);
}
console.log(`\nPassed: ${summary.passed} / Failed: ${summary.failed}\n`);

process.exit(summary.failed > 0 ? 1 : 0);
