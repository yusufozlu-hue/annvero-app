/**
 * ANNVERO V1 — güvenli kalıcı özet (audit_events).
 * Ham PDF/Excel/XML, token, fileId, IBAN, VKN, ekstre satırı YASAK.
 */

import { ANNVERO_V1_ENGINE_VERSION } from "@/src/utils/annveroV1Orchestration";

export const V1_AUDIT_ENTITY_TYPE = "annvero_v1_job";

export const V1_SAFE_METADATA_KEYS = Object.freeze([
  "engine_version",
  "job_id",
  "idempotency_key",
  "terminal_status",
  "checkpoint_phase",
  "movement_count",
  "luca_row_count",
  "auto_matched_count",
  "review_count",
  "passed",
  "warnings",
  "errors",
  "duplicate",
  "edefter_status",
  "edefter_code",
  "drive_archived",
  "drive_skipped",
  "can_auto_approve",
  "review_required",
  "luca_batch_count",
  "total_duration_ms",
  "parse_ms",
  "chain_ms",
  "content_hash_present",
  "balance_mismatch",
  "balance_code",
  "opening_balance",
  "closing_balance",
  "balance_delta",
  "expected_closing",
  "balance_evidence_source",
  "balance_resolution_applied",
  "balance_resolution_change_count",
  "balance_resolution_learned",
  "lease_id",
  "reanalyze",
  "revision",
  "revision_of",
  "supersedes_job_id",
  "account_plan_count",
  "resolved_missing_count",
  "truly_not_found_count",
]);

const FORBIDDEN_KEY_RE =
  /xml|zip|iban|vkn|mersis|token|secret|password|raw|content|drive.?file|file.?id|payload|body|document.?text|satir|row.?data|belge.?metin|ekstre|sheet|arraybuffer|base64/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeString(value, max = 240) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

function sanitizeNumber(value, fallback = 0) {
  if (value == null && fallback === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function assertNoRawV1Leak(payload) {
  const text = JSON.stringify(payload || {});
  const hits = [];
  if (/TR\d{2}\s?\d{4}/i.test(text)) hits.push("iban_like");
  if (/"fileId"|"file_id"|"access_token"|"refresh_token"/i.test(text)) {
    hits.push("token_or_file_id");
  }
  if (/data:application\/|base64,/i.test(text)) hits.push("binary_payload");
  if (hits.length) {
    const err = new Error(`V1 güvenli özet sızıntı riski: ${hits.join(",")}`);
    err.code = "V1_RAW_LEAK";
    throw err;
  }
  return true;
}

/**
 * Yalnız allowlist alanları.
 */
export function buildSafeV1PersistPayload({
  companyId = "",
  jobId = "",
  idempotencyKey = "",
  leaseId = "",
  summary = {},
  checkpointPhase = null,
} = {}) {
  const meta = {
    engine_version: ANNVERO_V1_ENGINE_VERSION,
    job_id: sanitizeString(jobId, 80),
    idempotency_key: sanitizeString(idempotencyKey, 480),
    lease_id: sanitizeString(leaseId, 80),
    terminal_status: sanitizeString(summary.terminalStatus || summary.terminal_status, 40),
    checkpoint_phase: sanitizeString(
      checkpointPhase || summary.checkpointPhase || "",
      40
    ),
    movement_count: sanitizeNumber(summary.movementCount ?? summary.movement_count),
    luca_row_count: sanitizeNumber(summary.lucaRowCount ?? summary.luca_row_count),
    auto_matched_count: sanitizeNumber(
      summary.autoMatchedCount ?? summary.auto_matched_count
    ),
    review_count: sanitizeNumber(summary.reviewCount ?? summary.review_count),
    passed: sanitizeNumber(summary.passed),
    warnings: sanitizeNumber(summary.warnings),
    errors: sanitizeNumber(summary.errors),
    duplicate: Boolean(summary.duplicate),
    edefter_status: sanitizeString(
      summary.edefterStatus || summary.edefter_status,
      40
    ),
    edefter_code: sanitizeString(summary.edefterCode || summary.edefter_code, 40),
    drive_archived: Boolean(summary.driveArchived ?? summary.drive_archived),
    drive_skipped: Boolean(summary.driveSkipped ?? summary.drive_skipped),
    can_auto_approve: Boolean(summary.canAutoApprove ?? summary.can_auto_approve),
    review_required: Boolean(summary.reviewRequired ?? summary.review_required),
    luca_batch_count: sanitizeNumber(
      summary.lucaBatchCount ?? summary.luca_batch_count
    ),
    total_duration_ms: sanitizeNumber(
      summary.totalDurationMs ?? summary.total_duration_ms
    ),
    parse_ms: sanitizeNumber(summary.parseMs ?? summary.parse_ms, null),
    chain_ms: sanitizeNumber(summary.chainMs ?? summary.chain_ms, null),
    content_hash_present: Boolean(
      summary.contentHashPresent ?? summary.content_hash_present
    ),
    balance_mismatch: Boolean(
      summary.balanceMismatch ?? summary.balance_mismatch
    ),
    balance_code: sanitizeString(
      summary.balanceCode || summary.balance_code || "",
      40
    ),
    // null ≠ 0 — gerçek 0,00 bakiyeyi sakla; yoksa alanı yazma
    opening_balance: sanitizeNumber(
      summary.openingBalance ?? summary.opening_balance,
      null
    ),
    closing_balance: sanitizeNumber(
      summary.closingBalance ?? summary.closing_balance,
      null
    ),
    balance_delta: sanitizeNumber(
      summary.balanceDelta ?? summary.delta ?? summary.balance_delta,
      null
    ),
    expected_closing: sanitizeNumber(
      summary.expectedClosing ??
        summary.calculatedClosing ??
        summary.expected_closing,
      null
    ),
    balance_evidence_source: sanitizeString(
      summary.balanceEvidenceSource ||
        summary.evidenceSource ||
        summary.balance_evidence_source ||
        "",
      64
    ),
    balance_resolution_applied: Boolean(
      summary.balanceResolutionApplied ?? summary.balance_resolution_applied
    ),
    balance_resolution_change_count: sanitizeNumber(
      summary.balanceResolutionChangeCount ??
        summary.balance_resolution_change_count
    ),
    balance_resolution_learned: Boolean(
      summary.balanceResolutionLearned ?? summary.balance_resolution_learned
    ),
    reanalyze: Boolean(summary.reanalyze),
    revision: sanitizeNumber(summary.revision, null),
    revision_of: sanitizeString(
      summary.revisionOf || summary.revision_of || "",
      80
    ),
    supersedes_job_id: sanitizeString(
      summary.supersedesJobId || summary.supersedes_job_id || "",
      80
    ),
    account_plan_count: sanitizeNumber(
      summary.accountPlanCount ?? summary.account_plan_count,
      null
    ),
    resolved_missing_count: sanitizeNumber(
      summary.resolvedMissingCount ?? summary.resolved_missing_count,
      null
    ),
    truly_not_found_count: sanitizeNumber(
      summary.trulyNotFoundCount ?? summary.truly_not_found_count,
      null
    ),
  };

  // null sayısal alanları temizle
  if (meta.parse_ms == null || Number.isNaN(meta.parse_ms)) delete meta.parse_ms;
  if (meta.chain_ms == null || Number.isNaN(meta.chain_ms)) delete meta.chain_ms;
  if (meta.revision == null || Number.isNaN(meta.revision) || !meta.reanalyze) {
    delete meta.revision;
  }
  if (!meta.revision_of) delete meta.revision_of;
  if (!meta.supersedes_job_id) delete meta.supersedes_job_id;
  if (!meta.reanalyze) delete meta.reanalyze;
  if (!meta.balance_mismatch) delete meta.balance_mismatch;
  if (!meta.balance_code) delete meta.balance_code;
  if (meta.opening_balance == null || Number.isNaN(meta.opening_balance)) {
    delete meta.opening_balance;
  }
  if (meta.closing_balance == null || Number.isNaN(meta.closing_balance)) {
    delete meta.closing_balance;
  }
  if (meta.balance_delta == null || Number.isNaN(meta.balance_delta)) {
    delete meta.balance_delta;
  }
  if (meta.expected_closing == null || Number.isNaN(meta.expected_closing)) {
    delete meta.expected_closing;
  }
  if (!meta.balance_evidence_source) delete meta.balance_evidence_source;
  if (!meta.balance_resolution_applied) {
    delete meta.balance_resolution_applied;
    delete meta.balance_resolution_change_count;
    delete meta.balance_resolution_learned;
  }
  if (meta.account_plan_count == null || Number.isNaN(meta.account_plan_count)) {
    delete meta.account_plan_count;
  }
  if (
    meta.resolved_missing_count == null ||
    Number.isNaN(meta.resolved_missing_count)
  ) {
    delete meta.resolved_missing_count;
  }
  if (
    meta.truly_not_found_count == null ||
    Number.isNaN(meta.truly_not_found_count)
  ) {
    delete meta.truly_not_found_count;
  }

  const payload = {
    company_id: sanitizeString(companyId, 80),
    entity_type: V1_AUDIT_ENTITY_TYPE,
    entity_id: sanitizeString(jobId || idempotencyKey, 120),
    action: "v1_job_persist",
    metadata: meta,
  };

  assertNoRawV1Leak(payload);
  return payload;
}

export function publicV1JobView(row = {}) {
  const meta = isPlainObject(row.metadata) ? row.metadata : {};
  const safeMeta = {};
  for (const key of V1_SAFE_METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(meta, key)) {
      if (FORBIDDEN_KEY_RE.test(key)) continue;
      safeMeta[key] = meta[key];
    }
  }
  return {
    id: row.id || null,
    companyId: row.company_id || row.companyId || "",
    createdAt: row.created_at || row.createdAt || null,
    entityType: V1_AUDIT_ENTITY_TYPE,
    metadata: safeMeta,
  };
}

export function sanitizeIncomingV1JobBody(body = {}) {
  const companyId = sanitizeString(body.companyId || body.company_id, 80);
  const jobId = sanitizeString(body.jobId || body.job_id, 80);
  const idempotencyKey = sanitizeString(
    body.idempotencyKey || body.idempotency_key,
    480
  );
  const leaseId = sanitizeString(body.leaseId || body.lease_id, 80);
  const summary = isPlainObject(body.summary) ? body.summary : {};
  // strip forbidden keys from summary aggressively
  const cleanedSummary = {};
  for (const [key, value] of Object.entries(summary)) {
    if (FORBIDDEN_KEY_RE.test(key)) continue;
    if (typeof value === "string") cleanedSummary[key] = sanitizeString(value);
    else if (typeof value === "number" && Number.isFinite(value)) {
      cleanedSummary[key] = value;
    } else if (typeof value === "boolean") cleanedSummary[key] = value;
  }
  return {
    companyId,
    jobId,
    idempotencyKey,
    leaseId,
    summary: cleanedSummary,
    checkpointPhase: sanitizeString(
      body.checkpointPhase || body.checkpoint_phase,
      40
    ),
    action: sanitizeString(body.action || "persist", 32),
    reanalyze: Boolean(body.reanalyze),
    revisionOf: sanitizeString(body.revisionOf || body.revision_of, 80),
    revision: sanitizeNumber(body.revision, null),
    supersedesJobId: sanitizeString(
      body.supersedesJobId || body.supersedes_job_id,
      80
    ),
  };
}
