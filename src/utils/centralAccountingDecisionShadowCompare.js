/**
 * Merkezi resolver geçiş güvenliği — salt test/dev karşılaştırma.
 * Production UI'da toast/uyarı üretmez.
 */

import {
  resolveAccountingDecision,
  mapCentralDecisionToStatementResolve,
} from "@/src/utils/centralAccountingDecisionResolver";
import { resolveStatementAccountMapping } from "@/src/utils/bankProductAccountMapping";

function legacyMappingSource(result = {}) {
  if (!result?.ok) return "NONE";
  if (result.scope === "EXACT_ACCOUNT") return "EXACT_ACCOUNT";
  if (result.scope === "BANK_PRODUCT_CURRENCY") return "BANK_PRODUCT_CURRENCY";
  return result.scope || "LEGACY";
}

function legacyScopeKey(result = {}, opts = {}) {
  if (!result?.ok) return null;
  if (result.scope === "EXACT_ACCOUNT") {
    return `exact|legacy|${String(opts.accountNumber || "").replace(/\D/g, "").slice(-4) || "na"}`;
  }
  if (result.scope === "BANK_PRODUCT_CURRENCY") {
    return `product|legacy|${result.bankName || opts.bankName || ""}|${opts.productType || ""}|${opts.currency || "TL"}`;
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
    oldSource: legacyMappingSource(legacy),
    newSource: centralDecision.source || "NONE",
    oldScopeKey: legacyScopeKey(legacy, opts),
    newScopeKey: centralDecision.scopeKey || null,
    oldOk: Boolean(legacy.ok),
    newOk: Boolean(centralMapped.ok),
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
    oldSource: legacyResult.mappingScope || legacyMappingSource(legacyResult),
    newSource: centralDecision.source || "NONE",
    oldScopeKey: legacyResult.mappingScope || null,
    newScopeKey: centralDecision.scopeKey || null,
    diffReason:
      oldAccount === newAccount ? "" : "account_code_mismatch",
  };
}
