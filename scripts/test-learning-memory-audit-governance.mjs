/**
 * Faz 4B — Learning Memory audit metadata allowlist.
 * Run: npm run test:learning-memory-audit-governance
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEARNING_MEMORY_AUDIT_SCHEMA_VERSION,
  buildLearningMemoryAuditState,
} from "@/src/lib/audit/learningMemoryAuditState.js";
import {
  redactDeep,
  REDACTED,
  toSafeOperationalDetail,
  safeErrorMessage,
  stripSecretsFromExportValue,
} from "@/src/lib/security/redact.js";
import { buildSafeLearningMemoryPayload } from "@/src/utils/learningMemorySafePayload.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MARKERS = {
  desc: "SYNTH_DESC_HAVALE_ACIKLAMA_4B",
  amount: 98765.43,
  cari: "SYNTH_CARI_MARE_AS",
  account: "102.01.037",
  accountName: "SYNTH_HESAP_VAKIF",
  iban: "TR330006100519786457841326",
  vkn: "SYNTH_VKN_1234567890",
  file: "SYNTH_FILE_ekstre.xlsx",
  keyword: "SYNTH_KEYWORD",
};

function pass(cond, label) {
  assert.ok(cond, label);
  console.log(`PASS  ${label}`);
}

function assertNoMarkers(haystack, label) {
  const text = typeof haystack === "string" ? haystack : JSON.stringify(haystack);
  for (const [key, marker] of Object.entries(MARKERS)) {
    pass(!String(text).includes(String(marker)), `${label}: no ${key}`);
  }
}

function countMarkers(haystack) {
  const text = typeof haystack === "string" ? haystack : JSON.stringify(haystack);
  let n = 0;
  for (const marker of Object.values(MARKERS)) {
    if (String(text).includes(String(marker))) n += 1;
  }
  return n;
}

/** Mirror of auditEvents.sanitizeState — local, no DB. */
function sanitizeState(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  try {
    return redactDeep(JSON.parse(JSON.stringify(value)));
  } catch {
    return { value: String(value) };
  }
}

console.log("1) POST audit metadata");
{
  const dbRow = {
    id: "lm-post-1",
    company_id: "co-client-spoof",
    status: "active",
    document_type: "DK",
    source_module: "fis-kontrol",
    raw_description: MARKERS.desc,
    amount: MARKERS.amount,
    cari_name: MARKERS.cari,
    account_code: MARKERS.account,
    account_name: MARKERS.accountName,
    keyword: MARKERS.keyword,
    bank_name: "SYNTH_BANK",
    user_correction: JSON.stringify({ iban: MARKERS.iban, vkn: MARKERS.vkn }),
    password: "should-never-reach-builder-as-authority",
  };
  const after = buildLearningMemoryAuditState(dbRow, {
    companyId: "co-server-a",
    entityId: "lm-post-1",
  });
  pass(after.schemaVersion === LEARNING_MEMORY_AUDIT_SCHEMA_VERSION, "POST schemaVersion");
  pass(after.entityId === "lm-post-1", "POST entityId from DB");
  pass(after.companyId === "co-server-a", "POST companyId server scope");
  pass(after.companyId !== "co-client-spoof", "POST ignores record.company_id for scope");
  pass(after.status === "active", "POST status");
  pass(after.documentType === "DK", "POST documentType");
  pass(after.sourceModule === "fis-kontrol", "POST sourceModule");
  pass(after.changedFields == null, "POST no changedFields");
  assertNoMarkers(after, "POST afterState");
  pass(countMarkers(after) === 0, "POST marker count 0");
}

console.log("2) PATCH audit metadata + changedFields");
{
  const dbRow = {
    id: "lm-patch-1",
    status: "active",
    document_type: "MM",
    source_module: "bank-parser",
    raw_description: MARKERS.desc,
    amount: MARKERS.amount,
    cari_name: MARKERS.cari,
  };
  const payloadKeys = ["clean_description", "account_code", "amount", "unknown_field", "cari_name"];
  const after = buildLearningMemoryAuditState(dbRow, {
    companyId: "co-server-b",
    entityId: "lm-patch-1",
    changedFields: payloadKeys,
  });
  pass(after.companyId === "co-server-b", "PATCH companyId");
  pass(Array.isArray(after.changedFields), "PATCH changedFields array");
  pass(
    JSON.stringify(after.changedFields) ===
      JSON.stringify(["account_code", "amount", "cari_name", "clean_description"]),
    "PATCH changedFields sorted allowlist names only"
  );
  pass(!after.changedFields.includes("unknown_field"), "PATCH drops unknown field names");
  pass(
    after.changedFields.every((name) => typeof name === "string"),
    "PATCH changedFields values are names not objects"
  );
  assertNoMarkers(after, "PATCH afterState");

  const again = buildLearningMemoryAuditState(dbRow, {
    companyId: "co-server-b",
    entityId: "lm-patch-1",
    changedFields: [...payloadKeys].reverse(),
  });
  pass(
    JSON.stringify(again.changedFields) === JSON.stringify(after.changedFields),
    "PATCH changedFields deterministic regardless of input order"
  );
}

console.log("3) forged authority cannot become audit authority");
{
  const forged = {
    id: "lm-x",
    company_id: "co-forged",
    userId: "user-forged",
    role: "admin",
    isAdmin: true,
    raw_description: MARKERS.desc,
  };
  const after = buildLearningMemoryAuditState(forged, {
    companyId: "co-real",
    entityId: "lm-x",
  });
  pass(after.companyId === "co-real", "forged company_id ignored");
  pass(!("userId" in after) && !("role" in after) && !("isAdmin" in after), "no authority fields");
  assertNoMarkers(after, "forged payload markers");
}

console.log("4) business payload parity (LM table path)");
{
  const input = {
    company_id: "co-a",
    raw_description: MARKERS.desc,
    amount: MARKERS.amount,
    cari_name: MARKERS.cari,
    account_code: MARKERS.account,
    account_name: MARKERS.accountName,
    keyword: MARKERS.keyword,
    document_type: "DK",
    password: "drop-me",
  };
  const business = buildSafeLearningMemoryPayload(input);
  pass(business.raw_description === MARKERS.desc, "LM keeps raw_description");
  pass(business.amount === MARKERS.amount, "LM keeps amount");
  pass(business.cari_name === MARKERS.cari, "LM keeps cari_name");
  pass(business.account_code === MARKERS.account, "LM keeps account_code");
  pass(business.password == null, "LM drops password column");

  const audit = buildLearningMemoryAuditState(
    { ...business, id: "lm-1", status: "active" },
    { companyId: "co-a", entityId: "lm-1" }
  );
  assertNoMarkers(audit, "audit vs business split");
}

console.log("5) builder does not mutate input");
{
  const record = {
    id: "lm-mut",
    status: "active",
    document_type: "DK",
    raw_description: MARKERS.desc,
    nested: { a: 1 },
  };
  const context = {
    companyId: "co-a",
    entityId: "lm-mut",
    changedFields: ["keyword", "amount"],
  };
  const beforeRec = JSON.stringify(record);
  const beforeCtx = JSON.stringify(context);
  buildLearningMemoryAuditState(record, context);
  pass(JSON.stringify(record) === beforeRec, "record not mutated");
  pass(JSON.stringify(context) === beforeCtx, "context not mutated");
}

console.log("6) unknown / circular / huge extras dropped");
{
  const circular = { id: "lm-c", status: "active", document_type: "DK" };
  circular.self = circular;
  circular.raw_description = MARKERS.desc;
  circular.huge = "X".repeat(20000) + MARKERS.desc;
  circular.error = new Error(MARKERS.desc);
  const after = buildLearningMemoryAuditState(circular, {
    companyId: "co-a",
    entityId: "lm-c",
    changedFields: ["raw_description", "not_a_column", MARKERS.desc],
  });
  pass(after.entityId === "lm-c", "circular still builds");
  pass(!("self" in after) && !("huge" in after) && !("error" in after), "extras dropped");
  // Field *names* in changedFields may include raw_description; marker values must not appear.
  pass(after.changedFields?.includes("raw_description") === true, "allowlisted name ok in changedFields");
  pass(!JSON.stringify(after).includes(MARKERS.desc), "desc marker not in audit JSON");
  pass(!JSON.stringify(after).includes("XXXX"), "huge blob not in audit");
}

console.log("7) sanitizeState + redactDeep Faz 4A parity on builder output");
{
  const slim = buildLearningMemoryAuditState(
    {
      id: "lm-s",
      status: "active",
      document_type: "DK",
      raw_description: MARKERS.desc,
      password: "secret",
    },
    { companyId: "co-a", entityId: "lm-s" }
  );
  const sanitized = sanitizeState(slim);
  pass(JSON.stringify(sanitized) === JSON.stringify(slim), "slim audit unchanged by sanitizeState");
  pass(!JSON.stringify(sanitized).includes(MARKERS.desc), "no desc after sanitize");

  const fat = {
    password: "x",
    access_token: "tok",
    raw_description: MARKERS.desc,
    amount: MARKERS.amount,
  };
  const deep = redactDeep(fat);
  pass(deep.password === REDACTED && deep.access_token === REDACTED, "redactDeep secrets");
  pass(deep.raw_description === MARKERS.desc && deep.amount === MARKERS.amount, "redactDeep keeps financial");
}

console.log("8) console/response marker surfaces");
{
  const ops = toSafeOperationalDetail({
    code: "LEARNING_MEMORY_CREATE_FAILED",
    raw_description: MARKERS.desc,
    amount: MARKERS.amount,
    stack: MARKERS.desc,
  });
  assertNoMarkers(ops, "ops detail");
  const msg = safeErrorMessage(new Error(`fail ${MARKERS.desc} ${MARKERS.iban}`));
  pass(!msg.includes(MARKERS.desc) && !msg.includes(MARKERS.iban), "safeErrorMessage");
}

console.log("9) audit fail-open + no recursion (source contract)");
{
  const route = fs.readFileSync(path.join(root, "app/api/learning-memory/route.js"), "utf8");
  pass(/void\s+writeAuditEvent\(/.test(route), "void writeAuditEvent fail-open");
  pass(
    /afterState:\s*buildLearningMemoryAuditState\(/.test(route),
    "afterState uses builder"
  );
  pass(!/afterState:\s*data\b/.test(route), "afterState no longer full data");
  const auditCalls = [...route.matchAll(/void\s+writeAuditEvent\(/g)];
  pass(auditCalls.length === 2, "exactly two void writeAuditEvent (POST+PATCH record)");
  pass(!/await\s+writeAuditEvent\(/.test(route), "no awaited audit (fail-open)");
  pass(!/writeAuditEvent\([\s\S]{0,200}writeAuditEvent\(/.test(route), "no recursive audit call nesting");
  const updatesLoop = route.slice(route.indexOf("for (const item of updates)"));
  const updatesUntilDelete = updatesLoop.split("export async function DELETE")[0];
  pass(!/writeAuditEvent/.test(updatesUntilDelete), "usage PATCH loop has no audit");
}

console.log("10) foreign tenant / forged — builder refuses client company as scope");
{
  const after = buildLearningMemoryAuditState(
    { id: "lm-f", company_id: "co-b", status: "active", document_type: "DK" },
    { companyId: "", entityId: "lm-f" }
  );
  pass(after.companyId == null, "empty context companyId omitted");
  pass(after.entityId === "lm-f", "entityId still set");
}

console.log("11) export/read compatibility — fat + slim after_state");
{
  const fatHistorical = {
    id: "ae-old",
    after_state: {
      raw_description: MARKERS.desc,
      amount: MARKERS.amount,
      password: "secret",
    },
  };
  const slimNew = {
    id: "ae-new",
    after_state: buildLearningMemoryAuditState(
      { id: "lm-1", status: "active", document_type: "DK" },
      { companyId: "co-a", entityId: "lm-1" }
    ),
  };
  const exported = [fatHistorical, slimNew].map((row) => stripSecretsFromExportValue(row));
  pass(exported.length === 2, "export tolerates both shapes");
  pass(
    exported[0].after_state.raw_description === MARKERS.desc &&
      exported[0].after_state.password_was_present === true,
    "fat historical row exportable; secrets stripped"
  );
  pass(exported[1].after_state.schemaVersion === LEARNING_MEMORY_AUDIT_SCHEMA_VERSION, "slim row exportable");
  pass(exported[1].after_state.raw_description == null, "slim has no raw_description");
}

console.log("12) duplicate/retry — builder idempotent");
{
  const row = { id: "lm-d", status: "active", document_type: "DK", source_module: "x" };
  const a = buildLearningMemoryAuditState(row, { companyId: "co-a", entityId: "lm-d" });
  const b = buildLearningMemoryAuditState(row, { companyId: "co-a", entityId: "lm-d" });
  pass(JSON.stringify(a) === JSON.stringify(b), "idempotent builder output");
}

console.log("ALL learning-memory audit governance tests passed.");
