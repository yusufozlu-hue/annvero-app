/**
 * Service-role kullanan API route envanteri (statik denetim).
 * Her satır: oturum/guard kalıbı aranır.
 * Sistem/cron: yalnız canonical authorizeSystemReconcileRequest çağrısı
 * + fail-closed sonucu + getApiSupabase’ten ÖNCE bulunması kabul edilir.
 * İsim/import tek başına, ignored result, yutulan catch, dinamik alias → FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiRoot = path.join(root, "app", "api");

/** app/api dışında service_role kullanan canonical sistem çekirdekleri. */
const EXTRA_SERVICE_ROLE_FILES = [
  "src/lib/googleDrive/runSystemReconcile.js",
];

const SERVICE_MARKERS =
  /getApiSupabase|getServerSupabaseAdmin|getGibSupabaseAdmin|requireServiceRole/;
const AUTH_MARKERS =
  /requireApiSession|requireAuthenticatedApi|requireManagementApi|requireAdminUser|requireManagementUser|assertCompanyAccess/;

/** Canonical system/cron guard — doğrudan çağrı formu zorunlu. */
const SYSTEM_AUTH_CALL = /authorizeSystemReconcileRequest\s*\(/;
const SERVICE_ROLE_CALL =
  /getApiSupabase\s*\(|getServerSupabaseAdmin\s*\(|getGibSupabaseAdmin\s*\(/;
const SYSTEM_AUTH_DYNAMIC =
  /\[\s*["'`]authorizeSystemReconcileRequest["'`]\s*\]|authorizeSystemReconcileRequest\s*\.call\s*\(|authorizeSystemReconcileRequest\s*\.apply\s*\(/;
const FAIL_CLOSED =
  /if\s*\(\s*!\s*[A-Za-z_$][\w$]*\.ok\s*\)|if\s*\(\s*[A-Za-z_$][\w$]*\.ok\s*===?\s*false\s*\)/;

/**
 * @param {string} src
 * @returns {{ needsAuth: boolean, ok: boolean, reason?: string }}
 */
export function evaluateServiceRoleRouteAuth(src) {
  const text = String(src || "");
  if (!SERVICE_MARKERS.test(text)) {
    return { needsAuth: false, ok: true };
  }

  if (AUTH_MARKERS.test(text)) {
    return { needsAuth: true, ok: true, reason: "session_or_company_guard" };
  }

  if (SYSTEM_AUTH_DYNAMIC.test(text)) {
    return {
      needsAuth: true,
      ok: false,
      reason: "system_guard_dynamic_alias",
    };
  }

  const systemMatch = SYSTEM_AUTH_CALL.exec(text);
  if (systemMatch) {
    const authIdx = systemMatch.index;
    const serviceMatch = SERVICE_ROLE_CALL.exec(text);
    if (!serviceMatch) {
      return { needsAuth: true, ok: true, reason: "system_reconcile_guard" };
    }
    if (authIdx >= serviceMatch.index) {
      return {
        needsAuth: true,
        ok: false,
        reason: "system_guard_after_service_role",
      };
    }

    const between = text.slice(authIdx, serviceMatch.index);

    // Sonuç kullanılmadan / fail-closed olmadan devam
    if (!FAIL_CLOSED.test(between)) {
      return {
        needsAuth: true,
        ok: false,
        reason: "system_guard_result_ignored",
      };
    }

    // try/catch ile auth hatasını yutup service_role’e devam
    const catchBlocks = [
      ...between.matchAll(/\}\s*catch\s*(?:\([^)]*\))?\s*\{([\s\S]*?)\}/g),
    ];
    for (const block of catchBlocks) {
      const body = block[1] || "";
      if (!/\b(return|throw)\b/.test(body)) {
        return {
          needsAuth: true,
          ok: false,
          reason: "system_guard_catch_swallows",
        };
      }
    }

    return { needsAuth: true, ok: true, reason: "system_reconcile_guard" };
  }

  // Yalnız isim/yorum/import — çağrı yok
  if (/authorizeSystemReconcileRequest/.test(text)) {
    return {
      needsAuth: true,
      ok: false,
      reason: "system_guard_name_without_call",
    };
  }

  return { needsAuth: true, ok: false, reason: "missing_auth_guard" };
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function main() {
  let failed = 0;
  const rows = [];
  const files = [
    ...walk(apiRoot),
    ...EXTRA_SERVICE_ROLE_FILES.map((rel) => path.join(root, rel)),
  ];

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`FAIL  missing ${path.relative(root, file).replace(/\\/g, "/")}`);
      failed += 1;
      continue;
    }
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const verdict = evaluateServiceRoleRouteAuth(src);
    if (!verdict.needsAuth) continue;
    rows.push({ file: rel, ...verdict });
    if (!verdict.ok) {
      console.error(
        `FAIL  ${rel} — service_role var, oturum/firma/system guard yok (${verdict.reason})`
      );
      failed += 1;
    } else {
      console.log(`PASS  ${rel}`);
    }
  }

  console.log(`\nService-role route count: ${rows.length}`);
  if (failed) process.exit(1);
  console.log("PASS  service-role route auth inventory");
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main();
}
