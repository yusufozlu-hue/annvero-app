/**
 * Migration contract 020–025 — restrictive RLS, grants, indexes, SECURITY DEFINER, rate-limit RPC.
 * Includes pure validators + negative fixtures that MUST FAIL.
 * Run: npm run test:migration-contract
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const sql023 = read("supabase/migrations/023_company_membership_source.sql");
const sql024 = read("supabase/migrations/024_security_dr_hardening.sql");
const sql025 = read("supabase/migrations/025_security_view_indexes_grants.sql");
const preflight = read("docs/security/STAGING_SCHEMA_PREFLIGHT_READ_ONLY.sql");
const rateLimitSrc = read("src/lib/security/rateLimitDurable.js");
const restore = read("src/lib/recovery/restoreDeletedRecord.js");

/** Strip SQL line/block comments and string/dollar-quote literals for statement scans. */
function stripSqlCommentsAndStrings(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      continue;
    }
    if (sql[i] === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += " ";
      continue;
    }
    if (sql[i] === "$") {
      const m = sql.slice(i).match(/^\$([A-Za-z_]*)\$/);
      if (m) {
        const tag = m[0];
        i += tag.length;
        const end = sql.indexOf(tag, i);
        if (end === -1) {
          i = n;
        } else {
          i = end + tag.length;
        }
        out += " ";
        continue;
      }
    }
    out += sql[i++];
  }
  return out;
}

function normExpr(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// Pure contract validators (string/object models — no DB)
// ---------------------------------------------------------------------------

/** Restrictive deny policy: authenticated only, RESTRICTIVE, exact false. */
export function validateDenyPolicy(model) {
  const errors = [];
  if (model.is_permissive !== false) errors.push("must be RESTRICTIVE (is_permissive=false)");
  const roles = Array.isArray(model.roles) ? model.roles : [];
  if (roles.length !== 1 || roles[0] !== "authenticated") {
    errors.push("roles must be exactly [authenticated]");
  }
  const cmd = model.cmd;
  const qual = normExpr(model.qual);
  const wc = normExpr(model.with_check);
  const isFalse = (v) => v === "false" || v === "(false)";
  if (cmd === "a") {
    if (!isFalse(wc)) errors.push("INSERT WITH CHECK must be false");
    if (qual && qual !== "") errors.push("INSERT USING must be absent");
  } else if (cmd === "w") {
    if (!isFalse(qual) || !isFalse(wc)) errors.push("UPDATE USING/WITH CHECK must be false");
  } else if (cmd === "d") {
    if (!isFalse(qual)) errors.push("DELETE USING must be false");
  } else {
    errors.push("unsupported cmd");
  }
  return { ok: errors.length === 0, errors };
}

/** Recovery SELECT: exact AND of is_management + can_access_company; no OR. */
export function validateRecoverySelectQual(model) {
  const errors = [];
  if (model.is_permissive !== true) errors.push("must be PERMISSIVE");
  if (model.cmd !== "r") errors.push("cmd must be SELECT (r)");
  const roles = Array.isArray(model.roles) ? model.roles : [];
  if (roles.length !== 1 || roles[0] !== "authenticated") {
    errors.push("roles must be exactly [authenticated]");
  }
  const raw = String(model.qual || "");
  const n = normExpr(raw);
  if (/\bor\b/i.test(raw) || n.includes(")or(")) errors.push("OR not allowed");
  const allowed = new Set([
    "(annvero_is_management()andannvero_can_access_company(company_id))",
    "(public.annvero_is_management()andpublic.annvero_can_access_company(company_id))",
    "(public.annvero_is_management()andannvero_can_access_company(company_id))",
    "(annvero_is_management()andpublic.annvero_can_access_company(company_id))",
  ]);
  if (!allowed.has(n)) errors.push("qual must be exact AND of is_management + can_access_company");
  return { ok: errors.length === 0, errors };
}

/**
 * Index: table, column order, unique, exact normalized predicate, ASC/DESC dirs, valid/ready.
 * pred_exact_norm: null = no predicate; otherwise exact match after normExpr (not substring).
 */
export function validateIndexModel(model, expect) {
  const errors = [];
  if (model.table_name !== expect.table_name) errors.push("wrong table");
  const cols = Array.isArray(model.columns) ? model.columns : [];
  const exp = expect.columns || [];
  if (cols.length !== exp.length || cols.some((c, i) => c !== exp[i])) {
    errors.push("wrong column order");
  }
  if (Boolean(model.is_unique) !== Boolean(expect.is_unique)) errors.push("unique mismatch");
  const predNorm = normExpr(model.predicate);
  if (expect.pred_exact_norm == null || expect.pred_exact_norm === "") {
    if (predNorm) errors.push("unexpected partial predicate");
  } else {
    const allowed = Array.isArray(expect.pred_aliases)
      ? [expect.pred_exact_norm, ...expect.pred_aliases]
      : [expect.pred_exact_norm];
    if (!allowed.includes(predNorm)) errors.push("wrong exact predicate");
  }
  if (expect.column_dirs) {
    const dirs = Array.isArray(model.column_dirs) ? model.column_dirs : [];
    const expDirs = expect.column_dirs;
    if (dirs.length !== expDirs.length || dirs.some((d, i) => d !== expDirs[i])) {
      errors.push("wrong index sort direction");
    }
  }
  if (model.indisvalid === false || model.indisready === false) {
    errors.push("index not valid/ready");
  }
  return { ok: errors.length === 0, errors };
}

/**
 * V4.5.2: controlled normalize ONLY for uq_document_index_company_hash.
 * lower + strip whitespace + drop ::text + drop parens + != → <>; reject OR.
 */
export function normalizeDocumentHashPredicate(pred) {
  const raw = String(pred ?? "");
  if (/\sor\s/i.test(raw) || /\)\s*or\s*\(/i.test(raw)) return null;
  return raw
    .toLowerCase()
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, "")
    .replace(/::text/g, "")
    .replace(/[()]/g, "")
    .replace(/!=/g, "<>");
}

export const DOCUMENT_HASH_PRED_CANON =
  "file_hashisnotnullandfile_hash<>''andparse_status<>'soft_deleted'";

export function matchesDocumentHashPredicate(pred) {
  const n = normalizeDocumentHashPredicate(pred);
  return n === DOCUMENT_HASH_PRED_CANON;
}

/** V4.5.2: exact safe aliases for idx_annvero_company_members_user. */
export function matchesMembersUserActivePredicate(pred) {
  if (pred == null || pred === "") return false;
  const n = String(pred)
    .toLowerCase()
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, "");
  return [
    "is_active",
    "(is_active)",
    "is_active=true",
    "(is_active=true)",
    "is_activeistrue",
    "(is_activeistrue)",
  ].includes(n);
}

/**
 * V4.5.4: exact IN aliases for idx_audit_events_request_id (preflight predicate_norm).
 * Accepts only <> / != with '' or ''::text — no substring, OR, other column/cast.
 */
export const AUDIT_REQUEST_ID_PRED_ALIASES = [
  "(request_id<>'')",
  "(request_id<>''::text)",
  "(request_id!='')",
  "(request_id!=''::text)",
];

export function matchesAuditRequestIdPredicate(pred) {
  if (pred == null || pred === "") return false;
  const n = String(pred)
    .toLowerCase()
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, "");
  return AUDIT_REQUEST_ID_PRED_ALIASES.includes(n);
}

/** Both detail and applied024 paths must embed the same exact IN list. */
export function extractAuditRequestIdInLists(preflightSql) {
  const sql = String(preflightSql);
  const marker = "idx_audit_events_request_id";
  const windows = [];
  let from = 0;
  while (true) {
    const i = sql.indexOf(marker, from);
    if (i < 0) break;
    const win = sql.slice(i, i + 900);
    if (/predicate_norm\s+in\s*\(/i.test(win)) {
      windows.push(win);
    }
    from = i + marker.length;
  }
  return windows;
}

export function auditRequestIdInListHasExactAliases(windowSql) {
  const needed = [
    "'(request_id<>'''')'",
    "'(request_id<>''''::text)'",
    "'(request_id!='''')'",
    "'(request_id!=''''::text)'",
  ];
  const body = String(windowSql);
  return needed.every((tok) => body.includes(tok));
}

/** Executed unique: (company_id, table_name, record_id) WHERE executed true. */
export function validateExecutedUniqueIndex(model) {
  return validateIndexModel(model, {
    table_name: "recovery_restore_approvals",
    columns: ["company_id", "table_name", "record_id"],
    is_unique: true,
    pred_exact_norm: "(executedistrue)",
    pred_aliases: ["(executed=true)"],
    column_dirs: ["ASC", "ASC", "ASC"],
  });
}

/** Forbidden: name[] compared directly to text[] (Postgres 42883). */
export function hasNameArrayEqualsTextArray(sql) {
  // Direct compare of array_agg(attname) [name[]] to ::text[] literal/empty
  // without casting attname to text.
  const bareAgg =
    /array_agg\s*\(\s*a\.attname(?!\s*::\s*text)/i.test(sql) &&
    /array\[.*\]::\s*text\[\]|array\[\]::\s*text\[\]/i.test(sql);
  // Explicit name[] = text[] / is distinct from patterns
  const explicit =
    /::\s*name\[\s*\][\s\S]{0,80}(?:=\s*|is\s+distinct\s+from\s*)[\s\S]{0,40}::\s*text\[\s*\]/i.test(
      sql
    ) ||
    /::\s*text\[\s*\][\s\S]{0,80}(?:=\s*|is\s+distinct\s+from\s*)[\s\S]{0,40}::\s*name\[\s*\]/i.test(
      sql
    );
  return Boolean(bareAgg || explicit);
}

/**
 * Migration catalog paths that compare to text[] must use attname::text.
 * Scans whole file; returns missing category tags.
 */
export function validateAttnameTextCastForCatalog(sql) {
  const missing = [];
  const bare = [...sql.matchAll(/array_agg\s*\(\s*a\.attname(?!\s*::\s*text)/gi)];
  if (bare.length > 0) {
    if (/::\s*text\[\s*\]/.test(sql)) {
      missing.push(`bare_attname_agg_count=${bare.length}`);
    }
  }
  const hasCast = /array_agg\s*\(\s*a\.attname::text/i.test(sql);
  if (!hasCast) missing.push("attname_text_cast");

  const paths = [
    {
      tag: "pk",
      re: /array_agg\s*\(\s*a\.attname::text[\s\S]{0,500}indisprimary/i,
    },
    {
      tag: "check",
      re: /array_agg\s*\(\s*a\.attname::text[\s\S]{0,400}array\[\s*r\.col\s*\]::\s*text\[\]/i,
    },
    {
      tag: "fk",
      re: /a\.attname::text[\s\S]{0,250}unnest\s*\(\s*c\.conkey\s*\)[\s\S]{0,800}a\.attname::text[\s\S]{0,250}unnest\s*\(\s*c\.confkey\s*\)|unnest\s*\(\s*c\.conkey\s*\)[\s\S]{0,250}a\.attname::text[\s\S]{0,800}unnest\s*\(\s*c\.confkey\s*\)[\s\S]{0,250}a\.attname::text/i,
    },
    {
      tag: "index",
      re: /indkey[\s\S]{0,400}array_agg\s*\(\s*a\.attname::text|array_agg\s*\(\s*a\.attname::text[\s\S]{0,250}indkey/i,
    },
  ];
  for (const p of paths) {
    if (!p.re.test(sql)) missing.push(p.tag);
  }
  return { ok: missing.length === 0, missing };
}

/** Preflight name[] contract must not mix with bare text[] equality on same agg. */
export function validatePreflightNameArrayConsistency(sql) {
  const errors = [];
  // applied024 PK uses name[] both sides — OK
  if (
    /array_agg\s*\(\s*a\.attname(?!\s*::\s*text)[\s\S]{0,120}=\s*array\[[^\]]*\]::\s*text\[\]/i.test(
      sql
    )
  ) {
    errors.push("preflight compares bare attname agg to text[] without cast");
  }
  return { ok: errors.length === 0, errors };
}

/** Privilege matrix: requires every expected role×priv combination; leaks fail. */
export function validatePrivilegeModel(model) {
  const errors = [];
  const bits = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
  const hasAny = (role) => bits.some((b) => model.privileges?.[role]?.[b] === true);

  if (model.forbidPublicLeak && hasAny("PUBLIC")) {
    errors.push("PUBLIC privilege leak");
  }
  if (model.auditAppendOnly) {
    const svc = model.privileges?.service_role || {};
    if (svc.UPDATE || svc.DELETE || svc.TRUNCATE) {
      errors.push("service_role UPDATE/DELETE/TRUNCATE on audit forbidden");
    }
    if (!svc.SELECT || !svc.INSERT) {
      errors.push("service_role must have SELECT+INSERT on audit");
    }
  }
  if (Array.isArray(model.requiredFalse)) {
    for (const { role, priv } of model.requiredFalse) {
      if (model.privileges?.[role]?.[priv] !== false) {
        errors.push(`missing privilege combination overlooked: ${role}.${priv}`);
      }
    }
  }
  if (Array.isArray(model.requiredTrue)) {
    for (const { role, priv } of model.requiredTrue) {
      if (model.privileges?.[role]?.[priv] !== true) {
        errors.push(`missing privilege combination overlooked: ${role}.${priv} must be true`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** FK catalog contract. */
export function validateFkModel(model, expect) {
  const errors = [];
  if (model.contype !== "f") errors.push("must be foreign key");
  if (model.table_name !== expect.table_name) errors.push("wrong table");
  if (model.conf_schema !== expect.conf_schema) errors.push("wrong conf schema");
  if (model.conf_table !== expect.conf_table) errors.push("wrong conf table");
  const src = Array.isArray(model.src_cols) ? model.src_cols : [];
  const tgt = Array.isArray(model.tgt_cols) ? model.tgt_cols : [];
  if (JSON.stringify(src) !== JSON.stringify(expect.src_cols)) errors.push("wrong src cols");
  if (JSON.stringify(tgt) !== JSON.stringify(expect.tgt_cols)) errors.push("wrong tgt cols");
  if (model.confdeltype !== expect.confdeltype) errors.push("wrong confdeltype");
  if (model.convalidated !== true) errors.push("must be validated");
  return { ok: errors.length === 0, errors };
}

/** CHECK constraint exact normalized expression. */
export function validateCheckConstraint(model, expect) {
  const errors = [];
  if (model.contype !== "c") errors.push("must be check");
  if (model.table_name !== expect.table_name) errors.push("wrong table");
  if (normExpr(model.check_expr) !== normExpr(expect.check_expr)) {
    errors.push("wrong CHECK constraint");
  }
  if (model.convalidated !== true) errors.push("must be validated");
  return { ok: errors.length === 0, errors };
}

/**
 * Trigger: table + tgfoid signature + timing/enabled required.
 * pg_get_triggerdef may omit schema qualification — do not require
 * "public.fn()" substring in def when function_signature already matches.
 */
export function validateTriggerModel(model, expect) {
  const errors = [];
  if (model.trigger_name !== expect.trigger_name) errors.push("wrong trigger name");
  if (model.table_name !== expect.table_name) errors.push("wrong trigger table");
  if (model.function_signature !== expect.function_signature) {
    errors.push("wrong trigger function (tgfoid)");
  }
  const def = String(model.trigger_def || "");
  const bareFn = String(expect.function_signature || "").replace(/^public\./i, "");
  // Accept schema-qualified OR bare function name in deparser output
  if (
    expect.function_signature &&
    !def.includes(expect.function_signature) &&
    !def.includes(bareFn)
  ) {
    errors.push("trigger def missing function name");
  }
  if (expect.timing_event && !def.toUpperCase().includes(String(expect.timing_event).toUpperCase())) {
    errors.push("trigger def missing timing/event");
  }
  if (!["O", "A"].includes(model.tgenabled)) errors.push("trigger not enabled");
  return { ok: errors.length === 0, errors };
}

/**
 * Summary: true MANUAL_REVIEW still blocks READY; READY_TO_REMEDIATE does not.
 * applied024/025 require full object sets.
 */
export function validateSummaryReadiness(state) {
  const errors = [];
  const hasMr =
    Boolean(state.mr022) ||
    Boolean(state.mr023) ||
    (Array.isArray(state.secdefStatuses) && state.secdefStatuses.includes("MANUAL_REVIEW"));
  if (hasMr && (state.summary022 === "READY" || state.summary023 === "READY")) {
    errors.push("MANUAL_REVIEW present but summary READY");
  }
  if (hasMr && state.summary024 === "READY") {
    errors.push("MANUAL_REVIEW present but summary READY");
  }
  // READY_TO_REMEDIATE must not be treated as MANUAL_REVIEW
  if (
    Array.isArray(state.secdefStatuses) &&
    state.secdefStatuses.includes("READY_TO_REMEDIATE") &&
    !hasMr &&
    state.summary024 === "READY"
  ) {
    // OK — pending remediation does not block 024 apply
  }
  if (state.applied024 === true && Array.isArray(state.required024) && state.required024.some((x) => !x)) {
    errors.push("Missing 024 object but applied024=true");
  }
  if (state.applied025 === true && Array.isArray(state.required025) && state.required025.some((x) => !x)) {
    errors.push("Missing 025 index but applied025=true");
  }
  return { ok: errors.length === 0, errors };
}

/** Secdef hardened contract for 024. */
export function validateHardenedSecdef(model) {
  const errors = [];
  if (model.prosecdef !== true) errors.push("must be SECURITY DEFINER");
  const path = String(model.search_path_norm || "").toLowerCase().replace(/\s+/g, "");
  if (path !== "pg_catalog,pg_temp") errors.push("search_path must be pg_catalog,pg_temp");
  if (path.includes("public")) errors.push("search_path must not include public");
  if (model.exec_public) errors.push("PUBLIC EXECUTE must be false");
  if (model.exec_anon) errors.push("anon EXECUTE must be false");
  return { ok: errors.length === 0, errors };
}

/** Pending remediation vs irreconcilable drift. */
export function classifyRemediationStatus({ can024Fix, matchesHardened }) {
  if (matchesHardened) return "ALREADY_APPLIED";
  if (can024Fix) return "READY_TO_REMEDIATE";
  return "CONFLICT";
}

/** V4.5 function contract status (body fingerprint + owner/type/ACL). */
export function classifyFnContractStatus(m) {
  if (!m.typeOk || !m.ownerOk || !m.prosecdefOk) return "CONFLICT";
  if (!m.bodyHardened && !m.bodyLegacy) return "CONFLICT";
  if (m.expectInvoker && m.prosecdefOk === false) return "CONFLICT";
  if (m.bodyHardened && m.pathOk && m.aclOk && m.ownerOk && m.typeOk) return "ALREADY_APPLIED";
  if (m.bodyLegacy || m.bodyHardened) return "READY_TO_REMEDIATE";
  return "CONFLICT";
}

/** Companies 4-role × 7-privilege exact matrix. */
export function validateCompaniesGrantMatrix(roles) {
  const errors = [];
  const needFalse = ["insert", "update", "delete", "truncate", "references", "trigger"];
  for (const role of ["PUBLIC", "anon"]) {
    const r = roles[role] || {};
    for (const p of ["select", ...needFalse]) {
      if (r[p] !== false) errors.push(`${role}.${p} must be false`);
    }
  }
  const auth = roles.authenticated || {};
  if (auth.select !== true) errors.push("authenticated.select must be true");
  for (const p of needFalse) {
    if (auth[p] !== false) errors.push(`authenticated.${p} must be false`);
  }
  const svc = roles.service_role || {};
  for (const p of ["select", "insert", "update", "delete"]) {
    if (svc[p] !== true) errors.push(`service_role.${p} must be true`);
  }
  for (const p of ["truncate", "references", "trigger"]) {
    if (svc[p] !== false) errors.push(`service_role.${p} must be false`);
  }
  return { ok: errors.length === 0, errors };
}

/** V4.5.1: CRLF→LF only; exact string equality (preserves case + literal spaces). */
export function normalizeBodyCrlf(src) {
  return String(src ?? "").replace(/\r\n/g, "\n");
}

export function bodiesExactEqual(a, b) {
  return normalizeBodyCrlf(a) === normalizeBodyCrlf(b);
}

/** Forbidden: decision via lower+whitespace-strip fingerprint. */
export function usesForbiddenBodyFingerprint(sql) {
  return /md5\s*\(\s*lower\s*\(\s*regexp_replace\s*\([^)]*prosrc/i.test(sql)
    || /md5\s*\(\s*lower\s*\(\s*regexp_replace\s*\([^)]*\\s\+/i.test(sql);
}

/** Forbidden: live prosrc / live pg_get_function_result self-compare as expected. */
export function usesLiveSelfComparison(sql) {
  const rateAssert = /annvero_rate_limit_consume[\s\S]{0,800}annvero_assert_fn_contract|annvero_assert_fn_contract[\s\S]{0,800}annvero_rate_limit_consume/i;
  if (!rateAssert.test(sql) && !/annvero_rate_limit_consume\(text,integer,bigint\)/.test(sql)) {
    // still scan whole file for self-compare patterns near assert
  }
  const liveProsrc =
    /annvero_assert_fn_contract\s*\([\s\S]*?\(select\s+p\.prosrc\s+from\s+pg_catalog\.pg_proc/i.test(sql);
  const liveResult =
    /annvero_assert_fn_contract\s*\([\s\S]*?pg_get_function_result\s*\(\s*to_regprocedure\s*\(\s*'public\.annvero_rate_limit_consume/i.test(
      sql
    );
  return liveProsrc || liveResult;
}

/**
 * Window ms → interval seconds via double precision:
 * interval '1 second' * (ms::double precision / 1000.0)
 * 1500ms must be 1.5s, NOT truncated to 1000ms → 1.0s.
 */
export function windowMsToIntervalSeconds(ms) {
  return Number(ms) * (1.0 / 1000.0);
}

/**
 * Rate-limit count saturation with bigint intermediate:
 * least(count::bigint + 1, limit::bigint + 1)::integer
 * Must not overflow when count === INT_MAX.
 */
export function saturateRateLimitCount(count, limit) {
  const c = BigInt(count) + 1n;
  const l = BigInt(limit) + 1n;
  const r = c < l ? c : l;
  return Number(r);
}

/**
 * Paired indoption dirs (correct): same ordinality join of indkey/indoption unnest.
 * indoptions is 0-based vector values in key order; ordinalities are 1-based WITH ORDINALITY.
 */
export function dirsFromIndoptionPaired(indoptions, ordinalities) {
  if (!Array.isArray(indoptions) || !Array.isArray(ordinalities)) return [];
  if (indoptions.length !== ordinalities.length) return [];
  return indoptions.map((opt) => ((Number(opt) & 1) === 1 ? "DESC" : "ASC"));
}

/**
 * Off-by-one bug: (indoption)[ordinality] when int2vector is 0-based and ordinality is 1-based.
 * Must NOT produce ARRAY['ASC','DESC'] for fixture [0,1] + [1,2].
 */
export function dirsFromIndoptionOffByOne(indoptions, ordinalities) {
  return ordinalities.map((ord) => {
    const opt = indoptions[ord]; // WRONG: skips index 0
    if (opt == null) return "ASC";
    return (Number(opt) & 1) === 1 ? "DESC" : "ASC";
  });
}

/** Nonempty CHECK must map name → exact column + btrim(col) <> ''. */
export function validateNonemptyCheck(model, expected) {
  const errors = [];
  if (model.conname !== expected.conname) errors.push("conname mismatch");
  if (model.table_name !== expected.table_name) errors.push("table mismatch");
  if (model.contype !== "c") errors.push("contype must be c");
  if (model.convalidated !== true) errors.push("convalidated must be true");
  const cols = model.src_cols || [];
  const expCols = expected.src_cols || [];
  if (JSON.stringify(cols) !== JSON.stringify(expCols)) {
    errors.push(`conkey ${JSON.stringify(cols)} != ${JSON.stringify(expCols)}`);
  }
  const norm = String(model.check_expr_norm || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/::[a-z0-9_]+/g, "");
  const col = expCols[0];
  const okExpr =
    norm === `check(btrim(${col})<>'')` || norm === `check((btrim(${col})<>''))`;
  if (!okExpr) errors.push(`expression mismatch: ${norm}`);
  return { ok: errors.length === 0, errors };
}

/** 025 helper rejects same-name DESC index (expects ASC-only). */
export function validateEnsureIndexDirs(actualDirs, keyColCount) {
  const expected = Array.from({ length: keyColCount }, () => "ASC");
  const errors = [];
  if (JSON.stringify(actualDirs) !== JSON.stringify(expected)) {
    errors.push(`dirs ${JSON.stringify(actualDirs)} != ASC-only ${JSON.stringify(expected)}`);
  }
  return { ok: errors.length === 0, errors };
}

/** Extract applied024 / applied025 boolean expression from real preflight SQL. */
export function extractAppliedFlagSql(preflightSql, which) {
  const marker = which === "025" ? "-- applied025:" : "-- applied024:";
  const endMarker = which === "025" ? ") as applied025" : ") as applied024";
  const start = preflightSql.indexOf(marker);
  const end = preflightSql.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`Could not extract ${which} applied block`);
  }
  return preflightSql.slice(start, end + endMarker.length);
}

/** Required tokens that must appear in applied024 SQL (real preflight). */
export const APPLIED024_REQUIRED_TOKENS = [
  "helper_evaluated",
  "annvero_ensure_restrictive_deny_policy",
  "annvero_assert_table_column",
  'annvero_assert_fn_contract(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text)',
  "annvero_profile_role()",
  "annvero_jwt_role()",
  "annvero_profile_company_ids()",
  "annvero_jwt_company_ids()",
  "annvero_can_access_company(text)",
  "annvero_is_management()",
  "annvero_sync_company_membership(uuid,text[],uuid)",
  "annvero_rate_limit_consume(text,integer,bigint)",
  "body_hardened",
  "table(allowedboolean,current_countinteger,reset_attimestampwithtimezone,remaininginteger)",
  "companies",
  "service_role",
  "updated_at",
  "dry_run_summary",
  "created_at",
  "bucket_key",
  "column_default is null",
  "gen_random_uuid",
  "request_id",
  "result",
  "success",
];

/** Required tokens for applied025 SQL. */
export const APPLIED025_REQUIRED_TOKENS = [
  "helper_evaluated",
  "annvero_ensure_index_if_columns(text,text,text,text,text[],boolean,text[],boolean,text)",
  "idx_annvero_company_members_user_active",
  "idx_audit_events_company_id",
  "idx_recovery_restore_approvals_record",
];

/** True when every required token is present in the applied SQL block. */
export function validateAppliedSqlTokens(block, requiredTokens) {
  const missing = requiredTokens.filter((t) => !block.includes(t));
  return { ok: missing.length === 0, missing };
}

/**
 * Helpers must be resolved via helper_evaluated, never norm_path, inside applied flags.
 */
export function validateAppliedHelpersNotFromNormPath(block024, block025) {
  const errors = [];
  const bad024 =
    /from\s+norm_path\s+np\s+where\s+np\.signature\s*=\s*'public\.annvero_ensure_restrictive_deny_policy/i.test(
      block024
    ) ||
    /from\s+norm_path\s+np\s+where\s+np\.signature\s*=\s*'public\.annvero_assert_table_column/i.test(
      block024
    );
  if (bad024) errors.push("applied024 looks up helpers via norm_path");
  if (!/from\s+helper_evaluated\s+he/i.test(block024)) {
    errors.push("applied024 must use helper_evaluated");
  }
  const bad025 =
    /from\s+norm_path\s+np\s+where\s+np\.signature\s*=\s*'public\.annvero_ensure_index_if_columns/i.test(
      block025
    );
  if (bad025) errors.push("applied025 looks up helper via norm_path");
  if (!/from\s+helper_evaluated\s+he/i.test(block025)) {
    errors.push("applied025 must use helper_evaluated");
  }
  return { ok: errors.length === 0, errors };
}

/** search_path for rate-limit RPC: exact pg_catalog, pg_temp (no public). */
export function validateRateLimitSearchPath(searchPath) {
  const n = String(searchPath || "")
    .toLowerCase()
    .replace(/\s+/g, "");
  const errors = [];
  if (n.includes("public")) errors.push("public must not appear in search_path");
  if (n !== "pg_catalog,pg_temp") errors.push("search_path must be exactly pg_catalog, pg_temp");
  return { ok: errors.length === 0, errors };
}

/** Helper EXECUTE must be false for public/anon/authenticated/service_role. */
export function validateHelperExecute(model) {
  const errors = [];
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    if (model.execute?.[role] !== false) {
      errors.push(`${role} EXECUTE must be false`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Rate-limit bounds: limit 1..1000000, window_ms 1000..86400000. */
export function validateRateLimitBounds(model) {
  const errors = [];
  const lim = model.limit;
  const win = model.window_ms;
  if (lim == null || lim < 1 || lim > 1_000_000) errors.push("limit out of bounds");
  if (win == null || win < 1000 || win > 86_400_000) errors.push("window_ms out of bounds");
  return { ok: errors.length === 0, errors };
}

/**
 * grant_matrix: display label PUBLIC, privilege lookup lowercase public.
 * Uppercase PUBLIC must never be passed directly to has_*_privilege.
 */
export function validatePublicPseudoRolePrivilegeLookup(preflightSql) {
  const errors = [];
  const src = String(preflightSql || "");

  // Display label must remain PUBLIC in grant_matrix roles
  if (!/values\s*\(\s*'PUBLIC'\s*\)\s*,\s*\(\s*'anon'\s*\)/i.test(src)) {
    errors.push("grant_matrix display label PUBLIC missing");
  }

  // Lookup must map PUBLIC → public
  if (
    !/case\s+when\s+r\.rolename\s*=\s*'PUBLIC'\s+then\s+'public'\s+else\s+r\.rolename\s+end/i.test(
      src
    )
  ) {
    errors.push("PUBLIC→public case mapping missing for privilege lookup");
  }

  // Forbidden: privilege functions taking uppercase PUBLIC literal or bare r.rolename
  // (case-sensitive: lowercase 'public' is the correct lookup role)
  if (/has_table_privilege\(\s*'PUBLIC'\s*,/.test(src)) {
    errors.push("has_table_privilege('PUBLIC', ...) is forbidden");
  }
  if (/has_function_privilege\(\s*'PUBLIC'\s*,/.test(src)) {
    errors.push("has_function_privilege('PUBLIC', ...) is forbidden");
  }
  if (
    /has_table_privilege\(\s*r\.rolename\s*,/i.test(src) ||
    /has_function_privilege\(\s*r\.rolename\s*,/i.test(src)
  ) {
    errors.push("privilege function must not receive r.rolename directly");
  }

  // All seven privs must use the case mapping
  for (const priv of [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ]) {
    const re = new RegExp(
      `has_table_privilege\\(\\s*case\\s+when\\s+r\\.rolename\\s*=\\s*'PUBLIC'\\s+then\\s+'public'\\s+else\\s+r\\.rolename\\s+end\\s*,[\\s\\S]*?'${priv}'\\s*\\)`,
      "i"
    );
    if (!re.test(src)) {
      errors.push(`grant_matrix ${priv} must use PUBLIC→public case mapping`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function section(t) {
  console.log(`\n== ${t} ==`);
}

// ---------------------------------------------------------------------------
// Negative fixtures — MUST FAIL validators
// ---------------------------------------------------------------------------
section("0) Negative fixtures (validators must reject)");

{
  const badRole = validateDenyPolicy({
    is_permissive: false,
    cmd: "a",
    roles: ["anon"],
    qual: null,
    with_check: "false",
  });
  assert.equal(badRole.ok, false, "deny policy wrong role must fail");

  const permissiveDeny = validateDenyPolicy({
    is_permissive: true,
    cmd: "w",
    roles: ["authenticated"],
    qual: "false",
    with_check: "false",
  });
  assert.equal(permissiveDeny.ok, false, "PERMISSIVE deny must fail");

  const recoveryOr = validateRecoverySelectQual({
    is_permissive: true,
    cmd: "r",
    roles: ["authenticated"],
    qual: "(annvero_is_management() OR annvero_can_access_company(company_id))",
  });
  assert.equal(recoveryOr.ok, false, "recovery A OR B must fail");

  const wrongOrder = validateIndexModel(
    {
      table_name: "recovery_restore_approvals",
      columns: ["table_name", "company_id", "record_id"],
      is_unique: true,
      predicate: "executed IS TRUE",
      column_dirs: ["ASC", "ASC", "ASC"],
      indisvalid: true,
      indisready: true,
    },
    {
      table_name: "recovery_restore_approvals",
      columns: ["company_id", "table_name", "record_id"],
      is_unique: true,
      pred_exact_norm: "(executedistrue)",
      column_dirs: ["ASC", "ASC", "ASC"],
    }
  );
  assert.equal(wrongOrder.ok, false, "wrong index column order must fail");

  // Substring-matching but different predicate MUST FAIL exact validator
  const substrPred = validateIndexModel(
    {
      table_name: "annvero_company_members",
      columns: ["user_id"],
      is_unique: false,
      predicate: "(is_active IS NULL OR deleted_at IS NULL)", // contains is_active but wrong
      column_dirs: ["ASC"],
      indisvalid: true,
      indisready: true,
    },
    {
      table_name: "annvero_company_members",
      columns: ["user_id"],
      is_unique: false,
      pred_exact_norm: "(is_active=true)",
      column_dirs: ["ASC"],
    }
  );
  assert.equal(substrPred.ok, false, "substring-matching but different predicate must fail");

  const wrongPred = validateIndexModel(
    {
      table_name: "annvero_company_members",
      columns: ["user_id"],
      is_unique: false,
      predicate: "(deleted_at IS NULL)",
      indisvalid: true,
      indisready: true,
    },
    {
      table_name: "annvero_company_members",
      columns: ["user_id"],
      is_unique: false,
      pred_exact_norm: "(is_active=true)",
    }
  );
  assert.equal(wrongPred.ok, false, "wrong partial predicate must fail");

  const wrongDir = validateIndexModel(
    {
      table_name: "recovery_restore_approvals",
      columns: ["company_id", "created_at"],
      is_unique: false,
      predicate: null,
      column_dirs: ["ASC", "ASC"], // should be ASC, DESC
      indisvalid: true,
      indisready: true,
    },
    {
      table_name: "recovery_restore_approvals",
      columns: ["company_id", "created_at"],
      is_unique: false,
      pred_exact_norm: null,
      column_dirs: ["ASC", "DESC"],
    }
  );
  assert.equal(wrongDir.ok, false, "wrong index sort direction must fail");

  const noCompany = validateExecutedUniqueIndex({
    table_name: "recovery_restore_approvals",
    columns: ["table_name", "record_id"],
    is_unique: true,
    predicate: "executed IS TRUE",
    column_dirs: ["ASC", "ASC"],
    indisvalid: true,
    indisready: true,
  });
  assert.equal(noCompany.ok, false, "executed unique without company_id must fail");

  // Missing privilege combination overlooked
  const missingPriv = validatePrivilegeModel({
    forbidPublicLeak: true,
    requiredFalse: [
      { role: "authenticated", priv: "TRUNCATE" },
      { role: "service_role", priv: "TRUNCATE" },
    ],
    requiredTrue: [{ role: "service_role", priv: "SELECT" }],
    privileges: {
      PUBLIC: {},
      authenticated: { SELECT: false, INSERT: false }, // TRUNCATE omitted
      service_role: { SELECT: true, INSERT: true }, // TRUNCATE omitted
    },
  });
  assert.equal(missingPriv.ok, false, "missing privilege combination overlooked must fail");

  const publicLeak = validatePrivilegeModel({
    forbidPublicLeak: true,
    privileges: { PUBLIC: { SELECT: true } },
  });
  assert.equal(publicLeak.ok, false, "PUBLIC privilege leak must fail");

  const auditWrite = validatePrivilegeModel({
    auditAppendOnly: true,
    privileges: {
      service_role: { SELECT: true, INSERT: true, UPDATE: true, TRUNCATE: true },
    },
  });
  assert.equal(auditWrite.ok, false, "service_role UPDATE/TRUNCATE on audit must fail");

  // Wrong recovery FK definition
  const wrongFk = validateFkModel(
    {
      contype: "f",
      table_name: "recovery_restore_approvals",
      conf_schema: "public",
      conf_table: "companies",
      src_cols: ["company_id"],
      tgt_cols: ["id"],
      confdeltype: "c", // cascade — wrong; must be restrict 'r'
      convalidated: true,
    },
    {
      table_name: "recovery_restore_approvals",
      conf_schema: "public",
      conf_table: "companies",
      src_cols: ["company_id"],
      tgt_cols: ["id"],
      confdeltype: "r",
    }
  );
  assert.equal(wrongFk.ok, false, "wrong recovery FK definition must fail");

  // Wrong CHECK constraint
  const wrongCheck = validateCheckConstraint(
    {
      contype: "c",
      table_name: "recovery_restore_approvals",
      check_expr: "CHECK (company_id IS NOT NULL)",
      convalidated: true,
    },
    {
      table_name: "recovery_restore_approvals",
      check_expr: "CHECK (btrim(company_id) <> '')",
    }
  );
  assert.equal(wrongCheck.ok, false, "wrong CHECK constraint must fail");

  // Correct name, wrong trigger table/function
  const wrongTg = validateTriggerModel(
    {
      trigger_name: "trg_cloud_connections_updated_at",
      table_name: "document_index", // wrong table
      function_signature: "public.annvero_company_members_set_updated_at()", // wrong fn
      trigger_def:
        "CREATE TRIGGER trg_cloud_connections_updated_at BEFORE UPDATE ON public.document_index FOR EACH ROW EXECUTE FUNCTION public.annvero_company_members_set_updated_at()",
      tgenabled: "O",
    },
    {
      trigger_name: "trg_cloud_connections_updated_at",
      table_name: "cloud_storage_connections",
      function_signature: "public.cloud_storage_set_updated_at()",
      timing_event: "BEFORE UPDATE",
    }
  );
  assert.equal(wrongTg.ok, false, "correct name wrong trigger table/function must fail");

  // MANUAL_REVIEW present but summary READY
  const mrReady = validateSummaryReadiness({
    mr022: true,
    mr023: false,
    summary022: "READY",
    summary023: "MISSING",
    summary024: "READY",
    applied024: false,
    applied025: false,
  });
  assert.equal(mrReady.ok, false, "MANUAL_REVIEW present but summary READY must fail");

  // Missing 024 object but applied024=true
  const miss024 = validateSummaryReadiness({
    mr022: false,
    mr023: false,
    summary022: "MANUAL_REVIEW",
    summary023: "MANUAL_REVIEW",
    summary024: "MANUAL_REVIEW",
    applied024: true,
    required024: [true, true, false], // one missing
    applied025: false,
  });
  assert.equal(miss024.ok, false, "Missing 024 object but applied024=true must fail");

  // Missing 025 index but applied025=true
  const miss025 = validateSummaryReadiness({
    mr022: false,
    mr023: false,
    summary022: "MANUAL_REVIEW",
    summary023: "MANUAL_REVIEW",
    summary024: "MANUAL_REVIEW",
    applied024: false,
    applied025: true,
    required025: [true, false, true, true], // one missing
  });
  assert.equal(miss025.ok, false, "Missing 025 index but applied025=true must fail");

  // 1500ms must not truncate to 1000ms (integer division)
  assert.equal(windowMsToIntervalSeconds(1500), 1.5, "1500ms → 1.5s precision");
  assert.notEqual(Math.trunc(1500 / 1000), 1.5, "integer trunc loses precision");
  assert.equal((1500 / 1000.0), 1.5);

  // Rate-limit count overflow — bigint intermediate saturates at limit+1
  assert.equal(saturateRateLimitCount(5, 5), 6, "at limit saturates to limit+1");
  assert.equal(saturateRateLimitCount(100, 5), 6, "overflow saturates at limit+1");
  assert.equal(saturateRateLimitCount(0, 5), 1);
  assert.equal(
    saturateRateLimitCount(2147483647, 5),
    6,
    "INT_MAX count must not overflow; saturates to limit+1"
  );

  // indoption fixture: [0,1] + ordinality [1,2] → ASC,DESC; off-by-one must fail
  {
    const opts = [0, 1];
    const ords = [1, 2];
    const paired = dirsFromIndoptionPaired(opts, ords);
    const buggy = dirsFromIndoptionOffByOne(opts, ords);
    assert.deepEqual(paired, ["ASC", "DESC"], "paired unnest must yield ASC,DESC");
    assert.notDeepEqual(buggy, ["ASC", "DESC"], "off-by-one algorithm must NOT yield ASC,DESC");
    assert.deepEqual(buggy, ["DESC", "ASC"], "off-by-one skips first opt");
  }

  // Helper rejects DESC same-name index
  assert.equal(validateEnsureIndexDirs(["ASC", "ASC"], 2).ok, true);
  assert.equal(validateEnsureIndexDirs(["ASC", "DESC"], 2).ok, false, "DESC key must be rejected");

  // Wrong-column CHECK with correct name must fail
  {
    const wrongCol = validateNonemptyCheck(
      {
        conname: "recovery_restore_approvals_company_id_nonempty",
        table_name: "recovery_restore_approvals",
        contype: "c",
        convalidated: true,
        src_cols: ["table_name"], // wrong column
        check_expr_norm: "check(btrim(table_name)<>'')",
      },
      {
        conname: "recovery_restore_approvals_company_id_nonempty",
        table_name: "recovery_restore_approvals",
        src_cols: ["company_id"],
      }
    );
    assert.equal(wrongCol.ok, false, "correct name + wrong column CHECK must fail");
  }

  // Per-object applied024/025: each missing required object → applied=false
  {
    const req024 = [
      "rate_limit_table",
      "rate_limit_pk",
      "rate_limit_reset_idx",
      "rate_limit_rpc",
      "audit_request_id",
      "audit_result",
      "audit_request_idx",
      "nine_restrictive_policies",
      "recovery_cols",
      "recovery_pk",
      "recovery_fks",
      "recovery_checks",
      "recovery_indexes",
      "recovery_select_and",
      "helper_execute",
    ];
    for (let i = 0; i < req024.length; i++) {
      const flags = req024.map((_, j) => j !== i);
      const r = validateSummaryReadiness({
        mr022: false,
        mr023: false,
        summary022: "MANUAL_REVIEW",
        summary023: "MANUAL_REVIEW",
        summary024: "MANUAL_REVIEW",
        applied024: true,
        required024: flags,
        applied025: false,
      });
      assert.equal(r.ok, false, `missing 024 object ${req024[i]} must force applied024=false`);
    }
    const req025 = [
      "idx_user_active",
      "idx_company_active",
      "idx_audit_company",
      "idx_recovery_record",
      "helper_execute",
      "privilege_matrix",
      "policies",
    ];
    for (let i = 0; i < req025.length; i++) {
      const flags = req025.map((_, j) => j !== i);
      const r = validateSummaryReadiness({
        mr022: false,
        mr023: false,
        summary022: "MANUAL_REVIEW",
        summary023: "MANUAL_REVIEW",
        summary024: "ALREADY_APPLIED",
        applied024: true,
        required024: req024.map(() => true),
        applied025: true,
        required025: flags,
      });
      assert.equal(r.ok, false, `missing 025 object ${req025[i]} must force applied025=false`);
    }
  }

  const badPath = validateRateLimitSearchPath("pg_catalog, public, pg_temp");
  assert.equal(badPath.ok, false, "rate-limit search_path with public must fail");

  const helperSvc = validateHelperExecute({
    execute: {
      public: false,
      anon: false,
      authenticated: false,
      service_role: true,
    },
  });
  assert.equal(helperSvc.ok, false, "helper with service_role EXECUTE must fail");

  const badBounds = validateRateLimitBounds({ limit: 0, window_ms: 100 });
  assert.equal(badBounds.ok, false, "rate-limit limit/window out of bounds must fail");
}
console.log("OK — all negative fixtures rejected");

section("0b) Positive fixtures (validators must accept)");
{
  assert.equal(
    validateDenyPolicy({
      is_permissive: false,
      cmd: "a",
      roles: ["authenticated"],
      qual: null,
      with_check: "false",
    }).ok,
    true
  );
  assert.equal(
    validateRecoverySelectQual({
      is_permissive: true,
      cmd: "r",
      roles: ["authenticated"],
      qual: "(public.annvero_is_management() AND public.annvero_can_access_company(company_id))",
    }).ok,
    true
  );
  assert.equal(
    validateExecutedUniqueIndex({
      table_name: "recovery_restore_approvals",
      columns: ["company_id", "table_name", "record_id"],
      is_unique: true,
      predicate: "(executed IS TRUE)",
      column_dirs: ["ASC", "ASC", "ASC"],
      indisvalid: true,
      indisready: true,
    }).ok,
    true
  );
  assert.equal(
    validateIndexModel(
      {
        table_name: "recovery_restore_approvals",
        columns: ["company_id", "created_at"],
        is_unique: false,
        predicate: null,
        column_dirs: ["ASC", "DESC"],
        indisvalid: true,
        indisready: true,
      },
      {
        table_name: "recovery_restore_approvals",
        columns: ["company_id", "created_at"],
        is_unique: false,
        pred_exact_norm: null,
        column_dirs: ["ASC", "DESC"],
      }
    ).ok,
    true
  );
  assert.equal(
    validateFkModel(
      {
        contype: "f",
        table_name: "recovery_restore_approvals",
        conf_schema: "public",
        conf_table: "companies",
        src_cols: ["company_id"],
        tgt_cols: ["id"],
        confdeltype: "r",
        convalidated: true,
      },
      {
        table_name: "recovery_restore_approvals",
        conf_schema: "public",
        conf_table: "companies",
        src_cols: ["company_id"],
        tgt_cols: ["id"],
        confdeltype: "r",
      }
    ).ok,
    true
  );
  assert.equal(
    validateCheckConstraint(
      {
        contype: "c",
        table_name: "recovery_restore_approvals",
        check_expr: "CHECK (btrim(company_id) <> '')",
        convalidated: true,
      },
      {
        table_name: "recovery_restore_approvals",
        check_expr: "CHECK (btrim(company_id) <> '')",
      }
    ).ok,
    true
  );
  assert.equal(
    validateTriggerModel(
      {
        trigger_name: "trg_cloud_connections_updated_at",
        table_name: "cloud_storage_connections",
        function_signature: "public.cloud_storage_set_updated_at()",
        trigger_def:
          "CREATE TRIGGER trg_cloud_connections_updated_at BEFORE UPDATE ON public.cloud_storage_connections FOR EACH ROW EXECUTE FUNCTION public.cloud_storage_set_updated_at()",
        tgenabled: "O",
      },
      {
        trigger_name: "trg_cloud_connections_updated_at",
        table_name: "cloud_storage_connections",
        function_signature: "public.cloud_storage_set_updated_at()",
        timing_event: "BEFORE UPDATE",
      }
    ).ok,
    true
  );
  assert.equal(
    validateSummaryReadiness({
      mr022: true,
      mr023: true,
      summary022: "MANUAL_REVIEW",
      summary023: "MANUAL_REVIEW",
      summary024: "MANUAL_REVIEW",
      applied024: false,
      required024: [false, false],
      applied025: false,
      required025: [false],
    }).ok,
    true
  );
  assert.equal(
    validateSummaryReadiness({
      mr022: false,
      mr023: false,
      summary022: "READY",
      summary023: "READY",
      summary024: "READY",
      applied024: true,
      required024: [true, true, true],
      applied025: true,
      required025: [true, true, true, true],
    }).ok,
    true
  );
  assert.equal(validateRateLimitSearchPath("pg_catalog, pg_temp").ok, true);
  assert.equal(
    validateHelperExecute({
      execute: {
        public: false,
        anon: false,
        authenticated: false,
        service_role: false,
      },
    }).ok,
    true
  );
  assert.equal(validateRateLimitBounds({ limit: 100, window_ms: 60_000 }).ok, true);
  assert.equal(
    validatePrivilegeModel({
      forbidPublicLeak: true,
      auditAppendOnly: true,
      requiredFalse: [
        { role: "authenticated", priv: "TRUNCATE" },
        { role: "service_role", priv: "TRUNCATE" },
      ],
      requiredTrue: [
        { role: "service_role", priv: "SELECT" },
        { role: "service_role", priv: "INSERT" },
      ],
      privileges: {
        PUBLIC: {},
        authenticated: { TRUNCATE: false },
        service_role: { SELECT: true, INSERT: true, TRUNCATE: false },
      },
    }).ok,
    true
  );
}
console.log("OK");

// ---------------------------------------------------------------------------
// SQL file contracts
// ---------------------------------------------------------------------------
section("1) No DROP POLICY in 024/025; NO DROP FUNCTION in 025 (comments/strings stripped)");
assert.doesNotMatch(stripSqlCommentsAndStrings(sql024), /\bdrop\s+policy\b/i);
assert.doesNotMatch(stripSqlCommentsAndStrings(sql025), /\bdrop\s+policy\b/i);
assert.doesNotMatch(stripSqlCommentsAndStrings(sql025), /\bdrop\s+function\b/i);
console.log("OK");

section("2) Restrictive deny policies in 024 (AS RESTRICTIVE)");
assert.match(sql024, /as restrictive for insert/i);
assert.match(sql024, /as restrictive for update/i);
assert.match(sql024, /as restrictive for delete/i);
assert.match(sql024, /annvero_ensure_restrictive_deny_policy/);
assert.match(sql024, /with check \(false\)/i);
console.log("OK");

section("3) Client DML grants revoked in 024 (incl. TRUNCATE privilege text)");
for (const table of [
  "rate_limit_buckets",
  "audit_events",
  "login_events",
  "recovery_restore_approvals",
]) {
  assert.match(sql024, new RegExp(table, "i"));
}
assert.match(sql024, /revoke\s+(all|insert,\s*update,\s*delete)/i);
assert.match(sql024, /truncate,\s*references,\s*trigger/i);
assert.match(
  sql024,
  /revoke\s+truncate,\s*references,\s*trigger\s+on\s+table\s+public\.rate_limit_buckets\s+from\s+service_role/i
);
console.log("OK");

section("4) No comment on schema public in 025");
assert.doesNotMatch(sql025, /^\s*comment\s+on\s+schema\s+public\b/im);
console.log("OK");

section("5) members user_id only");
assert.match(sql025, /annvero_company_members\s*\(\s*user_id\s*\)/i);
assert.doesNotMatch(sql025, /annvero_company_members\s*\(\s*auth_user_id\s*\)/i);
assert.match(sql023, /\buser_id\s+uuid\s+not null/i);
console.log("OK");

section("6) Index column gating in 025");
assert.match(sql025, /annvero_ensure_index_if_columns/);
assert.match(sql025, /array\['user_id',\s*'is_active'\]/);
assert.match(sql025, /array\['company_id',\s*'deleted_at'\]/);
console.log("OK");

section("7) Recovery select uses management AND company access");
assert.match(sql024, /to_regprocedure\('public\.annvero_is_management\(\)'\)/);
assert.match(
  sql024,
  /to_regprocedure\('public\.annvero_can_access_company\(text\)'\)/
);
assert.match(
  sql024,
  /annvero_is_management\(\)[\s\S]*annvero_can_access_company\(company_id\)/
);
assert.doesNotMatch(
  sql024,
  /select 1 from pg_proc where proname = 'annvero_is_management'/i
);
console.log("OK");

section("8) Rate-limit atomic RPC — search_path, least saturation, window_ms precision");
assert.match(sql024, /annvero_rate_limit_consume\(text,\s*integer,\s*bigint\)/);
assert.match(sql024, /security definer/i);
assert.match(sql024, /set search_path\s*=\s*pg_catalog,\s*pg_temp/i);
assert.doesNotMatch(
  stripSqlCommentsAndStrings(sql024).match(
    /annvero_rate_limit_consume[\s\S]{0,400}set search_path\s*=\s*[^;]+/i
  )?.[0] || "",
  /\bpublic\b/i
);
assert.match(
  sql024,
  /least\s*\(\s*b\.count::bigint\s*\+\s*1\s*,\s*v_limit::bigint\s*\+\s*1\s*\)\s*::integer/i
);
assert.match(
  sql024,
  /interval\s+'1 second'\s*\*\s*\(\s*v_window_ms::double precision\s*\/\s*1000\.0\s*\)/i
);
assert.match(
  sql024,
  /revoke all on function public\.annvero_rate_limit_consume/i
);
assert.match(
  sql024,
  /grant execute[\s\S]*annvero_rate_limit_consume[\s\S]*service_role/i
);
assert.match(rateLimitSrc, /annvero_rate_limit_consume/);
assert.match(rateLimitSrc, /hashRateLimitBucketKey|createHash/);
assert.doesNotMatch(rateLimitSrc, /\.from\(["']rate_limit_buckets["']\)\s*\.select/);
assert.doesNotMatch(rateLimitSrc, /\.from\(["']rate_limit_buckets["']\)\s*\.update/);
assert.doesNotMatch(rateLimitSrc, /\.from\(["']rate_limit_buckets["']\)\s*\.upsert/);

assert.match(
  rateLimitSrc,
  /export function hashRateLimitBucketKey[\s\S]*createHash\([\"']sha256[\"']\)[\s\S]*digest\([\"']hex[\"']\)/
);
const h = createHash("sha256").update("route:ip:1.2.3.4", "utf8").digest("hex");
assert.equal(h.length, 64);
assert.match(h, /^[a-f0-9]{64}$/);
assert.notEqual(h, "route:ip:1.2.3.4");
console.log("OK — atomic RPC + SHA-256 bucket key (64 hex)");

section("9) Recovery approval uuid + tenant executed unique + company ASC/DESC + FK catalog");
assert.match(sql024, /approved_by uuid/i);
assert.match(sql024, /uq_recovery_restore_approvals_request_id/);
assert.match(sql024, /uq_recovery_restore_approvals_executed_record/);
assert.match(
  sql024,
  /uq_recovery_restore_approvals_executed_record[\s\S]*?\(\s*company_id\s*,\s*table_name\s*,\s*record_id\s*\)/i
);
assert.match(sql024, /where\s*\(?\s*executed\s+is\s+true\s*\)?/i);
assert.match(
  sql024,
  /idx_recovery_restore_approvals_company[\s\S]*?\(\s*company_id\s+asc\s*,\s*created_at\s+desc\s*\)/i
);
assert.match(sql024, /recovery_restore_approvals_company_id_fkey/);
assert.match(sql024, /recovery_restore_approvals_approved_by_fkey/);
assert.match(sql024, /confdeltype[\s\S]*'r'|v_deltype is distinct from 'r'/i);
assert.match(restore, /approved_by:\s*auditContext\.actorId/);
assert.doesNotMatch(restore, /approved_by:\s*auditContext\.actorEmail/);
console.log("OK");

section("10) Helpers revoke service_role EXECUTE; 025 revoke old overload; full 7-priv checks");
assert.match(
  sql024,
  /revoke all on function public\.annvero_ensure_restrictive_deny_policy[\s\S]*service_role/i
);
assert.match(
  sql024,
  /revoke all on function public\.annvero_assert_table_column[\s\S]*service_role/i
);
assert.match(
  sql025,
  /revoke all on function public\.annvero_ensure_index_if_columns[\s\S]*service_role/i
);
assert.match(
  sql025,
  /annvero_ensure_index_if_columns\(text,\s*text,\s*text,\s*text,\s*text\[\],\s*boolean,\s*text\)/
);
assert.match(sql025, /array\['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'\]/);
console.log("OK");

section("11) Preflight requirements (full catalog contract)");
assert.match(preflight, /security_invoker|reloptions/i);
assert.match(preflight, /polpermissive|is_permissive|RESTRICTIVE/i);
assert.match(preflight, /024_READY_TO_APPLY|025_READY_TO_APPLY/);
assert.match(preflight, /annvero_rate_limit_consume/);
assert.match(preflight, /has_table_privilege/);
assert.match(preflight, /TRUNCATE|truncate/i);
assert.match(preflight, /relkind\s*=\s*'v'|relkind = 'v'/);
assert.match(preflight, /pg_catalog,\s*pg_temp|pg_catalog,pg_temp/);
assert.match(preflight, /company_id.*table_name.*record_id|executed_record/);
assert.match(preflight, /READY_TO_REMEDIATE|MANUAL_REVIEW/);
assert.match(preflight, /indkey|array_agg\(a\.attname/);
assert.match(preflight, /indoption/);
assert.match(preflight, /unnest\(.*indoption\)[\s\S]*ordinality|join unnest\(.*indoption\)/i);
assert.doesNotMatch(
  stripSqlCommentsAndStrings(preflight),
  /\(ix\.indoption\)\s*\[\s*\w+\.ordinality\s*\]/
);
assert.match(preflight, /pg_get_triggerdef|tgfoid|tgenabled/);
assert.match(preflight, /public_constraints|confdeltype|convalidated/);
assert.match(preflight, /ASC.*DESC|column_dirs/);
assert.match(preflight, /pred_exact_norm|predicate_norm/);
assert.match(preflight, /harden_024|READY_TO_REMEDIATE/);
assert.match(preflight, /applied024|applied025/);
assert.match(preflight, /expected_dirs is null[\s\S]*ASC|coalesce\(\s*ie\.expected_dirs/i);
assert.match(preflight, /service_role/);
assert.match(preflight, /idx_cloud_connections_user[\s\S]*user_id.*provider|array\['user_id','provider'\]/);
assert.match(preflight, /do NOT require schema-qualified name inside pg_get_triggerdef|tgfoid\/signature is authoritative/i);
assert.doesNotMatch(
  stripSqlCommentsAndStrings(preflight),
  /^\s*(create|alter|insert|update|delete|drop|truncate|grant|revoke|do|call)\b/im
);
console.log("OK");

section("12) 024 helper refuses silent policy rewrite");
assert.match(sql024, /DROP POLICY yasak|manuel inceleme/i);
assert.match(sql024, /raise exception/i);
console.log("OK");

section("13) V4.1 indoption paired-unnest + CHECK column map + helper ASC");
assert.doesNotMatch(
  stripSqlCommentsAndStrings(sql024),
  /\(i\.indoption\)\s*\[\s*\w+\.ordinality\s*\]/
);
assert.doesNotMatch(
  stripSqlCommentsAndStrings(sql025),
  /\(i\.indoption\)\s*\[\s*\w+\.ordinality\s*\]/
);
assert.match(
  sql024,
  /unnest\(i\.indkey\)\s+with ordinality[\s\S]*unnest\(i\.indoption\)\s+with ordinality/i
);
assert.match(
  sql025,
  /unnest\(i\.indkey\)\s+with ordinality[\s\S]*unnest\(i\.indoption\)\s+with ordinality/i
);
assert.match(sql025, /indnkeyatts/);
assert.match(sql025, /yön uyumsuz|ASC-only/i);
assert.match(
  sql024,
  /recovery_restore_approvals_company_id_nonempty[\s\S]*company_id/
);
assert.match(
  sql024,
  /array\[r\.col\]|src_cols[\s\S]*company_id|conkey[\s\S]*r\.col/
);
assert.match(sql025, /CREATE sonrası|CREATE sonrasi/i);
console.log("OK");

section("14) V4.2 applied024/025 — real preflight SQL (helper_evaluated + columns)");
{
  const block024 = extractAppliedFlagSql(preflight, "024");
  const block025 = extractAppliedFlagSql(preflight, "025");

  assert.match(preflight, /helper_evaluated as\s*\(/i);
  assert.match(preflight, /Helpers are NOT in secdef_targets\/norm_path/i);

  const helperSrc = validateAppliedHelpersNotFromNormPath(block024, block025);
  assert.equal(helperSrc.ok, true, helperSrc.errors.join("; "));

  assert.match(
    block024,
    /annvero_ensure_restrictive_deny_policy[\s\S]*helper_evaluated|helper_evaluated[\s\S]*annvero_ensure_restrictive_deny_policy/i
  );
  assert.match(
    block024,
    /annvero_assert_table_column[\s\S]*helper_evaluated|helper_evaluated[\s\S]*annvero_assert_table_column/i
  );
  assert.match(
    block025,
    /annvero_ensure_index_if_columns\(text,text,text,text,text\[\],boolean,text\[\],boolean,text\)/
  );

  const tok024 = validateAppliedSqlTokens(block024, APPLIED024_REQUIRED_TOKENS);
  assert.equal(tok024.ok, true, `applied024 missing tokens: ${tok024.missing.join(", ")}`);
  const tok025 = validateAppliedSqlTokens(block025, APPLIED025_REQUIRED_TOKENS);
  assert.equal(tok025.ok, true, `applied025 missing tokens: ${tok025.missing.join(", ")}`);

  // Each required token omitted from a fixture copy → completeness fails
  for (const token of APPLIED024_REQUIRED_TOKENS) {
    const mutated = block024.split(token).join("");
    const r = validateAppliedSqlTokens(mutated, APPLIED024_REQUIRED_TOKENS);
    assert.equal(r.ok, false, `omitting applied024 token ${token} must fail`);
  }
  for (const token of APPLIED025_REQUIRED_TOKENS) {
    const mutated = block025.split(token).join("");
    const r = validateAppliedSqlTokens(mutated, APPLIED025_REQUIRED_TOKENS);
    assert.equal(r.ok, false, `omitting applied025 token ${token} must fail`);
  }

  // Explicit missing-column fixtures
  assert.equal(
    validateAppliedSqlTokens(block024.split("updated_at").join(""), APPLIED024_REQUIRED_TOKENS).ok,
    false,
    "missing updated_at → applied024 false"
  );
  assert.equal(
    validateAppliedSqlTokens(block024.split("dry_run_summary").join(""), APPLIED024_REQUIRED_TOKENS)
      .ok,
    false,
    "missing dry_run_summary → applied024 false"
  );
  assert.equal(
    validateAppliedSqlTokens(
      block024.split("annvero_ensure_restrictive_deny_policy").join(""),
      APPLIED024_REQUIRED_TOKENS
    ).ok,
    false,
    "missing helper → applied024 false"
  );
  assert.equal(
    validateAppliedSqlTokens(
      block025.split("annvero_ensure_index_if_columns(text,text,text,text,text[],boolean,text[],boolean,text)").join(""),
      APPLIED025_REQUIRED_TOKENS
    ).ok,
    false,
    "missing 9-arg helper → applied025 false"
  );

  // 024 migration fail-closed column asserts
  assert.match(
    sql024,
    /annvero_assert_table_column\('public',\s*'audit_events',\s*'request_id'/
  );
  assert.match(
    sql024,
    /annvero_assert_table_column\('public',\s*'audit_events',\s*'result'/
  );
  assert.match(
    sql024,
    /annvero_assert_table_column\('public',\s*'recovery_restore_approvals',\s*'dry_run_summary'/
  );
  assert.match(
    sql024,
    /annvero_assert_table_column\('public',\s*'recovery_restore_approvals',\s*'created_at'/
  );
  assert.match(
    sql024,
    /annvero_assert_table_column\('public',\s*'recovery_restore_approvals',\s*'id'/
  );
  assert.match(
    sql024,
    /annvero_assert_table_column\('public',\s*'rate_limit_buckets',\s*'updated_at'/
  );
}
console.log("OK");

section("15) V4.3 PUBLIC display label vs public privilege lookup");
{
  const ok = validatePublicPseudoRolePrivilegeLookup(preflight);
  assert.equal(ok.ok, true, ok.errors.join("; "));

  // Negative: uppercase PUBLIC passed directly to privilege function → fail
  const badLiteral = `
    grant_matrix as (
      select has_table_privilege('PUBLIC', 'public.t', 'SELECT') as can_select
      from (values ('PUBLIC'), ('anon')) as r(rolename)
    )
  `;
  assert.equal(
    validatePublicPseudoRolePrivilegeLookup(badLiteral).ok,
    false,
    "has_table_privilege('PUBLIC', ...) must fail"
  );

  // Negative: bare r.rolename (feeds PUBLIC) → fail
  const badDirect = `
    grant_matrix as (
      select
        r.rolename,
        has_table_privilege(r.rolename, 'public.t', 'SELECT') as can_select
      from (values ('PUBLIC'), ('anon')) as r(rolename)
    )
  `;
  assert.equal(
    validatePublicPseudoRolePrivilegeLookup(badDirect).ok,
    false,
    "has_table_privilege(r.rolename, ...) must fail"
  );

  // Positive fixture: display PUBLIC + lookup public via case
  const good = `
    grant_matrix as (
      select
        r.rolename,
        has_table_privilege(
          case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
          'public.t', 'SELECT'
        ) as can_select,
        has_table_privilege(
          case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
          'public.t', 'INSERT'
        ) as can_insert,
        has_table_privilege(
          case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
          'public.t', 'UPDATE'
        ) as can_update,
        has_table_privilege(
          case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
          'public.t', 'DELETE'
        ) as can_delete,
        has_table_privilege(
          case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
          'public.t', 'TRUNCATE'
        ) as can_truncate,
        has_table_privilege(
          case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
          'public.t', 'REFERENCES'
        ) as can_references,
        has_table_privilege(
          case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
          'public.t', 'TRIGGER'
        ) as can_trigger
      from (values ('PUBLIC'), ('anon')) as r(rolename)
    )
  `;
  assert.equal(
    validatePublicPseudoRolePrivilegeLookup(good).ok,
    true,
    "display PUBLIC + lookup public case must pass"
  );
}
console.log("OK");

section("16) V4.4 reconciliation — indexes, triggers, secdef, remediation");
{
  // Canonical composite index must not false-CONFLICT
  assert.equal(
    validateIndexModel(
      {
        table_name: "cloud_storage_connections",
        columns: ["user_id", "provider"],
        is_unique: false,
        predicate: null,
        column_dirs: ["ASC", "ASC"],
        indisvalid: true,
        indisready: true,
      },
      {
        table_name: "cloud_storage_connections",
        columns: ["user_id", "provider"],
        is_unique: false,
        pred_exact_norm: null,
        column_dirs: ["ASC", "ASC"],
      }
    ).ok,
    true,
    "canonical composite idx_cloud_connections_user must pass"
  );
  assert.equal(
    validateIndexModel(
      {
        table_name: "cloud_storage_connections",
        columns: ["provider", "user_id"],
        is_unique: false,
        predicate: null,
        column_dirs: ["ASC", "ASC"],
        indisvalid: true,
        indisready: true,
      },
      {
        table_name: "cloud_storage_connections",
        columns: ["user_id", "provider"],
        is_unique: false,
        pred_exact_norm: null,
        column_dirs: ["ASC", "ASC"],
      }
    ).ok,
    false,
    "wrong column order must fail"
  );

  // Trigger: bare function name in def OK when tgfoid signature matches
  assert.equal(
    validateTriggerModel(
      {
        trigger_name: "trg_cloud_connections_updated_at",
        table_name: "cloud_storage_connections",
        function_signature: "public.cloud_storage_set_updated_at()",
        trigger_def:
          "CREATE TRIGGER trg_cloud_connections_updated_at BEFORE UPDATE ON public.cloud_storage_connections FOR EACH ROW EXECUTE FUNCTION cloud_storage_set_updated_at()",
        tgenabled: "O",
      },
      {
        trigger_name: "trg_cloud_connections_updated_at",
        table_name: "cloud_storage_connections",
        function_signature: "public.cloud_storage_set_updated_at()",
        timing_event: "BEFORE UPDATE",
      }
    ).ok,
    true,
    "schema-unqualified deparser must not false-CONFLICT"
  );
  assert.equal(
    validateTriggerModel(
      {
        trigger_name: "trg_cloud_connections_updated_at",
        table_name: "cloud_storage_connections",
        function_signature: "public.wrong_fn()",
        trigger_def:
          "CREATE TRIGGER trg_cloud_connections_updated_at BEFORE UPDATE ON public.cloud_storage_connections FOR EACH ROW EXECUTE FUNCTION cloud_storage_set_updated_at()",
        tgenabled: "O",
      },
      {
        trigger_name: "trg_cloud_connections_updated_at",
        table_name: "cloud_storage_connections",
        function_signature: "public.cloud_storage_set_updated_at()",
        timing_event: "BEFORE UPDATE",
      }
    ).ok,
    false,
    "wrong tgfoid must fail"
  );

  assert.equal(
    validateHardenedSecdef({
      prosecdef: true,
      search_path_norm: "pg_catalog,pg_temp",
      exec_public: true,
      exec_anon: false,
    }).ok,
    false,
    "PUBLIC EXECUTE open DEFINER must not be hardened"
  );
  assert.equal(
    validateHardenedSecdef({
      prosecdef: true,
      search_path_norm: "public,pg_temp",
      exec_public: false,
      exec_anon: false,
    }).ok,
    false,
    "search_path with public must not be hardened"
  );
  assert.equal(
    validateHardenedSecdef({
      prosecdef: true,
      search_path_norm: "pg_catalog,pg_temp",
      exec_public: false,
      exec_anon: false,
    }).ok,
    true
  );

  assert.equal(
    classifyRemediationStatus({ can024Fix: true, matchesHardened: false }),
    "READY_TO_REMEDIATE"
  );
  assert.equal(
    classifyRemediationStatus({ can024Fix: false, matchesHardened: false }),
    "CONFLICT"
  );
  assert.equal(
    classifyRemediationStatus({ can024Fix: true, matchesHardened: true }),
    "ALREADY_APPLIED"
  );

  // authenticated companies write must not be READY
  assert.equal(
    classifyRemediationStatus({
      can024Fix: true,
      matchesHardened: false,
      note: "companies select_plus_write",
    }),
    "READY_TO_REMEDIATE",
    "authenticated companies write → READY_TO_REMEDIATE (not READY)"
  );
  assert.notEqual(
    classifyRemediationStatus({ can024Fix: false, matchesHardened: false }),
    "READY_TO_REMEDIATE",
    "irreconcilable drift must stay CONFLICT"
  );

  // READY_TO_REMEDIATE must not block 024 summary READY
  assert.equal(
    validateSummaryReadiness({
      mr022: false,
      mr023: false,
      secdefStatuses: ["READY_TO_REMEDIATE"],
      summary022: "READY",
      summary023: "READY",
      summary024: "READY",
      applied024: false,
      required024: [false],
      applied025: false,
    }).ok,
    true,
    "READY_TO_REMEDIATE must allow 024 READY"
  );

  assert.match(sql024, /set search_path\s*=\s*pg_catalog,\s*pg_temp/);
  assert.match(sql024, /annvero_profile_role\(\)/);
  assert.match(sql024, /annvero_can_access_company\(target_company_id text\)/);
  assert.match(sql024, /security invoker[\s\S]*annvero_is_management|annvero_is_management[\s\S]*security invoker/i);
  assert.match(sql024, /annvero_assert_fn_contract/);
  assert.match(sql024, /companies[\s\S]*service_role/i);
  assert.match(preflight, /READY_TO_REMEDIATE/);
  assert.match(preflight, /array\['user_id','provider'\]/);
  assert.match(preflight, /array\['company_id','created_at'\].*ASC.*DESC|idx_document_sync_events_company[\s\S]*ASC','DESC'/);
}
console.log("OK");

section("17) V4.5 applied024 body/owner/companies false-green closure");
{
  const block024 = extractAppliedFlagSql(preflight, "024");
  const tok024 = validateAppliedSqlTokens(block024, APPLIED024_REQUIRED_TOKENS);
  assert.equal(tok024.ok, true, `applied024 missing V4.5 tokens: ${tok024.missing.join(", ")}`);

  for (const token of [
    "annvero_profile_role()",
    "annvero_is_management()",
    "body_hardened",
    "annvero_assert_fn_contract",
    "companies",
  ]) {
    const mutated = block024.split(token).join("");
    assert.equal(
      validateAppliedSqlTokens(mutated, APPLIED024_REQUIRED_TOKENS).ok,
      false,
      `removing ${token} from applied024 must fail`
    );
  }

  // classify hardened vs legacy vs unknown body
  assert.equal(
    classifyFnContractStatus({
      bodyHardened: true,
      bodyLegacy: true,
      pathOk: true,
      aclOk: true,
      ownerOk: true,
      typeOk: true,
      prosecdefOk: true,
    }),
    "ALREADY_APPLIED"
  );
  assert.equal(
    classifyFnContractStatus({
      bodyHardened: false,
      bodyLegacy: true,
      pathOk: false,
      aclOk: false,
      ownerOk: true,
      typeOk: true,
      prosecdefOk: true,
    }),
    "READY_TO_REMEDIATE"
  );
  assert.equal(
    classifyFnContractStatus({
      bodyHardened: false,
      bodyLegacy: false,
      pathOk: true,
      aclOk: true,
      ownerOk: true,
      typeOk: true,
      prosecdefOk: true,
    }),
    "CONFLICT",
    "unknown body must CONFLICT (not READY_TO_REMEDIATE)"
  );
  assert.equal(
    classifyFnContractStatus({
      bodyHardened: true,
      bodyLegacy: false,
      pathOk: true,
      aclOk: true,
      ownerOk: false,
      typeOk: true,
      prosecdefOk: true,
    }),
    "CONFLICT",
    "wrong owner must CONFLICT"
  );
  assert.equal(
    classifyFnContractStatus({
      bodyHardened: true,
      bodyLegacy: false,
      pathOk: true,
      aclOk: true,
      ownerOk: true,
      typeOk: false,
      prosecdefOk: true,
    }),
    "CONFLICT",
    "wrong return/type/lang/vol must CONFLICT"
  );
  assert.equal(
    classifyFnContractStatus({
      bodyHardened: true,
      bodyLegacy: false,
      pathOk: true,
      aclOk: true,
      ownerOk: true,
      typeOk: true,
      prosecdefOk: false,
      expectInvoker: true,
    }),
    "CONFLICT",
    "is_management DEFINER must CONFLICT"
  );

  assert.equal(
    validateCompaniesGrantMatrix({
      PUBLIC: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      anon: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      authenticated: { select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      service_role: { select: true, insert: true, update: true, delete: true, truncate: false, references: false, trigger: false },
    }).ok,
    true
  );
  assert.equal(
    validateCompaniesGrantMatrix({
      PUBLIC: { select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      anon: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      authenticated: { select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      service_role: { select: true, insert: true, update: true, delete: true, truncate: false, references: false, trigger: false },
    }).ok,
    false,
    "PUBLIC SELECT must fail"
  );
  assert.equal(
    validateCompaniesGrantMatrix({
      PUBLIC: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      anon: { select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      authenticated: { select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      service_role: { select: true, insert: true, update: true, delete: true, truncate: false, references: false, trigger: false },
    }).ok,
    false,
    "anon SELECT must fail"
  );
  assert.equal(
    validateCompaniesGrantMatrix({
      PUBLIC: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      anon: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      authenticated: { select: true, insert: true, update: false, delete: false, truncate: false, references: false, trigger: false },
      service_role: { select: true, insert: true, update: true, delete: true, truncate: false, references: false, trigger: false },
    }).ok,
    false,
    "authenticated write must fail"
  );
  assert.equal(
    validateCompaniesGrantMatrix({
      PUBLIC: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      anon: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      authenticated: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      service_role: { select: true, insert: true, update: true, delete: true, truncate: false, references: false, trigger: false },
    }).ok,
    false,
    "authenticated SELECT missing must fail"
  );
  assert.equal(
    validateCompaniesGrantMatrix({
      PUBLIC: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      anon: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      authenticated: { select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      service_role: { select: true, insert: true, update: true, delete: true, truncate: true, references: false, trigger: false },
    }).ok,
    false,
    "service_role TRUNCATE must fail"
  );

  assert.match(sql024, /annvero_assert_fn_contract/);
  assert.match(sql024, /owner_name|postgres/);
  assert.match(sql025, /annvero_assert_fn_contract/);
  assert.match(sql025, /025: companies/);
  assert.match(preflight, /fn_body_expect/);
  assert.match(preflight, /body_hardened/);
  assert.match(preflight, /annvero_assert_fn_contract/);
  assert.match(preflight, /position\('user_metadata'/);
}
console.log("OK");

section("18) V4.5.1 exact body equality + rate-limit canonical (no false-green)");
{
  const canon = `
  select public.annvero_jwt_role() in ('admin', 'partner', 'mudur');
`;
  assert.equal(bodiesExactEqual(canon, canon.replace(/\n/g, "\r\n")), true, "CRLF vs LF equal");
  assert.equal(bodiesExactEqual(canon, canon.replace("'admin'", "'ADMIN'")), false, "admin→ADMIN must differ");
  assert.equal(
    bodiesExactEqual(canon, canon.replace("'partner'", "'partner '")),
    false,
    "literal space change must differ"
  );
  assert.equal(
    bodiesExactEqual(canon, canon.replace("mudur", "Mudur")),
    false,
    "non-keyword casing in identifier/literal path must differ when in source"
  );

  const rateCanon = `
declare
  v_key text;
begin
  allowed := v_count <= v_limit;
  remaining := greatest(v_limit - v_count, 0);
  return next;
end;
`;
  assert.equal(
    bodiesExactEqual(rateCanon, rateCanon.replace("v_count <= v_limit", "v_count < v_limit")),
    false,
    "allowed account change must differ"
  );
  assert.equal(
    bodiesExactEqual(
      rateCanon,
      rateCanon.replace("greatest(v_limit - v_count, 0)", "greatest(v_limit - v_count, 1)")
    ),
    false,
    "remaining/reset-related change must differ"
  );

  // Markers alone must not decide equality
  const markedBad = rateCanon.replace("v_count <= v_limit", "true -- least( [a-f0-9]{64}");
  assert.equal(bodiesExactEqual(rateCanon, markedBad), false, "marker-preserving body edit must fail");

  assert.equal(usesForbiddenBodyFingerprint(preflight), false, "preflight must not use md5(lower(regexp_replace prosrc))");
  assert.equal(usesForbiddenBodyFingerprint(sql024), false, "024 must not use forbidden fingerprint");
  assert.equal(usesLiveSelfComparison(sql024), false, "024 must not self-compare live prosrc/result");
  assert.equal(usesLiveSelfComparison(sql025), false, "025 must not self-compare live prosrc/result");

  assert.match(sql024, /TABLE\(allowed boolean, current_count integer, reset_at timestamp with time zone, remaining integer\)/);
  assert.match(sql025, /TABLE\(allowed boolean, current_count integer, reset_at timestamp with time zone, remaining integer\)/);
  assert.match(preflight, /table\(allowedboolean,current_countinteger,reset_attimestampwithtimezone,remaininginteger\)/);
  assert.match(
    preflight,
    /annvero_assert_fn_contract\(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text\)/
  );
  assert.match(preflight, /annvero_rate_limit_consume\(text,integer,bigint\).*hardened|hardened[\s\S]*annvero_rate_limit_consume/);

  const block024 = extractAppliedFlagSql(preflight, "024");
  assert.equal(
    validateAppliedSqlTokens(block024, APPLIED024_REQUIRED_TOKENS).ok,
    true,
    "applied024 must include exact helper signature + rate return contract"
  );
  assert.equal(
    validateAppliedSqlTokens(
      block024.split('annvero_assert_fn_contract(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text)').join(""),
      APPLIED024_REQUIRED_TOKENS
    ).ok,
    false,
    "exact assert helper signature missing → applied024 tokens fail"
  );
  assert.equal(
    validateAppliedSqlTokens(
      block024.split("table(allowedboolean,current_countinteger,reset_attimestampwithtimezone,remaininginteger)").join(""),
      APPLIED024_REQUIRED_TOKENS
    ).ok,
    false,
    "return contract missing → applied024 tokens fail"
  );
  assert.match(block024, /body_hardened/);
  assert.doesNotMatch(block024, /rate_limit_body_ok/);
  assert.match(sql024, /replace\(coalesce\(p\.prosrc,\s*''\),\s*E'\\r\\n',\s*E'\\n'\)/);
}
console.log("OK");

section("19) V4.5.2 staging predicate false-positive fixtures");
{
  // Staging actual from V4.5.1 preflight (pg_get_expr)
  const stagingHash =
    "((file_hash IS NOT NULL) AND (file_hash <> ''::text) AND (parse_status <> 'soft_deleted'::text))";
  const stagingMembers = "is_active";

  assert.equal(matchesDocumentHashPredicate(stagingHash), true, "staging hash predicate → READY");
  assert.equal(
    normalizeDocumentHashPredicate(stagingHash),
    DOCUMENT_HASH_PRED_CANON
  );
  assert.equal(matchesMembersUserActivePredicate(stagingMembers), true, "staging is_active → READY");

  // Also accept compact staging-like form from user message
  assert.equal(
    matchesDocumentHashPredicate(
      "((file_hashisnotnull)and(file_hash<>''::text)and(parse_status<>'soft_deleted'::text))"
    ),
    true
  );

  // Negatives — hash
  assert.equal(
    matchesDocumentHashPredicate(
      "((file_hash IS NOT NULL) OR (file_hash <> ''::text) AND (parse_status <> 'soft_deleted'::text))"
    ),
    false,
    "OR must CONFLICT"
  );
  assert.equal(
    matchesDocumentHashPredicate(
      "((file_hash IS NOT NULL) AND (file_hash <> ''::text))"
    ),
    false,
    "missing parse_status atom must CONFLICT"
  );
  assert.equal(
    matchesDocumentHashPredicate(
      "((file_hash IS NOT NULL) AND (file_hash <> ''::text) AND (parse_status <> 'deleted'::text))"
    ),
    false,
    "soft_deleted value change must CONFLICT"
  );
  assert.equal(
    matchesDocumentHashPredicate(
      "((file_hash IS NOT NULL) AND (parse_status <> 'soft_deleted'::text))"
    ),
    false,
    "missing empty-string check must CONFLICT"
  );
  assert.equal(matchesDocumentHashPredicate(null), false, "null predicate must CONFLICT");

  // Negatives — members user
  assert.equal(matchesMembersUserActivePredicate("is_active = false"), false);
  assert.equal(matchesMembersUserActivePredicate("NOT is_active"), false);
  assert.equal(matchesMembersUserActivePredicate("is_active OR true"), false);
  assert.equal(matchesMembersUserActivePredicate(null), false);
  assert.equal(matchesMembersUserActivePredicate(""), false);

  assert.match(preflight, /file_hashisnotnullandfile_hash<>''''andparse_status<>''soft_deleted'''/);
  assert.match(preflight, /uq_document_index_company_hash[\s\S]*::text/);
  assert.match(preflight, /idx_annvero_company_members_user[\s\S]*'is_active'/);
}
console.log("OK");

section("20) V4.5.3 name[] vs text[] catalog cast (Postgres 42883)");
{
  // Negative: bare attname agg compared to text[] must be detected
  const bad = `
    select array_agg(a.attname order by u.ordinality)
    from pg_attribute a
    where true;
    if v_cols is distinct from array['id']::text[] then raise exception 'x'; end if;
  `;
  assert.equal(hasNameArrayEqualsTextArray(bad), true, "name[]=text[] pattern must be rejected");

  const explicitBad = `select array[]::name[] = array[]::text[]`;
  assert.equal(hasNameArrayEqualsTextArray(explicitBad), true, "explicit name[]=text[] must be rejected");

  assert.equal(
    hasNameArrayEqualsTextArray(sql024),
    false,
    "024 must not compare name[] to text[]"
  );
  assert.equal(
    hasNameArrayEqualsTextArray(sql025),
    false,
    "025 must not compare name[] to text[]"
  );

  const cast024 = validateAttnameTextCastForCatalog(sql024);
  assert.equal(cast024.ok, true, `024 catalog casts missing: ${cast024.missing.join(",")}`);
  // 025 is index-focused; require zero bare aggs + index path (not PK/CHECK/FK)
  assert.equal(
    hasNameArrayEqualsTextArray(sql025),
    false,
    "025 must not compare name[] to text[]"
  );
  assert.match(sql025, /indkey[\s\S]*array_agg\(a\.attname::text/);
  const bare025Only = [...sql025.matchAll(/array_agg\s*\(\s*a\.attname(?!\s*::\s*text)/gi)];
  assert.equal(bare025Only.length, 0, "025 bare attname agg must be zero");

  // Whole-file: every array_agg(a.attname must be ::text in migrations
  const bare024 = [...sql024.matchAll(/array_agg\s*\(\s*a\.attname(?!\s*::\s*text)/gi)];
  const bare025 = [...sql025.matchAll(/array_agg\s*\(\s*a\.attname(?!\s*::\s*text)/gi)];
  assert.equal(bare024.length, 0, "024 must have zero bare array_agg(a.attname)");
  assert.equal(bare025.length, 0, "025 must have zero bare array_agg(a.attname)");

  const castCount024 = [...sql024.matchAll(/array_agg\s*\(\s*a\.attname::text/gi)].length;
  const castCount025 = [...sql025.matchAll(/array_agg\s*\(\s*a\.attname::text/gi)].length;
  assert.equal(castCount024, 12, `024 expected 12 attname::text aggs, got ${castCount024}`);
  assert.equal(castCount025, 4, `025 expected 4 attname::text aggs, got ${castCount025}`);

  // Path coverage: PK, CHECK, FK, index
  assert.match(sql024, /array_agg\(a\.attname::text[\s\S]{0,500}indisprimary/);
  assert.match(sql024, /array_agg\(a\.attname::text[\s\S]{0,400}array\[r\.col\]::text\[\]/);
  assert.match(
    sql024,
    /unnest\(c\.conkey\)[\s\S]{0,200}a\.attname::text|a\.attname::text[\s\S]{0,200}unnest\(c\.conkey\)/
  );
  assert.match(
    sql024,
    /unnest\(c\.confkey\)[\s\S]{0,200}a\.attname::text|a\.attname::text[\s\S]{0,200}unnest\(c\.confkey\)/
  );
  assert.match(sql024, /indkey[\s\S]{0,400}array_agg\(a\.attname::text|array_agg\(a\.attname::text[\s\S]{0,200}indkey/);
  assert.match(sql025, /indkey[\s\S]{0,400}array_agg\(a\.attname::text|array_agg\(a\.attname::text[\s\S]{0,200}indkey/);

  const pf = validatePreflightNameArrayConsistency(preflight);
  assert.equal(pf.ok, true, pf.errors.join("; "));
  // Preflight keeps intentional name[] = name[] for applied024 PK
  assert.match(preflight, /array_agg\(a\.attname order by[\s\S]{0,250}=\s*array\['bucket_key'\]::name\[\]/);
}
console.log("OK");

section("21) V4.5.4 idx_audit_events_request_id predicate aliases (no false CONFLICT)");
{
  // READY — exact canonical forms (spaces stripped like predicate_norm)
  assert.equal(matchesAuditRequestIdPredicate("(request_id<>'')"), true);
  assert.equal(matchesAuditRequestIdPredicate("(request_id<>''::text)"), true);
  assert.equal(matchesAuditRequestIdPredicate("(request_id!='')"), true);
  assert.equal(matchesAuditRequestIdPredicate("(request_id!=''::text)"), true);
  assert.equal(
    matchesAuditRequestIdPredicate("(request_id <> ''::text)"),
    true,
    "whitespace form must normalize to READY"
  );

  // Staging fixture from V4.5.3 postflight
  const stagingPred = "(request_id<>''::text)";
  assert.equal(matchesAuditRequestIdPredicate(stagingPred), true, "staging ::text → READY");

  // CONFLICT negatives
  assert.equal(matchesAuditRequestIdPredicate("(request_id<>'x')"), false, "literal x must CONFLICT");
  assert.equal(
    matchesAuditRequestIdPredicate("(other_column<>'')"),
    false,
    "other column must CONFLICT"
  );
  assert.equal(
    matchesAuditRequestIdPredicate("(request_id is not null)"),
    false,
    "IS NOT NULL must CONFLICT"
  );
  assert.equal(
    matchesAuditRequestIdPredicate("(request_id<>'' OR true)"),
    false,
    "OR must CONFLICT"
  );
  assert.equal(
    matchesAuditRequestIdPredicate("(request_id<>''::varchar)"),
    false,
    "::varchar must CONFLICT"
  );
  assert.equal(
    matchesAuditRequestIdPredicate("(request_id<>'' AND true)"),
    false,
    "extra expression must CONFLICT"
  );
  assert.equal(
    matchesAuditRequestIdPredicate("request_id<>''"),
    false,
    "missing parens / bare substring must CONFLICT"
  );
  assert.equal(matchesAuditRequestIdPredicate(null), false);
  assert.equal(matchesAuditRequestIdPredicate(""), false);

  // Preflight: both detail + applied024 use same exact IN list (not old regex)
  assert.equal(
    preflight.includes("request_id(<>|!="),
    false,
    "old request_id regex must be removed"
  );
  const lists = extractAuditRequestIdInLists(preflight);
  assert.equal(lists.length, 2, `expected detail+applied024 IN lists, got ${lists.length}`);
  for (const [i, body] of lists.entries()) {
    assert.equal(
      auditRequestIdInListHasExactAliases(body),
      true,
      `IN list ${i} missing exact aliases`
    );
  }
  // No global ::text strip for this index path
  assert.equal(
    /idx_audit_events_request_id[\s\S]{0,400}replace\([\s\S]{0,120}::text/.test(preflight),
    false,
    "must not globally strip ::text for audit request_id"
  );
}
console.log("OK");

console.log("\nMigration contract 020–025: ALL PASSED");
