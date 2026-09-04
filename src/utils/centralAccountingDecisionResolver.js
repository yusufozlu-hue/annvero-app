/**
 * Merkezi Muhasebe Hafızası — salt-okuma karar facade (Faz 1).
 *
 * Mevcut adapter'ları yeniden kullanır; öncelik tek yerde belirlenir.
 * Yazma yolu yok — migration / dual-write yok.
 */

import {
  resolveExactBankAccountMapping,
  resolveBankProductCurrencyMapping,
  BANK_ACCOUNT_MAPPING_SCOPE,
  normalizeMappingCurrency,
  normalizeMappingAccountType,
} from "@/src/utils/bankProductAccountMapping";
import {
  buildResolutionLookup,
  lookupDocumentResolution,
} from "@/src/utils/bankStatementMovementResolutions";
import {
  consumeFirmAccountingMemory,
  evaluateAccountingMemoryHardRules,
  mapServerAccountingRowToV2,
} from "@/src/utils/accountingMemoryV1";
import { buildAccountMemoryV2Index } from "@/src/utils/accountMemoryV2";
import {
  MEMORY_AUTO_APPLY_MIN_CONFIDENCE,
  MEMORY_DECISION_CODE,
} from "@/src/utils/accountMemoryPolicy";

export const ACCOUNTING_DECISION_SOURCE = Object.freeze({
  DOCUMENT_ONLY: "DOCUMENT_ONLY",
  EXACT_ACCOUNT: "EXACT_ACCOUNT",
  BANK_PRODUCT_CURRENCY: "BANK_PRODUCT_CURRENCY",
  USER_LEARNED: "USER_LEARNED",
  SYSTEM_RULE: "SYSTEM_RULE",
  NONE: "NONE",
});

const SOURCE_PRIORITY = Object.freeze({
  [ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY]: 500,
  [ACCOUNTING_DECISION_SOURCE.EXACT_ACCOUNT]: 400,
  [ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY]: 300,
  [ACCOUNTING_DECISION_SOURCE.USER_LEARNED]: 200,
  [ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE]: 100,
  [ACCOUNTING_DECISION_SOURCE.NONE]: 0,
});

function compactCode(value = "") {
  return String(value || "").trim().replace(/\s+/g, "");
}

function digitsOnly(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function safeAccountDigitsTail(value = "") {
  const d = digitsOnly(value);
  if (!d || d.length < 4) return null;
  return d.slice(-4);
}

function normalizePlanCodes(accountPlan = null) {
  if (!accountPlan) return [];
  if (Array.isArray(accountPlan)) {
    return accountPlan
      .map((p) =>
        typeof p === "string"
          ? p
          : String(p?.code || p?.hesapKodu || p?.accountCode || "").trim()
      )
      .filter(Boolean);
  }
  return [];
}

function buildEmptyResult(reason = "no_match", extra = {}) {
  return {
    matched: false,
    accountCode: null,
    counterAccountCode: null,
    source: ACCOUNTING_DECISION_SOURCE.NONE,
    scopeKey: null,
    confidence: 0,
    requiresReview: true,
    reason,
    evidence: {},
    ...extra,
  };
}

function buildMatchedResult({
  accountCode = "",
  counterAccountCode = null,
  source = ACCOUNTING_DECISION_SOURCE.NONE,
  scopeKey = null,
  confidence = 0,
  requiresReview = false,
  reason = "",
  evidence = {},
} = {}) {
  return {
    matched: Boolean(accountCode) && !requiresReview,
    accountCode: accountCode || null,
    counterAccountCode: counterAccountCode || null,
    source,
    scopeKey,
    confidence: Number(confidence) || 0,
    requiresReview: Boolean(requiresReview),
    reason: reason || (requiresReview ? "review_required" : "matched"),
    evidence: evidence && typeof evidence === "object" ? evidence : {},
  };
}

function validateAccountSelection({
  accountCode = "",
  counterAccountCode = "",
  company = null,
  accountPlan = null,
  productType = "",
  mode = "statement_mapping",
} = {}) {
  const code = compactCode(accountCode);
  if (!code) {
    return { ok: false, reason: "missing_account_code" };
  }
  const planCodes = normalizePlanCodes(accountPlan);

  if (mode === "statement_mapping") {
    if (planCodes.length && !planCodes.includes(code)) {
      return { ok: false, reason: "account_not_in_plan" };
    }
    return { ok: true, reason: "" };
  }

  const hard = evaluateAccountingMemoryHardRules({
    accountCode: code,
    counterAccountCode: counterAccountCode || "",
    company,
    statementAccountType: normalizeMappingAccountType(productType),
    accountPlanCodes: planCodes.length ? planCodes : null,
  });
  if (hard.blocked) {
    return { ok: false, reason: hard.reasons[0] || "hard_rule_blocked" };
  }
  return { ok: true, reason: "" };
}

function buildSafeEvidence(base = {}) {
  const out = { ...base };
  delete out.rawDescription;
  delete out.description;
  delete out.iban;
  delete out.fullIban;
  delete out.accountNumber;
  if (out.accountDigitsTail == null && base.accountNumberHint) {
    out.accountDigitsTail = safeAccountDigitsTail(base.accountNumberHint);
    delete out.accountNumberHint;
  }
  return out;
}

function resolveDocumentCandidate({
  documentResolutions = null,
  sourceMovementId = "",
  sourceDocumentId = "",
  lucaLeg = "bank",
} = {}) {
  const mid = String(sourceMovementId || "").trim();
  if (!mid) return null;

  const lookup =
    documentResolutions &&
    typeof documentResolutions.get === "function"
      ? documentResolutions
      : buildResolutionLookup(documentResolutions || []);

  const hit = lookupDocumentResolution(lookup, {
    sourceMovementId: mid,
    lucaLeg,
  });
  if (!hit?.accountCode) return null;

  const docId = String(sourceDocumentId || "").trim();
  const hitSourceId = String(hit.sourceId || "").trim();
  if (docId && hitSourceId && docId !== hitSourceId) return null;

  return {
    accountCode: compactCode(hit.accountCode),
    counterAccountCode: null,
    scopeKey: `${mid}|${lucaLeg || ""}`,
    confidence: 100,
    evidence: buildSafeEvidence({
      resolutionId: hit.id || null,
      revision: hit.revision ?? null,
      decisionType: hit.decisionType || "DIRECT_ACCOUNT",
      learnForCompany: Boolean(hit.learnForCompany),
    }),
  };
}

function resolveExactCandidate({
  company = null,
  accountNumber = "",
  iban = "",
  productType = "",
  bankName = "",
  currency = "TL",
} = {}) {
  const exact = resolveExactBankAccountMapping({
    company,
    accountNumber,
    iban,
    accountType: productType,
  });
  if (!exact.ok) return null;
  return {
    accountCode: compactCode(exact.code),
    counterAccountCode: null,
    scopeKey: `exact|${digitsOnly(accountNumber) || "iban"}|${normalizeMappingAccountType(productType)}`,
    confidence: 100,
    evidence: buildSafeEvidence({
      bankName: exact.bankName || bankName || null,
      currency: exact.currency || currency,
      productType: exact.accountType || productType,
      accountDigitsTail: safeAccountDigitsTail(accountNumber),
    }),
  };
}

function resolveProductCandidate({
  company = null,
  bankName = "",
  bankCode = "",
  productType = "",
  currency = "TL",
} = {}) {
  const wantType = normalizeMappingAccountType(productType);
  if (!wantType) return { kind: "none" };

  const product = resolveBankProductCurrencyMapping({
    company,
    bankName: bankName || bankCode,
    accountType: wantType,
    currency,
  });

  if (product.ok) {
    return {
      kind: "match",
      accountCode: compactCode(product.code),
      counterAccountCode: null,
      scopeKey: `product|${product.bankName || bankCode}|${wantType}|${normalizeMappingCurrency(currency)}`,
      confidence: 80,
      evidence: buildSafeEvidence({
        bankName: product.bankName || bankName || bankCode,
        productType: wantType,
        currency: normalizeMappingCurrency(currency),
      }),
    };
  }

  if (product.ambiguous) {
    return {
      kind: "conflict",
      reason: product.reason || "ambiguous_product_mapping",
      evidence: buildSafeEvidence({
        bankName: bankName || bankCode,
        productType: wantType,
        currency: normalizeMappingCurrency(currency),
      }),
    };
  }

  return { kind: "none" };
}

function buildLearningMemoryIndex(learningMemory = [], companyId = "") {
  const firmaId = String(companyId || "").trim();
  if (!firmaId || !Array.isArray(learningMemory) || !learningMemory.length) {
    return null;
  }
  const records = learningMemory
    .map(mapServerAccountingRowToV2)
    .filter(Boolean)
    .filter((r) => String(r.companyId || "") === firmaId && r.isActive !== false);
  if (!records.length) return null;
  return buildAccountMemoryV2Index(records);
}

function resolveUserLearnedCandidate({
  companyId = "",
  company = null,
  bankName = "",
  bankCode = "",
  currency = "TL",
  direction = "",
  transactionType = "",
  description = "",
  accountingScenario = "",
  learningMemory = null,
  accountPlan = null,
  productType = "",
  lucaLeg = "bank",
} = {}) {
  const firmaId = String(companyId || company?.id || "").trim();
  if (!firmaId) return { kind: "none" };

  const index = buildLearningMemoryIndex(learningMemory, firmaId);
  if (!index) return { kind: "none" };

  const requestedLeg =
    String(lucaLeg || "").toLowerCase() === "counter" ||
    String(lucaLeg || "").toLowerCase() === "counter_leg"
      ? "counter"
      : "statement";

  const hit = consumeFirmAccountingMemory({
    companyId: firmaId,
    bankId: bankCode || bankName,
    bankName: bankName || bankCode,
    direction,
    transactionType: transactionType || accountingScenario,
    currency,
    descriptionOrKey: description,
    analysisKey: description,
    accountMemoryIndex: index,
    accountPlanCodes: normalizePlanCodes(accountPlan),
    company,
    statementAccountType: productType,
    allowAuto: true,
    lucaLeg: requestedLeg,
  });

  if (
    hit?.mode === "conflict" ||
    hit?.decisionCode === MEMORY_DECISION_CODE.CONFLICT
  ) {
    return {
      kind: "conflict",
      reason: hit.rejectReason || "conflicting_user_memory",
      evidence: buildSafeEvidence({
        signature: hit.signature || null,
      }),
    };
  }

  if (hit?.mode === "review" || hit?.reviewRequired) {
    return {
      kind: "review",
      accountCode: compactCode(hit?.record?.accountCode || "") || null,
      counterAccountCode: compactCode(hit?.record?.counterAccountCode || "") || null,
      scopeKey: hit.signature || hit?.record?.canonicalAnalysisKey || null,
      confidence: Number(hit?.record?.confidence) || 0,
      reason: hit.rejectReason || "user_memory_review",
      evidence: buildSafeEvidence({
        signature: hit.signature || null,
        lucaLeg: hit.lucaLeg || null,
      }),
    };
  }

  const code = compactCode(hit?.record?.accountCode || hit?.record?.hesapKodu || "");
  if (!code) return { kind: "none" };

  const confidence = Number(hit?.record?.confidence) || 95;
  if (confidence < MEMORY_AUTO_APPLY_MIN_CONFIDENCE && !hit?.autoApply) {
    return {
      kind: "review",
      accountCode: code,
      counterAccountCode: compactCode(hit?.record?.counterAccountCode || "") || null,
      scopeKey: hit.signature || hit?.record?.canonicalAnalysisKey || null,
      confidence,
      reason: "user_memory_low_confidence",
      evidence: buildSafeEvidence({
        signature: hit.signature || null,
        tier: hit?.record?.tier || null,
      }),
    };
  }

  return {
    kind: "match",
    accountCode: code,
    counterAccountCode: compactCode(hit?.record?.counterAccountCode || "") || null,
    scopeKey: hit.signature || hit?.record?.canonicalAnalysisKey || null,
    confidence,
    evidence: buildSafeEvidence({
      signature: hit.signature || null,
      tier: hit?.record?.tier || null,
      serverPersisted: Boolean(hit?.record?.serverPersisted),
      lucaLeg: hit.lucaLeg || requestedLeg,
    }),
  };
}

function resolveSystemCandidates(systemCandidates = []) {
  const list = (systemCandidates || []).filter(
    (c) => c && compactCode(c.accountCode)
  );
  if (!list.length) return { kind: "none" };

  const codes = new Set(list.map((c) => compactCode(c.accountCode)));
  if (codes.size > 1) {
    return {
      kind: "conflict",
      reason: "conflicting_system_rules",
      evidence: buildSafeEvidence({
        candidateCount: list.length,
        codes: [...codes],
      }),
    };
  }

  const best = list[0];
  return {
    kind: "match",
    accountCode: compactCode(best.accountCode),
    counterAccountCode: compactCode(best.counterAccountCode || "") || null,
    scopeKey: String(best.scopeKey || best.ruleCode || "system").trim() || "system",
    confidence: Number(best.confidence) || 40,
    reason: String(best.reason || "system_rule").trim(),
    evidence: buildSafeEvidence({
      ruleCode: best.ruleCode || null,
      scopeKey: best.scopeKey || null,
    }),
  };
}

function finalizeTierCandidate(source, candidate, validationContext) {
  if (!candidate?.accountCode) {
    return buildEmptyResult("missing_account_code", {
      evidence: buildSafeEvidence({
        rejectedSource: source,
        ...(candidate?.evidence || {}),
      }),
    });
  }

  const isStatementTier =
    source === ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY ||
    source === ACCOUNTING_DECISION_SOURCE.EXACT_ACCOUNT ||
    source === ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY;

  const valid = validateAccountSelection({
    accountCode: candidate.accountCode,
    counterAccountCode: candidate.counterAccountCode,
    ...validationContext,
    mode: isStatementTier ? "statement_mapping" : "firm_memory",
  });

  if (!valid.ok) {
    return buildMatchedResult({
      accountCode: null,
      source: ACCOUNTING_DECISION_SOURCE.NONE,
      scopeKey: candidate.scopeKey,
      confidence: candidate.confidence || 0,
      requiresReview: true,
      reason: valid.reason,
      evidence: buildSafeEvidence({
        rejectedSource: source,
        rejectedAccountCode: candidate.accountCode,
        ...(candidate.evidence || {}),
      }),
    });
  }

  return buildMatchedResult({
    accountCode: candidate.accountCode,
    counterAccountCode: candidate.counterAccountCode,
    source,
    scopeKey: candidate.scopeKey,
    confidence: candidate.confidence || 0,
    requiresReview: false,
    reason:
      source === ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY
        ? "document_resolution"
        : source === ACCOUNTING_DECISION_SOURCE.EXACT_ACCOUNT
          ? "exact_account"
          : source === ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY
            ? "bank_product_currency"
            : source === ACCOUNTING_DECISION_SOURCE.USER_LEARNED
              ? "user_learned"
              : "system_rule",
    evidence: candidate.evidence || {},
  });
}

/**
 * Tek merkezi salt-okuma giriş noktası.
 */
export function resolveAccountingDecision({
  company = null,
  companyId = "",
  accountPlan = null,
  bankCode = "",
  bankName = "",
  accountNumber = "",
  iban = "",
  productType = "",
  currency = "TL",
  description = "",
  direction = "",
  transactionType = "",
  accountingScenario = "",
  sourceDocumentId = "",
  sourceMovementId = "",
  documentResolutions = null,
  learningMemory = null,
  systemCandidates = null,
  lucaLeg = "bank",
} = {}) {
  const validationContext = {
    company,
    accountPlan,
    productType,
  };
  const firmaId = String(companyId || company?.id || "").trim();
  if (firmaId && company?.id && String(company.id) !== firmaId) {
    return buildEmptyResult("tenant_company_mismatch", {
      evidence: buildSafeEvidence({ companyId: firmaId }),
    });
  }

  const tiers = [
    {
      source: ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY,
      resolve: () =>
        resolveDocumentCandidate({
          documentResolutions,
          sourceMovementId,
          sourceDocumentId,
          lucaLeg,
        }),
    },
    {
      source: ACCOUNTING_DECISION_SOURCE.EXACT_ACCOUNT,
      resolve: () =>
        resolveExactCandidate({
          company,
          accountNumber,
          iban,
          productType,
          bankName: bankName || bankCode,
          currency,
        }),
    },
    {
      source: ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY,
      resolve: () =>
        resolveProductCandidate({
          company,
          bankName,
          bankCode,
          productType,
          currency,
        }),
    },
    {
      source: ACCOUNTING_DECISION_SOURCE.USER_LEARNED,
      resolve: () =>
        resolveUserLearnedCandidate({
          companyId: firmaId,
          company,
          bankName,
          bankCode,
          currency,
          direction,
          transactionType,
          accountingScenario,
          description,
          learningMemory,
          accountPlan,
          productType,
          lucaLeg,
        }),
    },
    {
      source: ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE,
      resolve: () => resolveSystemCandidates(systemCandidates),
    },
  ];

  for (const tier of tiers) {
    const raw = tier.resolve();
    if (!raw) continue;

    if (raw.kind === "conflict") {
      return buildMatchedResult({
        accountCode: null,
        source: tier.source,
        scopeKey: raw.scopeKey || null,
        confidence: 0,
        requiresReview: true,
        reason: raw.reason || "conflicting_candidates",
        evidence: raw.evidence || {},
      });
    }

    if (raw.kind === "review") {
      return buildMatchedResult({
        accountCode: raw.accountCode || null,
        counterAccountCode: raw.counterAccountCode || null,
        source: tier.source,
        scopeKey: raw.scopeKey || null,
        confidence: raw.confidence || 0,
        requiresReview: true,
        reason: raw.reason || "review_required",
        evidence: raw.evidence || {},
      });
    }

    if (raw.kind === "match" || raw.accountCode) {
      return finalizeTierCandidate(tier.source, raw, validationContext);
    }
  }

  return buildEmptyResult("no_match", {
    evidence: buildSafeEvidence({
      bankName: bankName || bankCode || null,
      productType: normalizeMappingAccountType(productType) || null,
      currency: normalizeMappingCurrency(currency),
      accountDigitsTail: safeAccountDigitsTail(accountNumber),
    }),
  });
}

/** Banka Parser pilotu — merkezi kararı legacy statement sonucuna map eder. */
export function mapCentralDecisionToStatementResolve(decision = {}, fallbackReason = "") {
  if (decision?.matched && decision.accountCode) {
    const scope =
      decision.source === ACCOUNTING_DECISION_SOURCE.EXACT_ACCOUNT
        ? BANK_ACCOUNT_MAPPING_SCOPE.EXACT_ACCOUNT
        : decision.source === ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY
          ? BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY
          : decision.source === ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY
            ? "DOCUMENT_ONLY"
            : decision.source || "";
    return {
      ok: true,
      ambiguous: false,
      code: decision.accountCode,
      mappingScope: scope,
      score:
        decision.source === ACCOUNTING_DECISION_SOURCE.EXACT_ACCOUNT
          ? 100
          : decision.source === ACCOUNTING_DECISION_SOURCE.BANK_PRODUCT_CURRENCY
            ? 80
            : Number(decision.confidence) || 70,
      reasons: [decision.reason || decision.source || "central_resolver"],
      centralSource: decision.source,
      centralScopeKey: decision.scopeKey,
    };
  }

  if (decision?.requiresReview) {
    return {
      ok: false,
      ambiguous: true,
      code: "",
      reason: decision.reason || fallbackReason || "review_required",
      centralSource: decision.source || ACCOUNTING_DECISION_SOURCE.NONE,
      centralScopeKey: decision.scopeKey || null,
    };
  }

  return {
    ok: false,
    ambiguous: false,
    code: "",
    reason: decision?.reason || fallbackReason || "no_match",
    centralSource: decision?.source || ACCOUNTING_DECISION_SOURCE.NONE,
  };
}

export function centralDecisionSourcePriority(source = "") {
  return SOURCE_PRIORITY[source] ?? 0;
}
