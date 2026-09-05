/**
 * accountingDecision zarf güven sınırı — PII yok, circular-import-safe.
 * Facade / LM / V2 bu modülü paylaşır.
 */

export const ACCOUNTING_DECISION_SCHEMA_VERSION = 1;

export const ACCOUNTING_DECISION_TRUSTED_SOURCES = Object.freeze([
  "DOCUMENT_ONLY",
  "EXACT_ACCOUNT",
  "BANK_PRODUCT_CURRENCY",
  "USER_LEARNED",
  "SYSTEM_RULE",
  "NONE",
]);

export const ACCOUNTING_DECISION_TRUSTED_STAGES = Object.freeze([
  "bank_materialize",
  "output_facade",
  "manual_edit",
  "fis_kontrol",
]);

function compactCode(value = "") {
  return String(value || "").trim().replace(/\s+/g, "");
}

function text(value = "") {
  return value == null ? "" : String(value).trim();
}

/** Deterministik FNV-1a 32-bit hex — PII taşımaz. */
export function fingerprintDecisionParts(parts = []) {
  let hash = 0x811c9dc5;
  const payload = parts.map((p) => String(p ?? "")).join("\u001f");
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (`00000000${(hash >>> 0).toString(16)}`).slice(-8);
}

export function computeAccountingDecisionSignature(decision = {}) {
  return fingerprintDecisionParts([
    ACCOUNTING_DECISION_SCHEMA_VERSION,
    text(decision.source).toUpperCase(),
    compactCode(decision.accountCode),
    compactCode(decision.counterAccountCode),
    text(decision.lucaLeg).toLowerCase(),
    text(decision.scopeKey),
    text(decision.companyId),
    decision.requiresReview ? "1" : "0",
    decision.matched ? "1" : "0",
    text(decision.resolvedAtStage),
  ]);
}

export function sanitizeAccountingDecisionFields(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const source = text(raw.source).toUpperCase();
  const safeSource = ACCOUNTING_DECISION_TRUSTED_SOURCES.includes(source)
    ? source
    : "NONE";
  const lucaLegRaw = text(raw.lucaLeg).toLowerCase();
  const lucaLeg =
    lucaLegRaw === "statement" || lucaLegRaw === "bank"
      ? "statement"
      : lucaLegRaw === "counter"
        ? "counter"
        : lucaLegRaw || null;

  const envelope = {
    schemaVersion: Number(raw.schemaVersion) || ACCOUNTING_DECISION_SCHEMA_VERSION,
    matched: Boolean(raw.matched) && Boolean(compactCode(raw.accountCode)) && !raw.requiresReview,
    accountCode: compactCode(raw.accountCode) || null,
    counterAccountCode: compactCode(raw.counterAccountCode) || null,
    source: safeSource,
    scopeKey: text(raw.scopeKey).slice(0, 120) || null,
    companyId: text(raw.companyId || raw.firmaId).slice(0, 80) || null,
    confidence: Math.max(0, Math.min(100, Number(raw.confidence) || 0)),
    requiresReview: Boolean(raw.requiresReview),
    reason: text(raw.reason).slice(0, 160) || (raw.requiresReview ? "review_required" : ""),
    lucaLeg,
    resolvedAtStage: text(raw.resolvedAtStage).slice(0, 64) || null,
  };
  envelope.decisionSignature = computeAccountingDecisionSignature(envelope);
  return envelope;
}

function lucaLegConsistentWithAccount(decision, row = {}) {
  const leg = text(decision.lucaLeg).toLowerCase();
  const code = compactCode(decision.accountCode || row.hesapKodu);
  if (!leg) return false;
  if (leg === "statement") {
    // statement bacığı genelde 102.*; boş hesap review zarfında tutarlı sayılır
    if (!code) return Boolean(decision.requiresReview);
    return /^102(\.|$)/.test(code) || Boolean(row.manuallyEdited);
  }
  if (leg === "counter") {
    if (!code) return Boolean(decision.requiresReview);
    // counter 102 olabilir (virman); statement bank kodundan farklıysa OK
    return true;
  }
  return false;
}

/**
 * Skip yalnız doğrulanmış zarf için.
 * @returns {{ ok: boolean, reason: string, decision: object|null }}
 */
export function validateAccountingDecisionTrust(row = null, context = {}) {
  if (!row || typeof row !== "object") {
    return { ok: false, reason: "no_row", decision: null };
  }

  const expectedCompany = text(
    context.companyId || context.firmaId || row.firmaId || ""
  );

  // Manuel satır: zarf yoksa henüz skip etme (facade damgalasın); zarf varsa doğrula
  const rawDecision = row.accountingDecision;
  if (!rawDecision || typeof rawDecision !== "object") {
    if (row.manuallyEdited && compactCode(row.hesapKodu)) {
      return { ok: false, reason: "manual_needs_signed_envelope", decision: null };
    }
    return { ok: false, reason: "missing_decision", decision: null };
  }

  // Unsupported / tampered fields must not be trusted via sanitize coercion alone
  const declaredVersion = Number(rawDecision.schemaVersion);
  if (
    Number.isFinite(declaredVersion) &&
    declaredVersion !== ACCOUNTING_DECISION_SCHEMA_VERSION
  ) {
    return { ok: false, reason: "unsupported_schema_version", decision: null };
  }

  const declaredSource = text(rawDecision.source).toUpperCase();
  if (
    declaredSource &&
    !ACCOUNTING_DECISION_TRUSTED_SOURCES.includes(declaredSource)
  ) {
    return { ok: false, reason: "unsupported_source", decision: null };
  }

  const decision = sanitizeAccountingDecisionFields(rawDecision);
  if (!decision) {
    return { ok: false, reason: "invalid_decision", decision: null };
  }

  if (decision.schemaVersion !== ACCOUNTING_DECISION_SCHEMA_VERSION) {
    return { ok: false, reason: "unsupported_schema_version", decision };
  }

  if (!ACCOUNTING_DECISION_TRUSTED_SOURCES.includes(decision.source)) {
    return { ok: false, reason: "unsupported_source", decision };
  }

  const stage = text(decision.resolvedAtStage);
  const manualOk = Boolean(row.manuallyEdited) && stage === "manual_edit";
  if (
    stage &&
    !ACCOUNTING_DECISION_TRUSTED_STAGES.includes(stage) &&
    !manualOk
  ) {
    return { ok: false, reason: "unsupported_stage", decision };
  }
  if (!stage && !row.manuallyEdited) {
    return { ok: false, reason: "missing_stage", decision };
  }

  const decisionCompany = text(decision.companyId);
  if (expectedCompany) {
    if (!decisionCompany) {
      return { ok: false, reason: "missing_decision_company", decision };
    }
    if (decisionCompany !== expectedCompany) {
      return { ok: false, reason: "tenant_mismatch", decision };
    }
  }
  if (decisionCompany && row.firmaId && text(row.firmaId) !== decisionCompany) {
    return { ok: false, reason: "row_tenant_mismatch", decision };
  }

  const recomputedSig = computeAccountingDecisionSignature({
    schemaVersion: ACCOUNTING_DECISION_SCHEMA_VERSION,
    matched: Boolean(rawDecision.matched) && Boolean(compactCode(rawDecision.accountCode)) && !rawDecision.requiresReview,
    accountCode: compactCode(rawDecision.accountCode) || null,
    counterAccountCode: compactCode(rawDecision.counterAccountCode) || null,
    source: ACCOUNTING_DECISION_TRUSTED_SOURCES.includes(text(rawDecision.source).toUpperCase())
      ? text(rawDecision.source).toUpperCase()
      : "NONE",
    scopeKey: text(rawDecision.scopeKey).slice(0, 120) || null,
    companyId: text(rawDecision.companyId || rawDecision.firmaId).slice(0, 80) || null,
    requiresReview: Boolean(rawDecision.requiresReview),
    lucaLeg:
      text(rawDecision.lucaLeg).toLowerCase() === "bank" ||
      text(rawDecision.lucaLeg).toLowerCase() === "statement"
        ? "statement"
        : text(rawDecision.lucaLeg).toLowerCase() === "counter"
          ? "counter"
          : text(rawDecision.lucaLeg).toLowerCase() || null,
    resolvedAtStage: text(rawDecision.resolvedAtStage).slice(0, 64) || null,
  });
  if (
    text(rawDecision.decisionSignature) &&
    text(rawDecision.decisionSignature) !== recomputedSig
  ) {
    return { ok: false, reason: "signature_mismatch", decision };
  }

  const rowAccount = compactCode(row.hesapKodu);
  const decisionAccount = compactCode(decision.accountCode);
  if (decisionAccount && rowAccount && decisionAccount !== rowAccount) {
    return { ok: false, reason: "stale_account_code", decision };
  }
  if (decision.matched && decisionAccount && !rowAccount) {
    return { ok: false, reason: "incomplete_row_account", decision };
  }

  if (!lucaLegConsistentWithAccount(decision, row)) {
    return { ok: false, reason: "luca_leg_inconsistent", decision };
  }

  // requiresReview: skip alt-tier resolve (trust the review freeze)
  if (decision.requiresReview) {
    return { ok: true, reason: "requires_review_frozen", decision };
  }

  if (decision.matched && decisionAccount) {
    return { ok: true, reason: "matched_trusted", decision };
  }

  if (row.manuallyEdited && rowAccount && stage === "manual_edit") {
    return { ok: true, reason: "manual_trusted", decision };
  }

  return { ok: false, reason: "incomplete_decision", decision };
}

export function shouldSkipOutputResolveTrusted(row = null, context = {}) {
  return validateAccountingDecisionTrust(row, context).ok;
}
