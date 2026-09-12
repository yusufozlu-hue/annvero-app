/**
 * Faz 4A — log redaction + payload/audit parity.
 * Run: npm run test:fis-kontrol-log-redaction
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REDACTED,
  redactDeep,
  toSafeOperationalDetail,
  safeErrorMessage,
  safeConsoleError,
  resolveSafeErrorCode,
  safeUiMessageForCode,
  isSensitiveKey,
} from "@/src/lib/security/redact.js";
import { normalizeDetailForTests } from "@/src/utils/systemLogEngine.js";
import { buildSafeLearningMemoryPayload } from "@/src/utils/learningMemorySafePayload.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MARKERS = {
  vkn: "SYNTH_VKN_1234567890",
  iban: "TR330006100519786457841326",
  name: "SYNTH_PERSON_AYSE_YILMAZ",
  company: "SYNTH_FIRMA_MARE_AS",
  file: "SYNTH_FILE_ekstre_gizli.xlsx",
  desc: "SYNTH_DESC_HAVALE_ACIKLAMA",
  amount: 12345.67,
};

/** origin/main redactDeep (secret-only) — audit parity baseline. */
function baseRedactDeep(value, { depth = 0, maxDepth = 6 } = {}) {
  if (value == null) return value;
  if (depth > maxDepth) return "[TRUNCATED]";
  if (typeof value === "string") {
    let text = String(value ?? "");
    text = text.replace(
      /\b(sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,})\b/gi,
      REDACTED
    );
    if (text.length > 500) return `${text.slice(0, 500)}…`;
    return text;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) =>
      baseRedactDeep(item, { depth: depth + 1, maxDepth })
    );
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = baseRedactDeep(child, { depth: depth + 1, maxDepth });
    }
    return out;
  }
  return String(value);
}

function auditSanitize(value) {
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

function baseAuditSanitize(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  try {
    return baseRedactDeep(JSON.parse(JSON.stringify(value)));
  } catch {
    return { value: String(value) };
  }
}

function pass(cond, label) {
  assert.ok(cond, label);
  console.log(`PASS  ${label}`);
}

function assertNoMarkers(text, label) {
  const hay = String(text || "");
  for (const [key, marker] of Object.entries(MARKERS)) {
    pass(!hay.includes(String(marker)), `${label}: no ${key} marker`);
  }
}

console.log("1) redactDeep = secret-only (audit/export safe); operational = allowlist");
{
  const fixture = {
    password: "secret123",
    token: "abc",
    raw_description: MARKERS.desc,
    amount: MARKERS.amount,
    account_code: "102.01.001",
    cari_name: MARKERS.name,
    company_id: "co-a",
    vkn: MARKERS.vkn,
    iban: MARKERS.iban,
    ok: "visible",
  };
  const deep = redactDeep(fixture);
  pass(deep.password === REDACTED, "redactDeep secrets password");
  pass(deep.token === REDACTED, "redactDeep secrets token");
  pass(deep.raw_description === MARKERS.desc, "redactDeep keeps raw_description");
  pass(deep.amount === MARKERS.amount, "redactDeep keeps amount");
  pass(deep.account_code === "102.01.001", "redactDeep keeps account_code");
  pass(deep.cari_name === MARKERS.name, "redactDeep keeps cari_name");
  pass(deep.company_id === "co-a", "redactDeep keeps company_id");
  pass(deep.ok === "visible", "redactDeep keeps ok");

  const ops = toSafeOperationalDetail({
    code: "FIS_KONTROL_RISK_SUMMARY",
    stage: "ANALYZING",
    hataCount: 2,
    raw_description: MARKERS.desc,
    amount: MARKERS.amount,
    companyId: "co-a",
    stack: MARKERS.desc,
  });
  pass(ops.code === "FIS_KONTROL_RISK_SUMMARY", "ops code");
  pass(ops.hataCount === 2, "ops count");
  pass(ops.raw_description == null && ops.amount == null, "ops drops financial");
  assertNoMarkers(JSON.stringify(ops), "ops markers");
}

console.log("2) learning-memory persistence payload parity (business path)");
{
  const requestRecord = {
    companyId: "co-parity",
    raw_description: MARKERS.desc,
    account_code: "320.01.001",
    account_name: MARKERS.name,
    amount: MARKERS.amount,
    cari_name: MARKERS.company,
    document_type: "DK",
    keyword: "HAVALE",
    password: "should-not-be-a-column",
    token: "nope",
  };
  const before = buildSafeLearningMemoryPayload(requestRecord);
  const after = buildSafeLearningMemoryPayload(requestRecord);
  pass(
    JSON.stringify(before) === JSON.stringify(after),
    "buildSafeLearningMemoryPayload deterministic"
  );
  pass(before.raw_description === MARKERS.desc, "LM raw_description preserved");
  pass(before.amount === MARKERS.amount, "LM amount preserved");
  pass(before.account_code === "320.01.001", "LM account_code preserved");
  pass(before.cari_name === MARKERS.company, "LM cari_name preserved");
  pass(before.password == null && before.token == null, "LM drops non-columns");

  // Error/log path must not contain markers
  const logView = toSafeOperationalDetail({
    code: "LEARNING_MEMORY_CREATE_FAILED",
    raw_description: MARKERS.desc,
    amount: MARKERS.amount,
  });
  assertNoMarkers(JSON.stringify(logView), "LM log view");
  pass(
    safeErrorMessage(new Error(`db ${MARKERS.desc}`)) === "İşlem başarısız." ||
      !String(safeErrorMessage(new Error(`db ${MARKERS.desc}`))).includes(MARKERS.desc),
    "LM error message has no desc marker"
  );
}

console.log("3) audit afterState parity vs origin/main redactDeep");
{
  const afterState = {
    id: "lm-1",
    company_id: "co-a",
    raw_description: MARKERS.desc,
    amount: MARKERS.amount,
    account_code: "102.01.037",
    cari_name: MARKERS.name,
    password: "should-redact",
    access_token: "tok",
  };
  const basePayload = baseAuditSanitize(afterState);
  const fasePayload = auditSanitize(afterState);
  pass(
    JSON.stringify(basePayload) === JSON.stringify(fasePayload),
    "audit sanitizeState byte-identical to base secret-only redactDeep"
  );
  pass(fasePayload.raw_description === MARKERS.desc, "audit keeps raw_description");
  pass(fasePayload.amount === MARKERS.amount, "audit keeps amount");
  pass(fasePayload.password === REDACTED, "audit redacts password");
  pass(fasePayload.access_token === REDACTED, "audit redacts access_token");

  const route = fs.readFileSync(
    path.join(root, "app/api/learning-memory/route.js"),
    "utf8"
  );
  pass(/afterState:\s*data/.test(route), "writeAuditEvent afterState: data unchanged");
  pass(!/toSafeOperationalDetail\(data\)/.test(route), "afterState not run through ops allowlist");
}

console.log("4) systemLogEngine normalizeDetail fail-closed");
{
  const norm = normalizeDetailForTests({
    code: "PARSER_FAILED",
    stage: "PARSER",
    hataCount: 1,
    stack: MARKERS.desc,
    description: MARKERS.desc,
    rows: [{ aciklama: MARKERS.desc }],
  });
  assertNoMarkers(norm, "syslog normalize");
  pass(norm.includes("PARSER_FAILED"), "syslog keeps code");
  pass(norm.includes('"hataCount":1'), "syslog keeps count");

  const circular = { code: "WORKER_TIMEOUT" };
  circular.self = circular;
  const circ = normalizeDetailForTests(circular);
  pass(circ.includes("WORKER_TIMEOUT"), "circular keeps code");
  assertNoMarkers(circ, "circular syslog");

  const grouped = normalizeDetailForTests({
    grouped: true,
    count: 4,
    code: "FIS_KONTROL_RISK_SUMMARY",
    sample: MARKERS.desc,
  });
  pass(grouped.includes('"count":4'), "syslog keeps count");
  pass(grouped.includes('"grouped":true'), "syslog keeps grouped");
  assertNoMarkers(grouped, "grouped sample dropped");
}

console.log("5) source contracts");
{
  const mapper = fs.readFileSync(
    path.join(root, "src/utils/bankMovementMapper.js"),
    "utf8"
  );
  pass(/code:\s*"BANK_ROW_MAP_FAILED"/.test(mapper), "mapper code-only console");
  pass(!/console\.error\([\s\S]{0,160}description,/.test(mapper), "mapper no description log");

  const page = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/fis-kontrol/page.jsx"),
    "utf8"
  );
  pass(page.includes("FIS_KONTROL_RISK_SUMMARY"), "page risk code");
  pass(!/technicalDetail:\s*highRisk\.slice/.test(page), "no issue.message dump");

  const parserLog = fs.readFileSync(
    path.join(root, "src/utils/parserJobLogger.js"),
    "utf8"
  );
  pass(!parserLog.includes("error?.stack"), "no stack in parser logger");

  const worker = fs.readFileSync(
    path.join(root, "src/workers/fisKontrol.worker.js"),
    "utf8"
  );
  pass(worker.includes("FIS_KONTROL_ANALYZE_FAILED"), "worker allowlist");
  pass(!/error:\s*error\?\.message/.test(worker), "worker no raw message");

  const bridge = fs.readFileSync(
    path.join(root, "src/utils/workerParserBridge.js"),
    "utf8"
  );
  pass(bridge.includes("safeUiMessageForCode"), "bridge safe UI");
  pass(bridge.includes("safeConsoleError"), "bridge safe console");
  pass(bridge.includes("resolveWorkerProtocolCode"), "bridge preserves protocol codes");

  const redactSrc = fs.readFileSync(path.join(root, "src/lib/security/redact.js"), "utf8");
  pass(/ANALYZE_WORKER_FAILED/.test(redactSrc), "ANALYZE codes in operational allowlist");
  pass(
    /redactDeep[\s\S]{0,400}isSensitiveKey\(key\)/.test(redactSrc) &&
      !/redactDeepInner[\s\S]{0,500}isFinancialPiiKey/.test(redactSrc),
    "redactDeep does not call isFinancialPiiKey"
  );
}

console.log("6) safeConsoleError markers");
{
  const lines = [];
  const orig = console.error;
  console.error = (...args) => {
    lines.push(args.map((a) => JSON.stringify(a)).join(" "));
  };
  try {
    safeConsoleError("test", new Error(MARKERS.desc), {
      code: "LEARNING_MEMORY_FETCH_FAILED",
      description: MARKERS.desc,
    });
  } finally {
    console.error = orig;
  }
  pass(lines.length === 1, "one console line");
  assertNoMarkers(lines.join("\n"), "safeConsoleError");
  pass(
    resolveSafeErrorCode({ code: "HACK" }) === "UNEXPECTED_ERROR",
    "unknown code fail-closed"
  );
  pass(safeUiMessageForCode("FIS_KONTROL_TIMEOUT").length > 0, "UI message mapped");
}

console.log("ALL fis-kontrol log redaction + parity tests passed.");
