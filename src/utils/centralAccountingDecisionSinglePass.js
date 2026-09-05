/**
 * Faz 5 — Tek geçişli muhasebe kararı sözleşmesi.
 *
 * canonical resolver → doğrulanmış accountingDecision envelope →
 * Fiş Kontrol / Luca / Elektraweb tüketimi.
 *
 * Yeni paralel resolver yok. Feature flag mezarlığı yok.
 * Legacy cascade yalnız merkezi NONE + açık uyumluluk yolunda çalışır;
 * sonuç her zaman envelope'a çevrilir.
 */

import {
  ACCOUNTING_DECISION_SOURCE,
  centralDecisionSourcePriority,
  resetAccountingResolveCallCount,
  getAccountingResolveCallCount,
  beginAccountingResolveCallTracking,
  endAccountingResolveCallTracking,
} from "@/src/utils/centralAccountingDecisionResolver";
import { ACCOUNTING_MEMORY_LUCA_LEG } from "@/src/utils/accountingMemoryV1";
import {
  shouldSkipOutputResolveTrusted,
  validateAccountingDecisionTrust,
} from "@/src/utils/accountingDecisionTrust";
import {
  applyOutputAccountingDecisionOnce,
  buildAccountingDecisionEnvelope,
  stampRowAccountingDecision,
  OUTPUT_RESOLVED_AT_STAGE,
} from "@/src/utils/outputAccountingDecisionFacade";
import { applyLearningMemoryToStandardLucaRows } from "@/src/utils/bankLearningMemory";
import { applyAccountMemoryV1RecordsToRows } from "@/src/utils/accountMemoryV1";
import { applySmartBankSuggestionsToRows } from "@/src/utils/bankSmartSuggestions";
import { ensureStandardLucaRowIds } from "@/src/utils/standardLucaRow";

/** matchedRule.source → canonical tier */
export const LEGACY_MATCH_SOURCE_TO_TIER = Object.freeze({
  documentResolution: ACCOUNTING_DECISION_SOURCE.DOCUMENT_ONLY,
  firmaHafizaV2: ACCOUNTING_DECISION_SOURCE.USER_LEARNED,
  userLearnedServer: ACCOUNTING_DECISION_SOURCE.USER_LEARNED,
  learningMemory: ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE,
  accountingRuleEngine: ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE,
  companyAccountingEngine: ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE,
  companyEngine: ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE,
  legacyRule: ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE,
  safeSystemRule: ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE,
  cariMatcher: ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE,
  accountingScenario: ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE,
});

export function mapLegacyMatchSourceToTier(matchedRule = null, matchedMemoryId = null) {
  if (matchedMemoryId) return ACCOUNTING_DECISION_SOURCE.USER_LEARNED;
  const raw = String(matchedRule?.source || "").trim();
  if (!raw) return ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE;
  if (LEGACY_MATCH_SOURCE_TO_TIER[raw]) return LEGACY_MATCH_SOURCE_TO_TIER[raw];
  const upper = raw.toUpperCase();
  if (centralDecisionSourcePriority(upper) > 0) return upper;
  return ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE;
}

/**
 * Legacy counter cascade sonucunu canonical systemCandidate'a çevirir.
 * Ham açıklama / IBAN / hesap no taşımaz.
 */
export function legacyCascadeToSystemCandidate({
  accountCode = "",
  matchedRule = null,
  matchedMemoryId = null,
  confidence = 70,
  requiresReview = false,
  reason = "legacy_cascade_compat",
} = {}) {
  const code = String(accountCode || "").trim().replace(/\s+/g, "");
  if (!code && !requiresReview) return null;
  const source = mapLegacyMatchSourceToTier(matchedRule, matchedMemoryId);
  return {
    kind: requiresReview ? "review" : "match",
    accountCode: code || null,
    source,
    scopeKey: matchedMemoryId
      ? `mem:${String(matchedMemoryId).slice(0, 24)}`
      : matchedRule?.anahtar
        ? `legacy:${String(matchedRule.anahtar).slice(0, 48)}`
        : `legacy:${String(matchedRule?.source || "cascade").slice(0, 32)}`,
    confidence: Number(confidence) || 0,
    requiresReview: Boolean(requiresReview),
    reason,
    evidence: {
      legacySource: String(matchedRule?.source || "").slice(0, 48) || null,
      hasMemoryId: Boolean(matchedMemoryId),
    },
  };
}

/**
 * Merkezi NONE / no_match ise legacy adayı SYSTEM_RULE uyumluluk yoluyla finalize eder.
 * Gerçek review (conflict / USER_LEARNED review vb.) legacy ile ezilmez.
 */
export function finalizeWithLegacyCompatFallback(centralDecision, legacyCandidate = null) {
  const source = String(centralDecision?.source || ACCOUNTING_DECISION_SOURCE.NONE);
  const reason = String(centralDecision?.reason || "");
  const isHardReview =
    Boolean(centralDecision?.requiresReview) &&
    source !== ACCOUNTING_DECISION_SOURCE.NONE &&
    reason !== "no_match";

  if (isHardReview) {
    return {
      decision: centralDecision,
      usedLegacyFallback: false,
      reason: "central_requires_review_blocks_legacy",
    };
  }
  if (centralDecision?.matched && centralDecision.accountCode) {
    return {
      decision: centralDecision,
      usedLegacyFallback: false,
      reason: "central_matched",
    };
  }
  if (!legacyCandidate?.accountCode && !legacyCandidate?.requiresReview) {
    return {
      decision: centralDecision || {
        matched: false,
        accountCode: null,
        source: ACCOUNTING_DECISION_SOURCE.NONE,
        requiresReview: true,
        reason: "no_match",
      },
      usedLegacyFallback: false,
      reason: "no_legacy_candidate",
    };
  }

  const legacySource =
    legacyCandidate.source || ACCOUNTING_DECISION_SOURCE.SYSTEM_RULE;
  const requiresReview = Boolean(legacyCandidate.requiresReview);
  return {
    decision: {
      matched: Boolean(legacyCandidate.accountCode) && !requiresReview,
      accountCode: legacyCandidate.accountCode || null,
      counterAccountCode: legacyCandidate.counterAccountCode || null,
      source: legacySource,
      scopeKey: legacyCandidate.scopeKey || null,
      confidence: Number(legacyCandidate.confidence) || 0,
      requiresReview,
      reason: legacyCandidate.reason || "legacy_compat_fallback",
      evidence: legacyCandidate.evidence || {},
    },
    usedLegacyFallback: true,
    reason: "central_none_legacy_compat",
  };
}

/**
 * Güvenilir zarf varsa resolver çağırmaz; yoksa en fazla bir kez çözer ve damgalar.
 */
export function applySinglePassAccountingDecision(row = null, context = {}) {
  if (!row || typeof row !== "object") {
    return { row, resolveCalls: 0, skipped: true };
  }
  const companyId = context.companyId || context.firmaId || row.firmaId || "";
  if (
    shouldSkipOutputResolveTrusted(row, {
      companyId,
      firmaId: companyId,
    })
  ) {
    return { row, resolveCalls: 0, skipped: true };
  }
  if (row.manuallyEdited && String(row.hesapKodu || "").trim()) {
    const stamped = applyOutputAccountingDecisionOnce(row, context);
    return { row: stamped, resolveCalls: 0, skipped: false, manual: true };
  }

  const before = getAccountingResolveCallCount();
  const next = applyOutputAccountingDecisionOnce(row, context);
  const after = getAccountingResolveCallCount();
  return {
    row: next,
    resolveCalls: Math.max(0, after - before),
    skipped: false,
  };
}

/**
 * Materialize sonrası tüketiciler: LM → V2 → smart.
 * Güvenilir zarfı olan satırlarda hesap kodu değiştirilmez (her tüketici skip eder).
 * Toplu kısa devre: tüm satırlar güvenilirse LM/V2/smart hiç çalıştırılmaz.
 */
export function applyPostMaterializeConsumersSinglePass(
  rows = [],
  {
    learningMemory = [],
    accountMemoryRecords = [],
    companyPlans = null,
    selectedBank = "",
    selectedCompanyId = "",
    firmaId = "",
  } = {}
) {
  const companyId = String(firmaId || selectedCompanyId || "").trim();
  const withIds = ensureStandardLucaRowIds(rows || []);
  const allTrusted =
    withIds.length > 0 &&
    withIds.every((row) =>
      shouldSkipOutputResolveTrusted(row, { companyId, firmaId: companyId })
    );

  if (allTrusted) {
    return {
      rows: withIds,
      consumersSkipped: true,
      reason: "all_rows_trusted_envelope",
    };
  }

  const learningRows = applyLearningMemoryToStandardLucaRows(
    withIds,
    learningMemory,
    {
      firmaId: companyId,
      kaynakTipi: "Banka",
      kaynakAdi: selectedBank,
    }
  );
  const memoryRows = applyAccountMemoryV1RecordsToRows(
    learningRows,
    accountMemoryRecords,
    {
      firmaId: companyId,
      kaynakAdi: selectedBank,
    }
  );
  const smartRows = applySmartBankSuggestionsToRows(memoryRows, {
    companyPlans,
    selectedBank,
    selectedCompanyId: companyId,
  });
  return {
    rows: smartRows,
    consumersSkipped: false,
    reason: "partial_or_untrusted_rows",
  };
}

/**
 * Movement üzerindeki cascade sonucunu statement/counter envelope alanlarına yazar
 * (materialize stamp için provenance).
 */
export function annotateMovementDecisionProvenance(movement = {}) {
  if (!movement || typeof movement !== "object") return movement;
  const source = mapLegacyMatchSourceToTier(
    movement.matchedRule,
    movement.matchedMemoryId
  );
  return {
    ...movement,
    decisionSource: movement.decisionSource || source,
    decisionScopeKey:
      movement.decisionScopeKey ||
      (movement.matchedMemoryId
        ? `mem:${String(movement.matchedMemoryId).slice(0, 24)}`
        : null),
    decisionRequiresReview: Boolean(
      movement.decisionRequiresReview ||
        (!movement.counterAccountCode && movement.missingHesapCategory)
    ),
  };
}

export function buildEnvelopeFromMovementLeg(movement = {}, lucaLeg = "counter") {
  const isStatement =
    lucaLeg === ACCOUNTING_MEMORY_LUCA_LEG.STATEMENT || lucaLeg === "bank";
  const accountCode = isStatement
    ? String(movement.accountCode || "").trim()
    : String(movement.counterAccountCode || "").trim();
  const source = mapLegacyMatchSourceToTier(
    movement.matchedRule,
    movement.matchedMemoryId
  );
  return buildAccountingDecisionEnvelope({
    matched: Boolean(accountCode) && !movement.decisionRequiresReview,
    accountCode: accountCode || null,
    counterAccountCode: isStatement
      ? String(movement.counterAccountCode || "").trim() || null
      : null,
    source: accountCode ? source : ACCOUNTING_DECISION_SOURCE.NONE,
    scopeKey: movement.decisionScopeKey || null,
    companyId: movement.firmaId || null,
    confidence: accountCode ? 70 : 0,
    requiresReview: Boolean(movement.decisionRequiresReview) || !accountCode,
    reason: "single_pass_materialize",
    lucaLeg: isStatement
      ? ACCOUNTING_MEMORY_LUCA_LEG.STATEMENT
      : ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
    resolvedAtStage: OUTPUT_RESOLVED_AT_STAGE.BANK_MATERIALIZE,
  });
}

/** Re-export call counter helpers (resolver üzerinde yaşar). */
export {
  resetAccountingResolveCallCount,
  getAccountingResolveCallCount,
  beginAccountingResolveCallTracking,
  endAccountingResolveCallTracking,
};

export function stampIfUntrusted(row, decision, context = {}) {
  const companyId = context.companyId || row?.firmaId || "";
  const trust = validateAccountingDecisionTrust(row, {
    companyId,
    firmaId: companyId,
  });
  if (trust.ok) return row;
  return stampRowAccountingDecision(row, decision, {
    lucaLeg: decision?.lucaLeg,
    resolvedAtStage:
      decision?.resolvedAtStage || OUTPUT_RESOLVED_AT_STAGE.OUTPUT_FACADE,
    companyId,
  });
}
