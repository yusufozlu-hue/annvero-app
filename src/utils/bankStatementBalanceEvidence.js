/**
 * Statement-level bank balance evidence for canonical snapshots.
 *
 * Rules:
 * - Only from real reconcile/parser output or verified same-source metadata
 * - Never invent matched from 4/4 accounting or debit≈credit alone
 * - null ≠ 0 (zero is valid evidence)
 * - Do not backfill fake BALANCE_MATCHED onto old empty snapshots
 */

import {
  BALANCE_EMPTY,
  BALANCE_EVIDENCE_MISSING,
  BALANCE_MATCHED,
  BALANCE_MISMATCH,
  MISSING_CLOSING_BALANCE,
  MISSING_OPENING_BALANCE,
} from "@/src/utils/bankBalanceReconcile";

export const STATEMENT_BALANCE_EVIDENCE_VERSION = "sbe/1.0.0";
export const STATEMENT_BALANCE_EVIDENCE_KEY = "statementBalanceEvidence";

const KNOWN_CODES = new Set([
  BALANCE_MATCHED,
  BALANCE_MISMATCH,
  BALANCE_EVIDENCE_MISSING,
  MISSING_OPENING_BALANCE,
  MISSING_CLOSING_BALANCE,
  BALANCE_EMPTY,
]);

const TRUSTED_EVIDENCE_SOURCES = new Set([
  "explicit_label",
  "running_balance",
  "hints",
  "canonical_snapshot",
  "verified_source_metadata",
  "parser_reconcile",
]);

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeText(value, max = 80) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

function sanitizeEvidenceSide(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = sanitizeText(raw.source, 40);
  const out = {};
  if (source) out.source = source;
  const page = finiteOrNull(raw.sourcePage ?? raw.source_page);
  const line = finiteOrNull(raw.sourceLine ?? raw.source_line ?? raw.sourceRow);
  const confidence = finiteOrNull(raw.confidence);
  if (page != null) out.sourcePage = page;
  if (line != null) out.sourceLine = line;
  if (confidence != null) out.confidence = confidence;
  return Object.keys(out).length ? out : null;
}

/**
 * @returns {object|null} Durable evidence blob, or null if incomplete/untrusted
 */
export function buildStatementBalanceEvidenceFromReconcile(
  balance = null,
  {
    currency = "TRY",
    extractedAt = null,
    sourceRevision = null,
    contentHash = null,
    evidenceSourceOverride = null,
  } = {}
) {
  if (!balance || typeof balance !== "object") return null;

  const openingBalance = finiteOrNull(
    balance.openingBalance ?? balance.opening
  );
  const closingBalance = finiteOrNull(
    balance.closingBalance ?? balance.closing
  );
  // Require both sides — incomplete evidence must not be persisted as matched
  if (openingBalance == null || closingBalance == null) return null;

  const code = sanitizeText(balance.code || balance.balanceCode, 48);
  if (!code || !KNOWN_CODES.has(code)) return null;
  if (code === BALANCE_EVIDENCE_MISSING || code === BALANCE_EMPTY) return null;

  const delta = finiteOrNull(balance.delta);
  const calculatedClosing = finiteOrNull(
    balance.expectedClosing ??
      balance.calculatedClosing ??
      balance.computedClosingBalance
  );
  const credits = finiteOrNull(balance.credits);
  const debits = finiteOrNull(balance.debits);
  const evidenceSource = sanitizeText(
    evidenceSourceOverride ||
      balance.evidenceSource ||
      balance.source ||
      "parser_reconcile",
    64
  );
  if (
    evidenceSource &&
    !TRUSTED_EVIDENCE_SOURCES.has(evidenceSource) &&
    evidenceSource !== "parser_reconcile"
  ) {
    // Still allow unknown parser labels that look non-fabricated
    if (!/^[a-z0-9_]{3,40}$/i.test(evidenceSource)) return null;
  }

  const matched =
    code === BALANCE_MATCHED &&
    (balance.matched === true || balance.balanceMatched === true);

  return {
    openingBalance,
    closingBalance,
    calculatedClosing,
    delta,
    matched: matched === true,
    code,
    evidenceSource: evidenceSource || "parser_reconcile",
    evidenceVersion: STATEMENT_BALANCE_EVIDENCE_VERSION,
    currency: sanitizeText(currency || "TRY", 8).toUpperCase() || "TRY",
    extractedAt: sanitizeText(
      extractedAt || balance.extractedAt || new Date().toISOString(),
      40
    ),
    sourceRevision:
      sourceRevision == null
        ? finiteOrNull(balance.sourceRevision)
        : finiteOrNull(sourceRevision),
    contentHash: sanitizeText(
      contentHash || balance.contentHash || "",
      128
    ),
    credits,
    debits,
    openingEvidence: sanitizeEvidenceSide(balance.openingEvidence),
    closingEvidence: sanitizeEvidenceSide(balance.closingEvidence),
  };
}

/**
 * Sanitize an evidence blob (from safeSummary / recovery). Preserves 0.
 */
export function sanitizeStatementBalanceEvidence(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return buildStatementBalanceEvidenceFromReconcile(
    {
      openingBalance: raw.openingBalance ?? raw.opening_balance,
      closingBalance: raw.closingBalance ?? raw.closing_balance,
      expectedClosing:
        raw.calculatedClosing ??
        raw.calculated_closing ??
        raw.expectedClosing,
      delta: raw.delta ?? raw.balanceDelta ?? raw.balance_delta,
      matched: raw.matched === true || raw.balanceMatched === true,
      code: raw.code || raw.balanceCode || raw.balance_code,
      evidenceSource:
        raw.evidenceSource || raw.evidence_source || raw.source,
      openingEvidence: raw.openingEvidence || raw.opening_evidence,
      closingEvidence: raw.closingEvidence || raw.closing_evidence,
      credits: raw.credits,
      debits: raw.debits,
      extractedAt: raw.extractedAt || raw.extracted_at,
      sourceRevision: raw.sourceRevision ?? raw.source_revision,
      contentHash: raw.contentHash || raw.content_hash,
    },
    {
      currency: raw.currency || "TRY",
      extractedAt: raw.extractedAt || raw.extracted_at,
      sourceRevision: raw.sourceRevision ?? raw.source_revision,
      contentHash: raw.contentHash || raw.content_hash,
      evidenceSourceOverride:
        raw.evidenceSource || raw.evidence_source || null,
    }
  );
}

export function extractStatementBalanceEvidenceFromSafeSummary(
  safeSummary = {}
) {
  if (!safeSummary || typeof safeSummary !== "object") return null;
  return sanitizeStatementBalanceEvidence(
    safeSummary[STATEMENT_BALANCE_EVIDENCE_KEY] ||
      safeSummary.statement_balance_evidence ||
      null
  );
}

export function mergeStatementBalanceEvidenceIntoSafeSummary(
  safeSummary = {},
  evidence = null
) {
  const base =
    safeSummary && typeof safeSummary === "object" && !Array.isArray(safeSummary)
      ? { ...safeSummary }
      : {};
  const sanitized = sanitizeStatementBalanceEvidence(evidence);
  if (!sanitized) return base;
  return {
    ...base,
    [STATEMENT_BALANCE_EVIDENCE_KEY]: sanitized,
  };
}

/**
 * Binding check for recovery — same company/source/revision/contentHash.
 */
export function assertBalanceEvidenceRecoveryBinding({
  expected = {},
  candidate = {},
} = {}) {
  const expCompany = sanitizeText(expected.companyId || expected.company_id, 80);
  const candCompany = sanitizeText(
    candidate.companyId || candidate.company_id,
    80
  );
  if (!expCompany || !candCompany || expCompany !== candCompany) {
    return { ok: false, code: "COMPANY_MISMATCH" };
  }

  const expSource = sanitizeText(expected.sourceId || expected.source_id, 80);
  const candSource = sanitizeText(candidate.sourceId || candidate.source_id, 80);
  if (expSource && candSource && expSource !== candSource) {
    return { ok: false, code: "SOURCE_MISMATCH" };
  }

  const expHash = sanitizeText(
    expected.contentHash || expected.content_hash,
    128
  );
  const candHash = sanitizeText(
    candidate.contentHash || candidate.content_hash,
    128
  );
  if (expHash && candHash && expHash !== candHash) {
    return { ok: false, code: "CONTENT_HASH_MISMATCH" };
  }

  const expRev = finiteOrNull(expected.revision ?? expected.sourceRevision);
  const candRev = finiteOrNull(
    candidate.revision ?? candidate.sourceRevision
  );
  if (expRev != null && candRev != null && expRev !== candRev) {
    return { ok: false, code: "REVISION_MISMATCH" };
  }

  return { ok: true, code: "BINDING_OK" };
}

/**
 * Recover evidence only when binding matches and candidate is sanitized.
 * Never fabricates 0/0 or BALANCE_MATCHED from accounting counts.
 */
export function recoverStatementBalanceEvidence({
  expectedBinding = {},
  candidateBinding = {},
  candidateEvidence = null,
} = {}) {
  const binding = assertBalanceEvidenceRecoveryBinding({
    expected: expectedBinding,
    candidate: candidateBinding,
  });
  if (!binding.ok) {
    return { ok: false, code: binding.code, evidence: null };
  }
  const evidence = sanitizeStatementBalanceEvidence(candidateEvidence);
  if (!evidence) {
    return { ok: false, code: "EVIDENCE_INVALID", evidence: null };
  }
  // Mark recovery provenance without inventing amounts
  return {
    ok: true,
    code: "RECOVERED",
    evidence: {
      ...evidence,
      evidenceSource:
        evidence.evidenceSource === "verified_source_metadata"
          ? evidence.evidenceSource
          : "verified_source_metadata",
    },
  };
}

/**
 * Hints for reconcileStatementBalances from durable evidence.
 */
export function balanceEvidenceToReconcileHints(evidence = null) {
  const sanitized = sanitizeStatementBalanceEvidence(evidence);
  if (!sanitized) {
    return {
      openingBalance: null,
      closingBalance: null,
      source: null,
      openingEvidence: null,
      closingEvidence: null,
    };
  }
  return {
    openingBalance: sanitized.openingBalance,
    closingBalance: sanitized.closingBalance,
    source: sanitized.evidenceSource || "canonical_snapshot",
    openingEvidence: sanitized.openingEvidence,
    closingEvidence: sanitized.closingEvidence,
  };
}

/**
 * Resolve hydrate balance input: prefer canonical evidence, else empty hints.
 * Does not invent matched from movement nets alone.
 */
export function resolveHydrateBalanceFromCanonical({
  safeSummary = null,
  recoveredEvidence = null,
  movements = [],
  reconcileFn,
} = {}) {
  const fromSummary = extractStatementBalanceEvidenceFromSafeSummary(
    safeSummary || {}
  );
  const evidence = fromSummary || sanitizeStatementBalanceEvidence(recoveredEvidence);
  const hints = balanceEvidenceToReconcileHints(evidence);
  const reconcile =
    typeof reconcileFn === "function"
      ? reconcileFn
      : null;
  if (!reconcile) {
    return {
      evidence,
      hints,
      balance: null,
    };
  }
  const balance = reconcile(movements || [], hints);
  return { evidence, hints, balance };
}
