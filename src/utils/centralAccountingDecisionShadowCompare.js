/**
 * Merkezi resolver geçiş güvenliği — salt test/dev karşılaştırma.
 * Production UI'da toast/uyarı üretmez.
 * Ham açıklama, IBAN ve hesap numarası loglamaz — yalnız fingerprint / sınıf / fark.
 */

import {
  resolveAccountingDecision,
  mapCentralDecisionToStatementResolve,
  ACCOUNTING_DECISION_SOURCE,
} from "@/src/utils/centralAccountingDecisionResolver";
import { resolveStatementAccountMapping } from "@/src/utils/bankProductAccountMapping";
import {
  mapLegacyMatchSourceToTier,
  legacyCascadeToSystemCandidate,
  finalizeWithLegacyCompatFallback,
} from "@/src/utils/centralAccountingDecisionSinglePass";
import { ACCOUNTING_MEMORY_LUCA_LEG } from "@/src/utils/accountingMemoryV1";

function fingerprintAccount(code = "") {
  const c = String(code || "").trim().replace(/\s+/g, "");
  if (!c) return null;
  // Sınıf + uzunluk + son segment — tam hesap no / IBAN değil
  const parts = c.split(".");
  return {
    class: parts[0] || c.slice(0, 3),
    depth: parts.length,
    tail: parts[parts.length - 1] || "",
    len: c.length,
  };
}

function legacyMappingSource(result = {}) {
  if (!result?.ok) return "NONE";
  if (result.scope === "EXACT_ACCOUNT") return "EXACT_ACCOUNT";
  if (result.scope === "BANK_PRODUCT_CURRENCY") return "BANK_PRODUCT_CURRENCY";
  return result.scope || "LEGACY";
}

function legacyScopeKey(result = {}, opts = {}) {
  if (!result?.ok) return null;
  if (result.scope === "EXACT_ACCOUNT") {
    return `exact|legacy|tail`;
  }
  if (result.scope === "BANK_PRODUCT_CURRENCY") {
    return `product|legacy|${String(opts.productType || "").slice(0, 16)}|${opts.currency || "TL"}`;
  }
  return null;
}

/**
 * Eski bankProduct mapping yolu ile merkezi resolver'ı karşılaştırır.
 */
export function compareCentralVsLegacyStatementMapping(opts = {}) {
  const centralDecision = resolveAccountingDecision({
    company: opts.company,
    companyId: opts.companyId || opts.company?.id,
    accountPlan: opts.accountPlan,
    bankCode: opts.bankCode,
    bankName: opts.bankName,
    accountNumber: opts.accountNumber,
    iban: opts.iban,
    productType: opts.productType || opts.accountType,
    currency: opts.currency,
    description: opts.description,
    direction: opts.direction,
    transactionType: opts.transactionType,
    accountingScenario: opts.accountingScenario,
    sourceDocumentId: opts.sourceDocumentId,
    sourceMovementId: opts.sourceMovementId,
    documentResolutions: opts.documentResolutions,
    learningMemory: opts.learningMemory,
    systemCandidates: opts.systemCandidates,
    lucaLeg: opts.lucaLeg || "bank",
  });

  const centralMapped = mapCentralDecisionToStatementResolve(centralDecision);

  const legacy = resolveStatementAccountMapping({
    company: opts.company,
    accountNumber: opts.accountNumber,
    iban: opts.iban,
    bankName: opts.bankName,
    currency: opts.currency,
    accountType: opts.productType || opts.accountType,
  });

  const oldAccount = legacy.ok ? String(legacy.code || "").trim() : "";
  const newAccount = centralMapped.ok
    ? String(centralMapped.code || centralDecision.accountCode || "").trim()
    : "";

  const sameAccount = oldAccount === newAccount;
  const sameOk = Boolean(legacy.ok) === Boolean(centralMapped.ok);

  return {
    equal: sameAccount && sameOk,
    oldAccount: oldAccount || null,
    newAccount: newAccount || null,
    oldAccountFp: fingerprintAccount(oldAccount),
    newAccountFp: fingerprintAccount(newAccount),
    oldSource: legacyMappingSource(legacy),
    newSource: centralDecision.source || "NONE",
    oldScopeKey: legacyScopeKey(legacy, opts),
    newScopeKey: centralDecision.scopeKey || null,
    oldOk: Boolean(legacy.ok),
    newOk: Boolean(centralMapped.ok),
    requiresReview: Boolean(centralDecision.requiresReview),
    lucaLeg: "statement",
    centralDecision,
    legacyMapping: legacy,
    centralMapped,
    diffReason:
      sameAccount && sameOk
        ? ""
        : !sameOk
          ? "ok_flag_mismatch"
          : "account_code_mismatch",
  };
}

/**
 * Tam statement resolve (legacy fallback dahil) ile merkezi katman karşılaştırması.
 */
export function compareCentralVsLegacyStatementResolve({
  legacyResult = {},
  centralDecision = {},
} = {}) {
  const centralMapped = mapCentralDecisionToStatementResolve(centralDecision);
  const oldAccount = legacyResult.ok ? String(legacyResult.code || "").trim() : "";
  const newAccount = centralMapped.ok
    ? String(centralMapped.code || centralDecision.accountCode || "").trim()
    : "";

  return {
    equal:
      Boolean(legacyResult.ok) === Boolean(centralMapped.ok) &&
      oldAccount === newAccount,
    oldAccount: oldAccount || null,
    newAccount: newAccount || null,
    oldAccountFp: fingerprintAccount(oldAccount),
    newAccountFp: fingerprintAccount(newAccount),
    oldSource: legacyResult.mappingScope || legacyMappingSource(legacyResult),
    newSource: centralDecision.source || "NONE",
    oldScopeKey: legacyResult.mappingScope || null,
    newScopeKey: centralDecision.scopeKey || null,
    requiresReview: Boolean(centralDecision.requiresReview),
    lucaLeg: "statement",
    diffReason: oldAccount === newAccount ? "" : "account_code_mismatch",
  };
}

/**
 * Faz 5 — aynı canonical hareket için legacy cascade vs central (PII-safe).
 *
 * Karşılaştırılan alanlar:
 * legacy result, central result, selected account, counter account,
 * source tier, requiresReview, lucaLeg
 */
export function compareLegacyVsCentralMovementShadow({
  company = null,
  companyId = "",
  accountPlan = null,
  bankName = "",
  currency = "TL",
  direction = "",
  transactionType = "",
  description = "",
  learningMemory = null,
  documentResolutions = null,
  sourceMovementId = "",
  /** Mapper cascade çıktısı (legacy) */
  legacyMovement = null,
  lucaLeg = "counter",
} = {}) {
  const legacyAccount =
    lucaLeg === "bank" || lucaLeg === ACCOUNTING_MEMORY_LUCA_LEG.STATEMENT
      ? String(legacyMovement?.accountCode || "").trim()
      : String(legacyMovement?.counterAccountCode || "").trim();
  const legacyCounter = String(legacyMovement?.counterAccountCode || "").trim();
  const legacySource = mapLegacyMatchSourceToTier(
    legacyMovement?.matchedRule,
    legacyMovement?.matchedMemoryId
  );
  const legacyReview = Boolean(
    legacyMovement?.decisionRequiresReview ||
      (!legacyAccount && legacyMovement?.missingHesapCategory)
  );

  const legacyCandidate = legacyCascadeToSystemCandidate({
    accountCode: legacyAccount,
    matchedRule: legacyMovement?.matchedRule,
    matchedMemoryId: legacyMovement?.matchedMemoryId,
    requiresReview: legacyReview,
    reason: "shadow_legacy_cascade",
  });

  const centralRaw = resolveAccountingDecision({
    company,
    companyId: companyId || company?.id,
    accountPlan,
    bankName,
    currency,
    direction,
    transactionType,
    description,
    learningMemory,
    documentResolutions,
    sourceMovementId,
    lucaLeg:
      lucaLeg === "counter" || lucaLeg === ACCOUNTING_MEMORY_LUCA_LEG.COUNTER
        ? "counter"
        : "bank",
    systemCandidates: null,
  });

  const finalized = finalizeWithLegacyCompatFallback(centralRaw, legacyCandidate);
  const central = finalized.decision;

  const selectedEqual =
    String(legacyAccount || "") === String(central?.accountCode || "");
  const counterEqual =
    lucaLeg === "bank" || lucaLeg === ACCOUNTING_MEMORY_LUCA_LEG.STATEMENT
      ? String(legacyCounter || "") ===
        String(central?.counterAccountCode || legacyCounter || "")
      : true;
  const sourceEqual = legacySource === (central?.source || "NONE");
  const reviewEqual = legacyReview === Boolean(central?.requiresReview);

  const equal = selectedEqual && counterEqual && reviewEqual;

  return {
    equal,
    legacyResult: {
      selectedAccountFp: fingerprintAccount(legacyAccount),
      counterAccountFp: fingerprintAccount(legacyCounter),
      sourceTier: legacySource,
      requiresReview: legacyReview,
      lucaLeg,
    },
    centralResult: {
      selectedAccountFp: fingerprintAccount(central?.accountCode),
      counterAccountFp: fingerprintAccount(central?.counterAccountCode),
      sourceTier: central?.source || ACCOUNTING_DECISION_SOURCE.NONE,
      requiresReview: Boolean(central?.requiresReview),
      lucaLeg,
      usedLegacyFallback: Boolean(finalized.usedLegacyFallback),
    },
    selectedAccountEqual: selectedEqual,
    counterAccountEqual: counterEqual,
    sourceTierEqual: sourceEqual,
    requiresReviewEqual: reviewEqual,
    diffReason: equal
      ? ""
      : !selectedEqual
        ? "selected_account_mismatch"
        : !reviewEqual
          ? "requires_review_mismatch"
          : !counterEqual
            ? "counter_account_mismatch"
            : "source_tier_mismatch",
  };
}

/**
 * MARE satır seti için toplu shadow özeti (PII-safe sayaçlar).
 */
export function summarizeMovementShadowComparisons(comparisons = []) {
  const total = comparisons.length;
  const equal = comparisons.filter((c) => c.equal).length;
  const byDiff = {};
  for (const c of comparisons) {
    if (c.equal) continue;
    const key = c.diffReason || "unknown";
    byDiff[key] = (byDiff[key] || 0) + 1;
  }
  return {
    total,
    equal,
    unequal: total - equal,
    equalRate: total ? equal / total : 1,
    byDiff,
  };
}
