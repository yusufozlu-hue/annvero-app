/**
 * Canonical snapshot hydrate reuse gate.
 * Compatible completed OUTPUT_READY jobs bind to UI; hydrate must not
 * re-run accounting, POST jobs, or POST snapshot.
 */

import { evaluateBankOutputGate } from "@/src/utils/bankOneClickPipeline";
import {
  ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  isHydrateJobResultStale,
} from "@/src/utils/bankStatementReanalyze";
import {
  armCanonicalHydrateReanalyze,
  consumeCanonicalHydrateReanalyze,
  markHydrateReanalyzeConsumed,
} from "@/src/utils/bankReanalyzeOrchestration";

export const ARCHIVED_HYDRATE_RESULT_TITLE = "Arşiv sonucu yüklendi";
export const REANALYZE_COMPLETE_TITLE = "Yeniden analiz tamamlandı";
export const ARCHIVED_HYDRATE_RESULT_SUBTITLE =
  "Mevcut arşiv sonucu yüklendi; muhasebe analizi yeniden çalıştırılmadı.";

function text(value) {
  return value == null ? "" : String(value).trim();
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

function jobMetadata(job) {
  if (!job || typeof job !== "object") return {};
  return job.metadata && typeof job.metadata === "object" ? job.metadata : {};
}

function normalizeBinding(value) {
  return text(value);
}

function sameBinding(expected, actual) {
  const a = normalizeBinding(expected);
  const b = normalizeBinding(actual);
  return Boolean(a) && Boolean(b) && a === b;
}

export function extractCanonicalHydrateJobBindings(job = null) {
  const meta = jobMetadata(job);
  const idem = metaText(meta, "idempotency_key", "idempotencyKey");
  return {
    companyId: text(job?.companyId || job?.company_id),
    sourceId:
      metaText(meta, "source_id", "sourceId") ||
      extractIdempotencyToken(idem, "src"),
    sourceRevision:
      metaText(meta, "source_revision", "sourceRevision") ||
      extractIdempotencyToken(idem, "srev"),
    snapshotFingerprint:
      metaText(meta, "snapshot_fingerprint", "snapshotFingerprint") ||
      extractIdempotencyToken(idem, "snap"),
    planFingerprint:
      metaText(meta, "plan_fingerprint", "planFingerprint") ||
      extractIdempotencyToken(idem, "plan"),
    pipelineVersion:
      metaText(meta, "pipeline_version", "pipelineVersion") ||
      extractIdempotencyToken(idem, "pipe"),
    terminalStatus: metaText(meta, "terminal_status", "terminalStatus"),
    outputGateCode: metaText(
      meta,
      "output_gate_code",
      "outputGateCode"
    ).toUpperCase(),
    idempotencyKey: idem,
  };
}

export function jobResultForHydrateOutputGate(job = null) {
  const meta = jobMetadata(job);
  const balanceCode = metaText(meta, "balance_code", "balanceCode");
  return {
    terminalStatus: metaText(meta, "terminal_status", "terminalStatus"),
    balanceCode,
    balanceMatched: balanceCode.toUpperCase() === "BALANCE_MATCHED",
    reviewRequired: Boolean(meta.review_required ?? meta.reviewRequired),
    canAutoApprove: Boolean(meta.can_auto_approve ?? meta.canAutoApprove),
    errors: Number(meta.errors || 0) || 0,
    critical: Number(meta.critical || 0) || 0,
    lowConfidence: Number(meta.low_confidence ?? meta.lowConfidence ?? 0) || 0,
    uniqueUnresolvedMovements:
      Number(meta.review_count ?? meta.reviewCount ?? 0) || 0,
    lucaRowCount: Number(meta.luca_row_count ?? meta.lucaRowCount ?? 0) || 0,
    outputGateCode: metaText(meta, "output_gate_code", "outputGateCode"),
  };
}

/**
 * Latest job for this company+source. Different source rows are skipped.
 * Other-company jobs are never selected.
 */
export function findLatestJobForHydrateSource(
  jobs = [],
  { companyId = "", sourceId = "" } = {}
) {
  const expectedCompany = text(companyId);
  const expectedSource = text(sourceId);
  if (!expectedCompany || !expectedSource) return null;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const bindings = extractCanonicalHydrateJobBindings(job);
    if (bindings.companyId && bindings.companyId !== expectedCompany) continue;
    if (bindings.sourceId && bindings.sourceId !== expectedSource) continue;
    if (!bindings.companyId || !bindings.sourceId) continue;
    return job;
  }
  return null;
}

/**
 * Hydrate reuse requires ALL bindings plus completed + OUTPUT_READY.
 * Fail closed when any expected or actual binding is missing.
 */
export function evaluateCanonicalHydrateJobCompatibility({
  expectedCompanyId = "",
  expectedSourceId = "",
  expectedSourceRevision = "",
  expectedSnapshotFingerprint = "",
  expectedPlanFingerprint = "",
  expectedPipelineVersion = ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  job = null,
  snapshotHasBalanceEvidence = false,
} = {}) {
  if (!job) {
    return { ok: false, reason: "no_job", job: null };
  }

  const expectedCompany = text(expectedCompanyId);
  const expectedSource = text(expectedSourceId);
  const expectedRevision = text(expectedSourceRevision);
  const expectedSnap = text(expectedSnapshotFingerprint);
  const expectedPlan = text(expectedPlanFingerprint);
  const expectedPipe = text(
    expectedPipelineVersion || ANNVERO_BANK_REANALYZE_PIPELINE_VERSION
  );

  if (
    !expectedCompany ||
    !expectedSource ||
    !expectedRevision ||
    !expectedSnap ||
    !expectedPlan ||
    !expectedPipe
  ) {
    return { ok: false, reason: "expected_bindings_incomplete", job };
  }

  const bindings = extractCanonicalHydrateJobBindings(job);
  if (!bindings.companyId || bindings.companyId !== expectedCompany) {
    return { ok: false, reason: "company_mismatch", job };
  }
  if (!sameBinding(expectedSource, bindings.sourceId)) {
    return { ok: false, reason: "source_mismatch", job };
  }
  if (!sameBinding(expectedRevision, bindings.sourceRevision)) {
    return { ok: false, reason: "source_revision_mismatch", job };
  }
  if (!sameBinding(expectedSnap, bindings.snapshotFingerprint)) {
    return { ok: false, reason: "snapshot_mismatch", job };
  }
  if (!sameBinding(expectedPlan, bindings.planFingerprint)) {
    return { ok: false, reason: "plan_mismatch", job };
  }
  if (!sameBinding(expectedPipe, bindings.pipelineVersion)) {
    return { ok: false, reason: "pipeline_version_stale", job };
  }

  const terminal = bindings.terminalStatus.toLowerCase();
  if (!terminal || terminal === "review_required") {
    return {
      ok: false,
      reason: terminal === "review_required" ? "review_required" : "result_incomplete",
      job,
    };
  }
  if (terminal !== "completed") {
    return { ok: false, reason: "result_incomplete", job };
  }

  if (
    isHydrateJobResultStale({
      existingMetadata: jobMetadata(job),
      expectedPipelineVersion: expectedPipe,
      snapshotHasBalanceEvidence,
    })
  ) {
    return { ok: false, reason: "balance_evidence_stale", job };
  }

  if (bindings.outputGateCode && bindings.outputGateCode !== "OUTPUT_READY") {
    return { ok: false, reason: "output_gate_closed", job };
  }

  const lucaRowCount = Number(
    jobMetadata(job).luca_row_count ?? jobMetadata(job).lucaRowCount ?? 0
  );
  const gate = evaluateBankOutputGate(jobResultForHydrateOutputGate(job), {
    lucaReady: lucaRowCount > 0,
  });
  if (!gate.allowed || gate.code !== "OUTPUT_READY") {
    return { ok: false, reason: "output_gate_closed", job };
  }

  return { ok: true, reason: "compatible_completed", job, outputGate: gate };
}

export function decideCanonicalHydrateReanalyze({
  expectedCompanyId = "",
  expectedSourceId = "",
  expectedSourceRevision = "",
  expectedSnapshotFingerprint = "",
  expectedPlanFingerprint = "",
  expectedPipelineVersion = ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  jobs = [],
  snapshotHasBalanceEvidence = false,
} = {}) {
  const expected = {
    expectedCompanyId,
    expectedSourceId,
    expectedSourceRevision,
    expectedSnapshotFingerprint,
    expectedPlanFingerprint,
    expectedPipelineVersion,
  };
  const latest = findLatestJobForHydrateSource(jobs, {
    companyId: expectedCompanyId,
    sourceId: expectedSourceId,
  });
  if (!latest) {
    return {
      arm: true,
      bindArchivedResult: false,
      reason: Array.isArray(jobs) && jobs.length ? "no_matching_job" : "no_job",
      job: null,
      message: REANALYZE_COMPLETE_TITLE,
      pipelineInvocations: 1,
      networkPersist: 1,
    };
  }

  const compat = evaluateCanonicalHydrateJobCompatibility({
    ...expected,
    job: latest,
    snapshotHasBalanceEvidence,
  });
  if (compat.ok) {
    return {
      arm: false,
      bindArchivedResult: true,
      reason: "compatible_completed",
      job: latest,
      message: ARCHIVED_HYDRATE_RESULT_TITLE,
      pipelineInvocations: 0,
      networkPersist: 0,
      outputGate: compat.outputGate,
    };
  }

  return {
    arm: true,
    bindArchivedResult: false,
    reason: compat.reason,
    job: latest,
    message: REANALYZE_COMPLETE_TITLE,
    pipelineInvocations: 1,
    networkPersist: 1,
  };
}

export function shouldSkipHydratePipeline({
  reason = "",
  expectedCompanyId = "",
  expectedSourceId = "",
  expectedSourceRevision = "",
  expectedSnapshotFingerprint = "",
  expectedPlanFingerprint = "",
  expectedPipelineVersion = ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  jobs = [],
  snapshotHasBalanceEvidence = false,
} = {}) {
  if (String(reason || "") !== "hydrate") return false;
  return decideCanonicalHydrateReanalyze({
    expectedCompanyId,
    expectedSourceId,
    expectedSourceRevision,
    expectedSnapshotFingerprint,
    expectedPlanFingerprint,
    expectedPipelineVersion,
    jobs,
    snapshotHasBalanceEvidence,
  }).bindArchivedResult;
}

export function resolveCanonicalHydrateResultTitle(result = {}) {
  if (result?.archivedHydrateResult) return ARCHIVED_HYDRATE_RESULT_TITLE;
  if (result?.reanalyze) return REANALYZE_COMPLETE_TITLE;
  return "";
}

/**
 * Archive movements must carry both bank + counter legs before Luca materialization.
 * Does not invent codes.
 */
export function movementsHaveArchiveAccountingLegs(movements = []) {
  if (!Array.isArray(movements) || movements.length === 0) return false;
  return movements.every((m) => {
    const amount = Math.abs(Number(m?.amount ?? m?.tutar ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const bank = text(m?.accountCode || m?.hesapKodu);
    const counter = text(m?.counterAccountCode || m?.karsiHesapKodu);
    return Boolean(bank && counter);
  });
}

/**
 * Preview FAIL repro: OUTPUT_READY + lucaReady metadata without real rows.
 * Handlers must not navigate; UI must not enable export buttons.
 */
export function evaluateArchiveLucaHandoffReadiness({
  movements = [],
  lucaRows = [],
  lucaReady = false,
  balanceMatched = false,
  outputGateCode = "",
  reviewRequired = false,
  fisKontrolCritical = 0,
} = {}) {
  const movementCount = Array.isArray(movements) ? movements.length : 0;
  const rowCount = Array.isArray(lucaRows) ? lucaRows.length : 0;
  const expectedRows = movementCount * 2;
  const hasLegs = movementsHaveArchiveAccountingLegs(movements);
  const balanced =
    rowCount > 0 &&
    lucaRows.every((r) => {
      const borc = Number(r?.borc || 0) || 0;
      const alacak = Number(r?.alacak || 0) || 0;
      return borc >= 0 && alacak >= 0;
    });
  // Rough voucher balance: total debit == total credit
  let totalBorc = 0;
  let totalAlacak = 0;
  for (const r of lucaRows || []) {
    totalBorc += Number(r?.borc || 0) || 0;
    totalAlacak += Number(r?.alacak || 0) || 0;
  }
  const totalsBalanced =
    rowCount > 0 && Math.abs(totalBorc - totalAlacak) < 0.005;

  let code = "OUTPUT_READY";
  let message = "Luca satırları arşivden hazır.";
  if (!balanceMatched || text(outputGateCode).toUpperCase() === "BALANCE_NOT_MATCHED") {
    code = "BALANCE_NOT_MATCHED";
    message = "Bakiye mutabakatı geçmeden çıktı açılamaz.";
  } else if (reviewRequired || Number(fisKontrolCritical) > 0) {
    code = "REVIEW_REQUIRED";
    message = "Kritik bulgular veya inceleme varken çıktı açılamaz.";
  } else if (!hasLegs) {
    code = "ACCOUNTING_LEGS_MISSING";
    message =
      "Arşiv hareketlerinde muhasebe bacakları yok. Yeniden analiz gerekir; satır uydurulmaz.";
  } else if (!lucaReady || rowCount === 0) {
    code = "LUCA_NOT_READY";
    message = "Luca satırları henüz hazırlanmadı.";
  } else if (expectedRows > 0 && rowCount !== expectedRows) {
    code = "LUCA_ROW_COUNT_MISMATCH";
    message = `Luca satır sayısı beklenenle uyuşmuyor (${rowCount}/${expectedRows}).`;
  } else if (!totalsBalanced || !balanced) {
    code = "LUCA_UNBALANCED";
    message = "Luca borç/alacak dengesi kurulamadı.";
  }

  return {
    allowed: code === "OUTPUT_READY",
    code,
    message,
    movementCount,
    lucaRowCount: rowCount,
    expectedLucaRowCount: expectedRows,
    hasAccountingLegs: hasLegs,
  };
}

/**
 * Prefer canonical statementBalanceEvidence for UI balance cards.
 * Preserves real 0 (null !== 0). Does not invent amounts when evidence is absent.
 * Job metadata remains a supporting source for gate/status codes only.
 */
function finiteBalanceOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCanonicalEvidenceForBoundResult(evidence = null) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return null;
  }
  const openingBalance = finiteBalanceOrNull(
    evidence.openingBalance ?? evidence.opening_balance
  );
  const closingBalance = finiteBalanceOrNull(
    evidence.closingBalance ?? evidence.closing_balance
  );
  // Incomplete evidence must not fabricate a balance summary for the UI.
  if (openingBalance == null || closingBalance == null) return null;
  return {
    openingBalance,
    closingBalance,
    calculatedClosing: finiteBalanceOrNull(
      evidence.calculatedClosing ??
        evidence.calculated_closing ??
        evidence.expectedClosing ??
        evidence.expected_closing
    ),
    delta: finiteBalanceOrNull(
      evidence.delta ?? evidence.balanceDelta ?? evidence.balance_delta
    ),
    debits: finiteBalanceOrNull(evidence.debits),
    credits: finiteBalanceOrNull(evidence.credits),
    code: text(evidence.code || evidence.balanceCode || evidence.balance_code),
    matched:
      evidence.matched === true ||
      evidence.balanceMatched === true ||
      String(evidence.code || evidence.balanceCode || "")
        .toUpperCase() === "BALANCE_MATCHED",
  };
}

export function buildCanonicalHydrateBoundResult({
  job = null,
  movementCount = 0,
  documentResolutionCount = 0,
  pipelineVersion = ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  staleExistingJob = false,
  archivedHydrateResult = false,
  canonicalBalanceEvidence = null,
  /** Gerçek materialize edilmiş satır sayısı — metadata luca_row_count yetmez */
  materializedLucaRowCount = null,
  archiveHandoffCode = "",
  archiveHandoffMessage = "",
} = {}) {
  const meta = jobMetadata(job);
  const metaLucaRowCount =
    Number(meta.luca_row_count ?? meta.lucaRowCount ?? 0) || 0;
  const actualLuca =
    materializedLucaRowCount == null
      ? null
      : Math.max(0, Number(materializedLucaRowCount) || 0);
  const lucaRowCount = staleExistingJob
    ? 0
    : actualLuca != null
      ? actualLuca
      : 0;
  const reviewCount = Number(meta.review_count ?? meta.reviewCount ?? 0) || 0;
  const evidence = staleExistingJob
    ? null
    : normalizeCanonicalEvidenceForBoundResult(canonicalBalanceEvidence);
  const jobBalanceCode = metaText(meta, "balance_code", "balanceCode");
  const balanceCode = evidence?.code || jobBalanceCode;
  // Metadata luca_row_count > 0 must NOT alone open the export gate (preview FAIL).
  const lucaReadyHint =
    !staleExistingJob && actualLuca != null && actualLuca > 0;
  return {
    movementCount:
      Number(meta.movement_count ?? meta.movementCount ?? movementCount) ||
      Number(movementCount) ||
      0,
    lucaRowCount,
    expectedLucaRowCount: staleExistingJob ? 0 : metaLucaRowCount,
    reviewCount: staleExistingJob ? null : reviewCount,
    uniqueUnresolvedMovements: staleExistingJob ? null : reviewCount,
    autoMatchedCount: staleExistingJob
      ? null
      : Number(meta.auto_matched_count ?? meta.autoMatchedCount ?? 0) || 0,
    terminalStatus: staleExistingJob
      ? ""
      : metaText(meta, "terminal_status", "terminalStatus"),
    reviewRequired: staleExistingJob
      ? true
      : Boolean(meta.review_required ?? meta.reviewRequired),
    canAutoApprove: staleExistingJob
      ? false
      : Boolean(meta.can_auto_approve ?? meta.canAutoApprove),
    driveArchived: Boolean(meta.drive_archived ?? meta.driveArchived),
    driveSkipped: Boolean(meta.drive_skipped ?? meta.driveSkipped),
    revision: meta.revision ?? meta.revisionNumber ?? null,
    priorJobId: job?.id || null,
    fromCanonicalSnapshot: true,
    staleExistingJob,
    archivedHydrateResult: Boolean(archivedHydrateResult) && !staleExistingJob,
    reanalyze: false,
    accountPlanCount: Number(meta.account_plan_count ?? meta.accountPlanCount ?? 0) || 0,
    documentResolutionCount: Number(documentResolutionCount) || 0,
    pipelineVersion,
    balanceCode,
    balanceMatched: evidence
      ? evidence.matched === true
      : jobBalanceCode.toUpperCase() === "BALANCE_MATCHED",
    outputGateCode: metaText(meta, "output_gate_code", "outputGateCode"),
    lucaReadyHint,
    archiveHandoffCode: text(archiveHandoffCode),
    archiveHandoffMessage: text(archiveHandoffMessage),
    legacyArchiveNeedsPrepare: Boolean(
      !staleExistingJob &&
        archivedHydrateResult &&
        actualLuca === 0 &&
        (text(archiveHandoffCode) === "LEGACY_ARCHIVE_NEEDS_PREPARE" ||
          text(archiveHandoffCode) === "ACCOUNTING_LEGS_MISSING" ||
          text(archiveHandoffCode) === "LEGACY_ARCHIVE_PREPARE_FAILED" ||
          text(archiveHandoffCode) === "LUCA_MATERIALIZE_FAILED")
    ),
    // UI BankPipelineResultCard balanceStats keys (preserve real 0).
    openingBalance: evidence ? evidence.openingBalance : null,
    statementClosingBalance: evidence ? evidence.closingBalance : null,
    computedClosingBalance: evidence
      ? evidence.calculatedClosing ?? evidence.closingBalance
      : null,
    reconciliationDelta: evidence ? evidence.delta : null,
    totalDebit: evidence ? evidence.debits : null,
    totalCredit: evidence ? evidence.credits : null,
    hasStatementBalanceEvidence: Boolean(evidence),
  };
}

/**
 * Page-open hydrate + single-flight consume. Tests count pipeline/network here.
 * Manual reanalyze must call invokePipeline separately (never skipped here).
 */
export function runCanonicalHydrateReanalyzeIfNeeded({
  expectedCompanyId = "",
  expectedSourceId = "",
  expectedSourceRevision = "",
  expectedSnapshotFingerprint = "",
  expectedPlanFingerprint = "",
  expectedPipelineVersion = ANNVERO_BANK_REANALYZE_PIPELINE_VERSION,
  jobs = [],
  snapshotHasBalanceEvidence = false,
  flightKey = "",
  invokePipeline = null,
} = {}) {
  const decision = decideCanonicalHydrateReanalyze({
    expectedCompanyId,
    expectedSourceId,
    expectedSourceRevision,
    expectedSnapshotFingerprint,
    expectedPlanFingerprint,
    expectedPipelineVersion,
    jobs,
    snapshotHasBalanceEvidence,
  });
  if (!decision.arm) {
    if (flightKey) markHydrateReanalyzeConsumed(flightKey);
    return {
      ...decision,
      invoked: false,
      pipelineInvocations: 0,
      networkPersist: 0,
      jobsPosted: 0,
      snapshotPosted: 0,
    };
  }

  const armed = armCanonicalHydrateReanalyze(flightKey);
  if (!armed.armed) {
    return {
      ...decision,
      invoked: false,
      pipelineInvocations: 0,
      networkPersist: 0,
      jobsPosted: 0,
      snapshotPosted: 0,
      alreadyConsumed: armed.alreadyConsumed,
    };
  }
  if (!consumeCanonicalHydrateReanalyze(flightKey)) {
    return {
      ...decision,
      invoked: false,
      pipelineInvocations: 0,
      networkPersist: 0,
      jobsPosted: 0,
      snapshotPosted: 0,
    };
  }

  if (typeof invokePipeline === "function") invokePipeline();
  return {
    ...decision,
    invoked: true,
    pipelineInvocations: 1,
    networkPersist: 1,
    jobsPosted: 1,
    snapshotPosted: 1,
  };
}
