#!/usr/bin/env node
/**
 * ANNVERO CORE smoke test script (developer-only).
 * Usage: node scripts/test-annvero-core.mjs
 */

import { runCoreSmokeTest } from "../src/core/dev/smokeTest.js";

const summary = await runCoreSmokeTest();

console.log("\n=== ANNVERO CORE Smoke Test ===\n");
for (const row of summary.results) {
  console.log(`${row.ok ? "✓" : "✗"} ${row.name}`);
  console.log(`  status=${row.status} source=${row.decision_source} confidence=${row.confidence_score}`);
  console.log(`  stages: ${row.trace_stages.join(" → ")}`);
}
console.log(`\nPassed: ${summary.passed} / Failed: ${summary.failed}\n`);

process.exit(summary.failed > 0 ? 1 : 0);
