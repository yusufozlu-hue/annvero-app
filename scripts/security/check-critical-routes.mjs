/**
 * Kritik API route koruma envanteri — statik.
 * Çalıştır: node scripts/security/check-critical-routes.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CRITICAL = [
  {
    file: "app/api/gib-credentials/route.js",
    mustMatch: [/requireApiSession|requireAuthenticatedApi/, /assertCompanyAccess|canAccessCompany/, /enforceRateLimit|enforceDurableRateLimit/],
  },
  {
    file: "app/api/backup/company-export/route.js",
    mustMatch: [/requireManagementApi/, /assertCompanyAccess/, /enforceDurableRateLimit|enforceRateLimit/],
  },
  {
    file: "app/api/recovery/deleted-records/route.js",
    mustMatch: [/requireManagementApi/],
  },
  {
    file: "app/api/recovery/restore/route.js",
    mustMatch: [/requireManagementApi/, /RESTORE_CONFIRM|confirmPhrase/, /isRecoveryApiEnabled/, /enforceDurableRateLimit/],
  },
  {
    file: "app/api/official-notifications/gib-check/route.js",
    mustMatch: [/assertCompanyAccess|requireApiSession|requireAuthenticatedApi/, /enforceRateLimit|enforceDurableRateLimit/],
  },
  {
    file: "app/api/automation/webhook/route.js",
    mustMatch: [/verifyWebhookRequest/, /enforceDurableRateLimit|enforceRateLimit/],
  },
  {
    file: "src/lib/security/webhookAuth.js",
    mustMatch: [/timingSafeEqual|safeEqualString/, /computeWebhookSignature/, /rememberWebhookEvent/],
  },
  {
    file: "app/api/tcmb/route.ts",
    mustMatch: [/requireApiSession/],
  },
  {
    file: "app/api/elektraweb/route.ts",
    mustMatch: [/requireApiSession/, /validateUploadFile/],
  },
];

let failed = 0;

for (const item of CRITICAL) {
  const full = path.join(root, item.file);
  if (!fs.existsSync(full)) {
    console.error(`FAIL  missing ${item.file}`);
    failed += 1;
    continue;
  }
  const src = fs.readFileSync(full, "utf8");
  const missing = item.mustMatch.filter((re) => !re.test(src));
  if (missing.length) {
    console.error(`FAIL  ${item.file} — koruma eksik: ${missing.map(String).join(", ")}`);
    failed += 1;
  } else {
    console.log(`PASS  ${item.file}`);
  }
}

if (failed) process.exit(1);
console.log("PASS  critical route checks");
