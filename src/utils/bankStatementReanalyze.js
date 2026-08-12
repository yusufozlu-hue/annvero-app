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

/**
 * Mevcut completed job bu istemci pipeline sürümüyle uyumlu mu?
 * Uyumsuz / eksik result → yeni idempotent uçuş açılmalı.
 */
export function isCompatibleExistingReanalyzeJob({
  existingMetadata = null,
  expectedIdempotencyKey = "",
  expectedPipelineVersion = ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
} = {}) {
  const meta = existingMetadata && typeof existingMetadata === "object"
    ? existingMetadata
    : {};
  const existingKey = String(meta.idempotency_key || meta.idempotencyKey || "").trim();
  const expected = String(expectedIdempotencyKey || "").trim();
  if (!existingKey || !expected || existingKey !== expected) {
    return { ok: false, reason: "idempotency_mismatch" };
  }
  const pipeToken = `:pipe:${String(expectedPipelineVersion || "").trim()}`;
  if (pipeToken.length > 6 && !existingKey.includes(pipeToken)) {
    return { ok: false, reason: "pipeline_version_stale" };
  }
  const terminal = String(meta.terminal_status || meta.terminalStatus || "").trim();
  if (!terminal) {
    return { ok: false, reason: "result_incomplete" };
  }
  return { ok: true, reason: "compatible" };
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
