/**
 * Service-role kullanan API route envanteri (statik denetim).
 * Her satır: oturum/guard kalıbı aranır.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiRoot = path.join(root, "app", "api");

const SERVICE_MARKERS =
  /getApiSupabase|getServerSupabaseAdmin|getGibSupabaseAdmin|requireServiceRole/;
const AUTH_MARKERS =
  /requireApiSession|requireAuthenticatedApi|requireManagementApi|requireAdminUser|requireManagementUser|assertCompanyAccess/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let failed = 0;
const rows = [];

for (const file of walk(apiRoot)) {
  const src = fs.readFileSync(file, "utf8");
  if (!SERVICE_MARKERS.test(src)) continue;
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const hasAuth = AUTH_MARKERS.test(src);
  rows.push({ file: rel, hasAuth });
  if (!hasAuth) {
    console.error(`FAIL  ${rel} — service_role var, oturum/firma guard yok`);
    failed += 1;
  } else {
    console.log(`PASS  ${rel}`);
  }
}

console.log(`\nService-role route count: ${rows.length}`);
if (failed) process.exit(1);
console.log("PASS  service-role route auth inventory");
