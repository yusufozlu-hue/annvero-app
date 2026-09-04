/**
 * Faz 4 — Luca / Elektraweb çıktı tüketicileri için ortak muhasebe karar facade.
 *
 * Tek çözüm noktası: doğrulanmış accountingDecision zarfı varsa yeniden resolve yok.
 * Metadata yoksa merkezi resolveAccountingDecision en fazla bir kez çalışır.
 */

import {
  ACCOUNTING_DECISION_SOURCE,
  resolveAccountingDecision,
} from "@/src/utils/centralAccountingDecisionResolver";
import { ACCOUNTING_MEMORY_LUCA_LEG } from "@/src/utils/accountingMemoryV1";
import {
  ACCOUNTING_DECISION_SCHEMA_VERSION,
  sanitizeAccountingDecisionFields,
  computeAccountingDecisionSignature,
  validateAccountingDecisionTrust,
  shouldSkipOutputResolveTrusted,
} from "@/src/utils/accountingDecisionTrust";

export { ACCOUNTING_DECISION_SCHEMA_VERSION, computeAccountingDecisionSignature };
export {
  validateAccountingDecisionTrust,
  shouldSkipOutputResolveTrusted,
};

export const OUTPUT_RESOLVED_AT_STAGE = Object.freeze({
  BANK_MATERIALIZE: "bank_materialize",
  OUTPUT_FACADE: "output_facade",
  MANUAL_EDIT: "manual_edit",
  FIS_KONTROL: "fis_kontrol",
});

function compactCode(value = "") {
  return String(value || "").trim().replace(/\s+/g, "");
}

function text(value = "") {
  return value == null ? "" : String(value).trim();
}

function isSafeDecisionSource(source = "") {
  const s = String(source || "").trim().toUpperCase();
  return (
    s === ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY ||
    s === ACCOUNTING_DECISION_SOURCE.EXACT_ACCOUNT ||
    s === ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY ||
    s === ACCOUNTING_DECISION_SOURCE.USER_LEARNED ||
    s === ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE ||
    s === ACCOUNTING_DECISION_SOURCE.NONE
  );
}

export function sanitizeAccountingDecision(raw = null) {
  return sanitizeAccountingDecisionFields(raw);
}

export function computeDecisionSignature(decision = {}) {
  return computeAccountingDecisionSignature(decision);
}

export function buildAccountingDecisionEnvelope({
  matched = false,
  accountCode = null,
  counterAccountCode = null,
  source = ACCOUNTING_DECISION_SOURCE.NONE,
  scopeKey = null,
  companyId = null,
  confidence = 0,
  requiresReview = false,
  reason = "",
  lucaLeg = null,
  resolvedAtStage = OUTPUT_RESOLVED_AT_STAGE.OUTPUT_FACADE,
} = {}) {
  return sanitizeAccountingDecisionFields({
    schemaVersion: ACCOUNTING_DECISION_SCHEMA_VERSION,
    matched,
    accountCode,
    counterAccountCode,
    source,
    scopeKey,
    companyId,
    confidence,
    requiresReview,
    reason,
    lucaLeg,
    resolvedAtStage,
  });
}

export function hasFrozenAccountingDecision(row = null, context = {}) {
  return validateAccountingDecisionTrust(row, context).ok;
}

export function shouldSkipOutputResolve(row = null, context = {}) {
  return shouldSkipOutputResolveTrusted(row, context);
}

export function stampRowAccountingDecision(
  row = null,
  decision = null,
  {
    lucaLeg = null,
    resolvedAtStage = OUTPUT_RESOLVED_AT_STAGE.OUTPUT_FACADE,
    companyId = null,
  } = {}
) {
  if (!row || typeof row !== "object") return row;
  const envelope = sanitizeAccountingDecisionFields({
    ...decision,
    lucaLeg: lucaLeg || decision?.lucaLeg || null,
    resolvedAtStage: resolvedAtStage || decision?.resolvedAtStage || null,
    companyId:
      companyId ||
      decision?.companyId ||
      row.firmaId ||
      null,
  });
  if (!envelope) return row;

  const next = {
    ...row,
    accountingDecision: envelope,
  };

  if (envelope.requiresReview) {
    next.riskDurumu = next.riskDurumu || "INCELEME";
    if (
      envelope.reason &&
      !String(next.kontrolNotu || "").includes(envelope.reason)
    ) {
      next.kontrolNotu = [String(next.kontrolNotu || "").trim(), envelope.reason]
        .filter(Boolean)
        .join(" | ");
    }
    return next;
  }

  if (envelope.matched && envelope.accountCode) {
    const existing = compactCode(row.hesapKodu);
    if (!existing || existing === envelope.accountCode) {
      next.hesapKodu = envelope.accountCode;
      if (envelope.counterAccountCode && !compactCode(row.karsiHesapKodu)) {
        next.karsiHesapKodu = envelope.counterAccountCode;
      }
    }
  }

  return next;
}

export function stampManualAccountingDecision(
  row = null,
  {
    resolvedAtStage = OUTPUT_RESOLVED_AT_STAGE.MANUAL_EDIT,
    companyId = null,
  } = {}
) {
  if (!row || typeof row !== "object") return row;
  const accountCode = compactCode(row.hesapKodu);
  const firmaId = companyId || row.firmaId || null;
  const envelope = buildAccountingDecisionEnvelope({
    matched: Boolean(accountCode),
    accountCode: accountCode || null,
    counterAccountCode: compactCode(row.karsiHesapKodu) || null,
    source: ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY,
    scopeKey: "manual_row_edit",
    companyId: firmaId,
    confidence: 100,
    requiresReview: !accountCode,
    reason: accountCode ? "manual_edit" : "manual_edit_missing_account",
    lucaLeg: inferLucaLegFromRow(row),
    resolvedAtStage,
  });
  return {
    ...stampRowAccountingDecision(row, envelope, {
      lucaLeg: envelope.lucaLeg,
      resolvedAtStage,
      companyId: firmaId,
    }),
    manuallyEdited: true,
    firmaId: row.firmaId || firmaId || "",
  };
}

export function inferLucaLegFromRow(row = {}, bankAccountCode = "") {
  const code = compactCode(row.hesapKodu);
  const bank = compactCode(bankAccountCode);
  if (bank && code && code === bank) return ACCOUNTING_MEMORY_LUCA_LEG.STATEMENT;
  if (/^102(\.|$)/.test(code) && row.lineRole !== "counter") {
    if (
      row.lineRole === "borc" ||
      row.lineRole === "alacak" ||
      row.creationSource === "bank_double_entry"
    ) {
      if (bank && code !== bank) return ACCOUNTING_MEMORY_LUCA_LEG.COUNTER;
    }
  }
  if (/^102(\.|$)/.test(code) && (!bank || code === bank)) {
    return ACCOUNTING_MEMORY_LUCA_LEG.STATEMENT;
  }
  return ACCOUNTING_MEMORY_LUCA_LEG.COUNTER;
}

export function stampBankMaterializedLucaRow(
  row = null,
  {
    bankAccountCode = "",
    counterAccountCode = "",
    source = ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE,
    scopeKey = null,
    confidence = 70,
    requiresReview = false,
    reason = "bank_materialize",
    matchedMemoryId = null,
    companyId = null,
  } = {}
) {
  if (!row || typeof row !== "object") return row;
  const leg = inferLucaLegFromRow(row, bankAccountCode);
  const accountCode = compactCode(row.hesapKodu);
  const firmaId = companyId || row.firmaId || null;
  const resolvedSource =
    matchedMemoryId || text(source) === "userLearnedServer"
      ? ACCOUNTING_DECISION_SOURCE.USER_LEARNED
      : isSafeDecisionSource(source)
        ? text(source).toUpperCase()
        : ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE;

  const envelope = buildAccountingDecisionEnvelope({
    matched: Boolean(accountCode) && !requiresReview,
    accountCode: accountCode || null,
    counterAccountCode:
      leg === ACCOUNTING_MEMORY_LUCA_LEG.STATEMENT
        ? compactCode(counterAccountCode) || null
        : null,
    source: accountCode ? resolvedSource : ACCOUNTING_DECISION_SOURCE.NONE,
    scopeKey:
      scopeKey ||
      (matchedMemoryId ? `mem:${String(matchedMemoryId).slice(0, 24)}` : null),
    companyId: firmaId,
    confidence: accountCode ? confidence : 0,
    requiresReview: Boolean(requiresReview) || !accountCode,
    reason: accountCode ? reason : "missing_account_after_materialize",
    lucaLeg: leg,
    resolvedAtStage: OUTPUT_RESOLVED_AT_STAGE.BANK_MATERIALIZE,
  });

  return stampRowAccountingDecision(row, envelope, {
    lucaLeg: leg,
    resolvedAtStage: OUTPUT_RESOLVED_AT_STAGE.BANK_MATERIALIZE,
    companyId: firmaId,
  });
}

export function applyOutputAccountingDecisionOnce(row = null, context = {}) {
  if (!row || typeof row !== "object") return row;

  const companyId = context.companyId || context.firmaId || row.firmaId || "";

  if (shouldSkipOutputResolve(row, { companyId, firmaId: companyId })) {
    return row;
  }

  // Manuel ama imzasız → yeni imzalı zarf
  if (row.manuallyEdited && compactCode(row.hesapKodu)) {
    return stampManualAccountingDecision(row, { companyId });
  }

  const lucaLeg =
    context.lucaLeg ||
    inferLucaLegFromRow(row, context.bankAccountCode || "");

  const decision = resolveAccountingDecision({
    company: context.company || null,
    companyId,
    accountPlan: context.accountPlan || context.companyPlans || null,
    bankCode: context.bankCode || "",
    bankName: context.bankName || row.kaynakAdi || "",
    accountNumber: "",
    iban: "",
    productType: context.productType || "",
    currency: context.currency || "TL",
    description: "",
    direction: row.direction || "",
    transactionType: row.transactionType || "",
    accountingScenario: row.accountingScenario || "",
    sourceDocumentId: context.sourceDocumentId || "",
    sourceMovementId: row.sourceMovementId || row._movementId || "",
    documentResolutions: context.documentResolutions || null,
    learningMemory: context.learningMemory || null,
    systemCandidates: context.systemCandidates || null,
    lucaLeg:
      lucaLeg === ACCOUNTING_MEMORY_LUCA_LEG.COUNTER ? "counter" : "bank",
  });

  if (decision.requiresReview || !decision.matched) {
    return stampRowAccountingDecision(
      row,
      {
        ...decision,
        companyId,
        accountCode: decision.accountCode || compactCode(row.hesapKodu) || null,
      },
      {
        lucaLeg,
        resolvedAtStage: OUTPUT_RESOLVED_AT_STAGE.OUTPUT_FACADE,
        companyId,
      }
    );
  }

  return stampRowAccountingDecision(
    {
      ...row,
      hesapKodu: decision.accountCode || row.hesapKodu,
      firmaId: row.firmaId || companyId,
    },
    { ...decision, companyId },
    {
      lucaLeg,
      resolvedAtStage: OUTPUT_RESOLVED_AT_STAGE.OUTPUT_FACADE,
      companyId,
    }
  );
}

export function applyOutputAccountingDecisionsToRows(rows = [], context = {}) {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  return rows.map((row) => applyOutputAccountingDecisionOnce(row, context));
}

export function assertOutputDecisionIdempotent(row, context = {}) {
  const once = applyOutputAccountingDecisionOnce(row, context);
  const twice = applyOutputAccountingDecisionOnce(once, context);
  return {
    ok:
      compactCode(once.hesapKodu) === compactCode(twice.hesapKodu) &&
      String(once.borc ?? "") === String(twice.borc ?? "") &&
      String(once.alacak ?? "") === String(twice.alacak ?? "") &&
      once.accountingDecision?.decisionSignature ===
        twice.accountingDecision?.decisionSignature,
    once,
    twice,
  };
}

/** Export gate: requiresReview + boş hesap → bloke */
export function evaluateOutputExportDecisionGate(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const reviewBlocked = list.filter((row) => {
    const d = row?.accountingDecision;
    if (!d?.requiresReview) return false;
    return !compactCode(row.hesapKodu);
  });
  return {
    allowed: reviewBlocked.length === 0,
    blockedCount: reviewBlocked.length,
    code: reviewBlocked.length ? "ACCOUNTING_DECISION_REVIEW" : "OK",
    message: reviewBlocked.length
      ? `${reviewBlocked.length} satır muhasebe incelemesi bekliyor; sessiz hesap seçimi yok.`
      : "",
  };
}
