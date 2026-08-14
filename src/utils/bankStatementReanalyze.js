/**
 * Banka Parser — yeni hesap planıyla yeniden analiz (revision).
 * Normal mükerrer yükleme engeli korunur; yalnız açık reanalyze yolu izinlidir.
 */

import {
  ANNVERO_V1_ENGINE_VERSION,
  buildIdempotencyKey,
} from "@/src/utils/annveroV1Orchestration";
import { VADELI_LIFECYCLE_ALGORITHM_VERSION } from "@/src/utils/vadeliMevduatLifecycle";

export const REANALYZE_BUTTON_LABEL =
  "Yeni hesap planıyla yeniden analiz et";

export const REANALYZE_UI_HINT =
  "Kalıcı canonical hareket snapshot'ı ve arşiv kaynağı ile yeni aktif hesap planı uygulanır; dosya yeniden yüklenmez, ikinci Drive/source oluşturulmaz.";

/**
 * Deterministik reanalyze pipeline sürümü.
 * Engine + lifecycle birlikte; kod/algoritma değişince eski completed job reuse edilmez.
 */
export const ANNVERO_BANK_REANALYZE_PIPELINE_VERSION = [
  "br/2.1.0",
  VADELI_LIFECYCLE_ALGORITHM_VERSION,
].join("+");

/** Dosyasız reanalyze — checkpoint veya File şart değil; snapshot yeterli. */
export function canFilelessReanalyze({
  hasFile = false,
  hasCheckpoint = false,
  hasCanonicalSnapshot = false,
} = {}) {
  return Boolean(hasFile || hasCheckpoint || hasCanonicalSnapshot);
}

/**
 * @param {{
 *   companyId?: string,
 *   contentHash?: string,
 *   revision?: number,
 *   engineVersion?: string,
 *   planFingerprint?: string,
 *   pipelineVersion?: string,
 *   sourceId?: string,
 *   sourceRevision?: number|string,
 *   snapshotFingerprint?: string,
 * }} opts
 */
export function buildRevisionIdempotencyKey({
  companyId = "",
  contentHash = "",
  revision = 2,
  engineVersion = ANNVERO_V1_ENGINE_VERSION,
  planFingerprint = "",
  pipelineVersion = ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  sourceId = "",
  sourceRevision = "",
  snapshotFingerprint = "",
} = {}) {
  const base = buildIdempotencyKey({
    companyId,
    contentHash,
    engineVersion,
  });
  const rev = Math.max(2, Number(revision) || 2);
  const plan = String(planFingerprint || "")
    .trim()
    .slice(0, 64);
  const pipe = String(pipelineVersion || ANNVERO_BANK_REANALYZE_PIPELINE_VERSION)
    .trim()
    .slice(0, 96);
  const src = String(sourceId || "")
    .trim()
    .slice(0, 36);
  const srev = String(sourceRevision ?? "")
    .trim()
    .slice(0, 16);
  const snap = String(snapshotFingerprint || contentHash || "")
    .trim()
    .slice(0, 64);
  // Aynı kod+source+plan → dedupe; farklı pipelineVersion → yeni uçuş
  const parts = [base, `rev:${rev}`];
  if (plan) parts.push(`plan:${plan}`);
  if (pipe) parts.push(`pipe:${pipe}`);
  if (src) parts.push(`src:${src}`);
  if (srev) parts.push(`srev:${srev}`);
  if (snap) parts.push(`snap:${snap}`);
  return parts.join(":");
}

function metaText(meta, ...keys) {
  for (const key of keys) {
    const value = meta?.[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function extractIdempotencyToken(key, label) {
  const raw = String(key || "");
  const match = raw.match(new RegExp(`:${label}:([^:]+)`));
  return match ? match[1] : "";
}

const STALE_BALANCE_CODES = new Set([
  "BALANCE_EVIDENCE_MISSING",
  "BALANCE_EMPTY",
  "MISSING_OPENING_BALANCE",
  "MISSING_CLOSING_BALANCE",
]);

/**
 * Mevcut job bu istemci pipeline + sonuç sürümüyle uyumlu mu?
 * Uyumsuz / eksik / stale result → yeni idempotent uçuş açılmalı.
 */
export function isCompatibleExistingReanalyzeJob({
  existingMetadata = null,
  expectedIdempotencyKey = "",
  expectedPipelineVersion = ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  incomingSummary = null,
} = {}) {
  const meta =
    existingMetadata && typeof existingMetadata === "object"
      ? existingMetadata
      : {};
  const incoming =
    incomingSummary && typeof incomingSummary === "object"
      ? incomingSummary
      : {};
  const existingKey = String(
    meta.idempotency_key || meta.idempotencyKey || ""
  ).trim();
  const expected = String(expectedIdempotencyKey || "").trim();
  if (!existingKey || !expected || existingKey !== expected) {
    return { ok: false, reason: "idempotency_mismatch" };
  }

  const expectedPipe = String(
    expectedPipelineVersion ||
      incoming.pipelineVersion ||
      incoming.pipeline_version ||
      ANNVERO_BANK_REANALYZE_PIPELINE_VERSION
  ).trim();
  const pipeToken = `:pipe:${expectedPipe}`;
  if (pipeToken.length > 6 && !existingKey.includes(pipeToken)) {
    return { ok: false, reason: "pipeline_version_stale" };
  }

  const incomingEngine = metaText(
    incoming,
    "engineVersion",
    "engine_version"
  );
  const existingEngine = metaText(meta, "engine_version", "engineVersion");
  if (incomingEngine && existingEngine && incomingEngine !== existingEngine) {
    return { ok: false, reason: "engine_mismatch" };
  }

  const incomingSrc = metaText(incoming, "sourceId", "source_id");
  const existingSrc =
    metaText(meta, "source_id", "sourceId") ||
    extractIdempotencyToken(existingKey, "src");
  if (incomingSrc && existingSrc && incomingSrc !== existingSrc) {
    return { ok: false, reason: "source_mismatch" };
  }

  const incomingSrev = metaText(
    incoming,
    "sourceRevision",
    "source_revision"
  );
  const existingSrev =
    metaText(meta, "source_revision", "sourceRevision") ||
    extractIdempotencyToken(existingKey, "srev");
  if (incomingSrev && existingSrev && incomingSrev !== existingSrev) {
    return { ok: false, reason: "source_revision_mismatch" };
  }

  const incomingSnap = metaText(
    incoming,
    "snapshotFingerprint",
    "snapshot_fingerprint"
  );
  const existingSnap =
    metaText(meta, "snapshot_fingerprint", "snapshotFingerprint") ||
    extractIdempotencyToken(existingKey, "snap");
  if (incomingSnap && existingSnap && incomingSnap !== existingSnap) {
    return { ok: false, reason: "snapshot_mismatch" };
  }

  const incomingPlan = metaText(
    incoming,
    "planFingerprint",
    "plan_fingerprint"
  );
  const existingPlan =
    metaText(meta, "plan_fingerprint", "planFingerprint") ||
    extractIdempotencyToken(existingKey, "plan");
  if (incomingPlan && existingPlan && incomingPlan !== existingPlan) {
    return { ok: false, reason: "plan_mismatch" };
  }

  const terminal = String(
    meta.terminal_status || meta.terminalStatus || ""
  ).trim();
  if (!terminal) {
    return { ok: false, reason: "result_incomplete" };
  }

  const incomingBalance = metaText(
    incoming,
    "balanceCode",
    "balance_code"
  ).toUpperCase();
  const existingBalance = metaText(meta, "balance_code", "balanceCode").toUpperCase();
  if (
    incomingBalance &&
    incomingBalance !== existingBalance &&
    (STALE_BALANCE_CODES.has(existingBalance) ||
      incomingBalance === "BALANCE_MATCHED")
  ) {
    return { ok: false, reason: "result_stale" };
  }

  const incomingTerminal = metaText(
    incoming,
    "terminalStatus",
    "terminal_status"
  );
  const incomingGate = metaText(
    incoming,
    "outputGateCode",
    "output_gate_code"
  ).toUpperCase();
  if (
    incomingTerminal === "completed" &&
    incomingGate === "OUTPUT_READY" &&
    terminal === "review_required" &&
    (STALE_BALANCE_CODES.has(existingBalance) || !existingBalance)
  ) {
    return { ok: false, reason: "result_stale" };
  }

  return { ok: true, reason: "compatible" };
}

/**
 * Persist tek-istek kararı — client force bypass yok.
 * reuse: aynı version+sonuç → mevcut job
 * join: aynı version aktif/incomplete uçuş
 * create: stale/uyumsuz → aynı request içinde yeni satır
 * deny: tenant uyuşmazlığı
 */
export function assertSourceTenantMatch({
  requestCompanyId = "",
  sourceCompanyId = "",
  sourceId = "",
} = {}) {
  const source = String(sourceId || "").trim();
  if (!source) return { ok: true, code: "NO_SOURCE" };
  const requestCompany = String(requestCompanyId || "").trim();
  const sourceCompany = String(sourceCompanyId || "").trim();
  if (!requestCompany || !sourceCompany || requestCompany !== sourceCompany) {
    return {
      ok: false,
      status: 403,
      code: "SOURCE_NOT_IN_COMPANY",
    };
  }
  return { ok: true, code: "SOURCE_OWNED" };
}

export function evaluateV1PersistIdempotencyDecision({
  incomingIdempotencyKey = "",
  incomingCompanyId = "",
  incomingSummary = null,
  expectedPipelineVersion = ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  existingRow = null,
  incomingLeaseId = "",
  activeLeaseId = "",
} = {}) {
  const incomingCompany = String(incomingCompanyId || "").trim();
  if (existingRow) {
    const existingCompany = String(
      existingRow.company_id || existingRow.companyId || ""
    ).trim();
    if (
      incomingCompany &&
      existingCompany &&
      incomingCompany !== existingCompany
    ) {
      return {
        action: "deny",
        status: 403,
        code: "CROSS_TENANT_FORBIDDEN",
        existingJob: false,
        compatible: false,
        reason: "company_mismatch",
      };
    }
  }

  if (!existingRow) {
    return {
      action: "create",
      existingJob: false,
      compatible: false,
      reason: "no_existing",
    };
  }

  const compat = isCompatibleExistingReanalyzeJob({
    existingMetadata: existingRow.metadata || {},
    expectedIdempotencyKey: incomingIdempotencyKey,
    expectedPipelineVersion,
    incomingSummary,
  });

  if (compat.ok) {
    return {
      action: "reuse",
      existingJob: true,
      compatible: true,
      reason: "compatible",
    };
  }

  if (compat.reason === "result_incomplete") {
    const active = String(activeLeaseId || "").trim();
    const ours = String(incomingLeaseId || "").trim();
    if (active && ours && active !== ours) {
      return {
        action: "join",
        existingJob: true,
        compatible: true,
        reason: "active_flight",
      };
    }
    return {
      action: "create",
      existingJob: false,
      compatible: false,
      reason: "result_incomplete",
      supersededJobId: existingRow.id || null,
    };
  }

  return {
    action: "create",
    existingJob: false,
    compatible: false,
    reason: compat.reason,
    supersededJobId: existingRow.id || null,
  };
}

/**
 * Hydrate: snapshot evidence varken job hâlâ EVIDENCE_MISSING ise stale.
 */
export function isHydrateJobResultStale({
  existingMetadata = null,
  expectedPipelineVersion = ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  snapshotHasBalanceEvidence = false,
} = {}) {
  const meta =
    existingMetadata && typeof existingMetadata === "object"
      ? existingMetadata
      : {};
  const existingKey = String(
    meta.idempotency_key || meta.idempotencyKey || ""
  ).trim();
  const pipeToken = `:pipe:${String(expectedPipelineVersion || "").trim()}`;
  if (!existingKey || (pipeToken.length > 6 && !existingKey.includes(pipeToken))) {
    return true;
  }
  if (!snapshotHasBalanceEvidence) return false;
  const existingBalance = metaText(meta, "balance_code", "balanceCode").toUpperCase();
  return STALE_BALANCE_CODES.has(existingBalance) || !existingBalance;
}

export function nextRevisionNumber(priorRevision = 1) {
  const n = Number(priorRevision);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.floor(n) + 1;
}

/**
 * Cross-tenant koruması — başka firmanın job/plan/source kullanılamaz.
 * @returns {{ ok: true } | { ok: false, status: 403, code: string, message: string }}
 */
export function assertSameTenantReanalyze({
  requestCompanyId = "",
  priorCompanyId = "",
} = {}) {
  const req = String(requestCompanyId || "").trim();
  const prior = String(priorCompanyId || "").trim();
  if (!req || !prior) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_COMPANY_ID",
      message: "Firma seçilmedi.",
    };
  }
  if (req !== prior) {
    return {
      ok: false,
      status: 403,
      code: "CROSS_TENANT_FORBIDDEN",
      message: "Başka firmanın kaynağı veya planı kullanılamaz.",
    };
  }
  return { ok: true };
}

export function shouldBypassIdempotencyHistoryBlock(reanalyze = false) {
  return Boolean(reanalyze);
}

export function shouldSkipDriveArchiveOnReanalyze(reanalyze = false) {
  return Boolean(reanalyze);
}

export function shouldBypassSessionDedupBlock(reanalyze = false) {
  return Boolean(reanalyze);
}

/**
 * Önceki / yeni sonuç sayaçları.
 */
export function extractAnalysisCounters(source = {}) {
  const meta = source.metadata || source;
  const autoMatched = Number(
    meta.autoMatchedCount ??
      meta.auto_matched_count ??
      meta.uniqueMatchedMovements ??
      meta.unique_matched_movements ??
      0
  );
  const remainingReview = Number(
    meta.remainingReview ??
      meta.uniqueUnresolvedMovements ??
      meta.unique_unresolved_movements ??
      meta.reviewCount ??
      meta.review_count ??
      meta.unrecognizedCount ??
      0
  );
  const resolvedMissing = Number(
    meta.resolvedMissing ?? meta.resolved_missing_count ?? 0
  );
  const trulyNotFound = Number(
    meta.trulyNotFound ?? meta.truly_not_found_count ?? 0
  );
  const accountPlanCount = Number(
    meta.accountPlanCount ?? meta.account_plan_count ?? 0
  );
  return {
    autoMatched: Number.isFinite(autoMatched) ? autoMatched : 0,
    remainingReview: Number.isFinite(remainingReview) ? remainingReview : 0,
    resolvedMissing: Number.isFinite(resolvedMissing) ? resolvedMissing : 0,
    trulyNotFound: Number.isFinite(trulyNotFound) ? trulyNotFound : 0,
    accountPlanCount: Number.isFinite(accountPlanCount) ? accountPlanCount : 0,
  };
}

/**
 * Yeniden analiz sonrası: önceki çözülmemiş − yeni çözülmemiş = çözülen eksik.
 * Gerçekten bulunamayan: önerisiz / partyUnresolved hareket sayısı.
 */
export function deriveRevisionCounters({
  previous = {},
  next = {},
  trulyNotFoundCount = null,
} = {}) {
  const prev = extractAnalysisCounters(previous);
  const nxt = extractAnalysisCounters(next);
  const trulyNotFound =
    trulyNotFoundCount != null && Number.isFinite(Number(trulyNotFoundCount))
      ? Number(trulyNotFoundCount)
      : nxt.trulyNotFound;
  const resolvedMissing = Math.max(
    0,
    prev.remainingReview - nxt.remainingReview
  );
  return {
    previous: prev,
    next: {
      ...nxt,
      resolvedMissing,
      trulyNotFound,
    },
    resolvedMissing,
    trulyNotFound,
  };
}

export function buildRevisionCompareView(compare = {}) {
  const prev = compare.previous || extractAnalysisCounters({});
  const next = compare.next || extractAnalysisCounters({});
  return {
    previous: prev,
    next: next,
    rows: [
      {
        key: "autoMatched",
        label: "Otomatik eşleşen",
        previous: prev.autoMatched,
        next: next.autoMatched,
      },
      {
        key: "remainingReview",
        label: "Kalan inceleme",
        previous: prev.remainingReview,
        next: next.remainingReview,
      },
      {
        key: "resolvedMissing",
        label: "Çözülen eksik",
        previous: prev.resolvedMissing,
        next: next.resolvedMissing ?? compare.resolvedMissing ?? 0,
      },
      {
        key: "trulyNotFound",
        label: "Gerçekten bulunamayan",
        previous: prev.trulyNotFound,
        next: next.trulyNotFound ?? compare.trulyNotFound ?? 0,
      },
    ],
  };
}

/**
 * Persist gövdesi için güvenli revision alanları.
 */
export function buildReanalyzePersistFields({
  reanalyze = false,
  revisionOf = "",
  revision = 2,
  supersedesJobId = "",
  accountPlanCount = 0,
  resolvedMissingCount = 0,
  trulyNotFoundCount = 0,
} = {}) {
  if (!reanalyze) return {};
  return {
    reanalyze: true,
    revision: Math.max(2, Number(revision) || 2),
    revision_of: String(revisionOf || "").trim().slice(0, 80),
    supersedes_job_id: String(supersedesJobId || revisionOf || "")
      .trim()
      .slice(0, 80),
    account_plan_count: Math.max(0, Number(accountPlanCount) || 0),
    resolved_missing_count: Math.max(0, Number(resolvedMissingCount) || 0),
    truly_not_found_count: Math.max(0, Number(trulyNotFoundCount) || 0),
  };
}

/**
 * Drive / source — reanalyze yeni kayıt üretmez.
 */
export function buildSkippedArchiveSummaryFromPrior(priorMeta = {}) {
  return {
    ok: true,
    skipped: true,
    duplicate: true,
    code: "REANALYZE_REUSE_ARCHIVE",
    message: "Mevcut Drive arşivi yeniden kullanıldı; ikinci kopya yok.",
    safeSummary: {
      archived: Boolean(priorMeta.drive_archived ?? priorMeta.driveArchived),
      skipped: true,
      duplicate: true,
      reanalyzeReuse: true,
    },
  };
}

/**
 * Öneri olmayan / partyUnresolved gruplardan “gerçekten bulunamayan” sayacı.
 */
export function countTrulyNotFoundFromGroups(groups = []) {
  let movements = 0;
  for (const g of groups || []) {
    const noSuggestion = !String(g.suggestedAccount || "").trim();
    const unresolved = Boolean(g.partyUnresolved || g.partyUnresolvedForced);
    if (noSuggestion || unresolved) {
      movements += Number(g.count) || (g.rowIds || []).length || 0;
    }
  }
  return movements;
}
