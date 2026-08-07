/**
 * Tek tuş banka üretim hattı — saf progress / guard / UI yardımcıları.
 */

export const PIPELINE_PHASES = Object.freeze({
  IDLE: "IDLE",
  PARSING: "PARSING",
  PREVIEW: "PREVIEW",
  ACCOUNTING_ANALYSIS: "ACCOUNTING_ANALYSIS",
  LUCA_BUILD: "LUCA_BUILD",
  VALIDATION: "VALIDATION",
  READY_FOR_EXPORT: "READY_FOR_EXPORT",
  ERROR: "ERROR",
  CANCELLED: "CANCELLED",
});

/** Global yüzde bantları (local 0–100 bu aralığa map edilir). */
export const PROGRESS_BANDS = Object.freeze({
  PARSING: { from: 0, to: 20, label: "Dosya okunuyor…" },
  PREVIEW: { from: 20, to: 30, label: "Ön izleme hazırlanıyor…" },
  ACCOUNTING_ANALYSIS: {
    from: 30,
    to: 75,
    label: "Muhasebe kuralları uygulanıyor…",
  },
  LUCA_BUILD: {
    from: 75,
    to: 90,
    label: "Luca fiş satırları hazırlanıyor…",
  },
  VALIDATION: {
    from: 90,
    to: 99,
    label: "Eksik hesaplar ve sonuçlar kontrol ediliyor…",
  },
  READY_FOR_EXPORT: {
    from: 100,
    to: 100,
    label: "Luca dosyanız hazır.",
  },
});

export const PIPELINE_STAGE_ORDER = Object.freeze([
  "PARSING",
  "PREVIEW",
  "ACCOUNTING_ANALYSIS",
  "LUCA_BUILD",
  "VALIDATION",
]);

/** Kullanıcıya gösterilen 5 adımlık liste */
export const PIPELINE_UI_STEPS = Object.freeze([
  { id: "file", label: "Dosya okundu", phase: "PARSING" },
  { id: "movements", label: "Hareketler ayrıştırıldı", phase: "PREVIEW" },
  {
    id: "analysis",
    label: "Muhasebe analizi tamamlandı",
    phase: "ACCOUNTING_ANALYSIS",
  },
  { id: "luca", label: "Luca satırları hazırlandı", phase: "LUCA_BUILD" },
  {
    id: "validation",
    label: "Son kontroller tamamlandı",
    phase: "VALIDATION",
  },
]);

const PHASE_TO_UI_INDEX = Object.freeze({
  IDLE: -1,
  PARSING: 0,
  PREVIEW: 1,
  ACCOUNTING_ANALYSIS: 2,
  LUCA_BUILD: 3,
  VALIDATION: 4,
  READY_FOR_EXPORT: 5,
});

export function mapLocalProgressToGlobal(phase, localPercent = 0) {
  const band = PROGRESS_BANDS[phase];
  if (!band) return 0;
  if (phase === PIPELINE_PHASES.READY_FOR_EXPORT) return 100;
  const local = Math.max(0, Math.min(100, Number(localPercent) || 0));
  return Math.round(band.from + ((band.to - band.from) * local) / 100);
}

export function getPipelinePhaseLabel(phase, detail = "") {
  const band = PROGRESS_BANDS[phase];
  if (!band) return detail || "";
  const d = String(detail || "");

  if (phase === PIPELINE_PHASES.PARSING) {
    if (/format|do[gğ]rula|banka/i.test(d)) return "Banka formatı doğrulanıyor…";
    if (/ayr[ıi]ş|parse|hareket/i.test(d)) return "Hareketler ayrıştırılıyor…";
    return "Dosya okunuyor…";
  }

  if (phase === PIPELINE_PHASES.ACCOUNTING_ANALYSIS) {
    if (/cari/i.test(d)) return "Cari hesaplar eşleştiriliyor…";
    if (/haf[ıi]za|memory/i.test(d)) return "Firma hafızası kontrol ediliyor…";
    return "Muhasebe kuralları uygulanıyor…";
  }

  return band.label;
}

export function getPipelinePhaseTitle(phase) {
  switch (phase) {
    case PIPELINE_PHASES.PARSING:
      return "Dosya okuma";
    case PIPELINE_PHASES.PREVIEW:
      return "Ön izleme";
    case PIPELINE_PHASES.ACCOUNTING_ANALYSIS:
      return "Muhasebe analizi";
    case PIPELINE_PHASES.LUCA_BUILD:
      return "Luca hazırlama";
    case PIPELINE_PHASES.VALIDATION:
      return "Son kontroller";
    case PIPELINE_PHASES.READY_FOR_EXPORT:
      return "Hazır";
    default:
      return "İşleniyor";
  }
}

/**
 * @returns {{ id: string, label: string, phase: string, status: 'pending'|'active'|'done'|'error'|'cancelled' }[]}
 */
export function getPipelineUiStepStatuses(phase, { errorPhase } = {}) {
  if (phase === PIPELINE_PHASES.READY_FOR_EXPORT) {
    return PIPELINE_UI_STEPS.map((step) => ({ ...step, status: "done" }));
  }

  if (phase === PIPELINE_PHASES.CANCELLED) {
    return PIPELINE_UI_STEPS.map((step) => ({ ...step, status: "cancelled" }));
  }

  if (phase === PIPELINE_PHASES.ERROR) {
    const errIdx = PHASE_TO_UI_INDEX[errorPhase] ?? 0;
    return PIPELINE_UI_STEPS.map((step, i) => ({
      ...step,
      status: i < errIdx ? "done" : i === errIdx ? "error" : "pending",
    }));
  }

  const idx = PHASE_TO_UI_INDEX[phase];
  if (idx == null || idx < 0) {
    return PIPELINE_UI_STEPS.map((step) => ({ ...step, status: "pending" }));
  }

  return PIPELINE_UI_STEPS.map((step, i) => ({
    ...step,
    status: i < idx ? "done" : i === idx ? "active" : "pending",
  }));
}

export function canStartFullPipeline({
  selectedCompanyId,
  selectedBank,
  selectedFile,
  isJobBusy,
  pipelinePhase,
  fromCanonicalSnapshot = false,
} = {}) {
  if (!selectedCompanyId || !selectedBank) return false;
  if (!selectedFile && !fromCanonicalSnapshot) return false;
  if (isJobBusy) return false;
  const idlePhases = new Set([
    PIPELINE_PHASES.IDLE,
    PIPELINE_PHASES.READY_FOR_EXPORT,
    PIPELINE_PHASES.ERROR,
    PIPELINE_PHASES.CANCELLED,
    "",
    null,
    undefined,
  ]);
  if (pipelinePhase && !idlePhases.has(pipelinePhase)) return false;
  return true;
}

/**
 * Luca / ElektraWeb yalnız mutabık, eksiksiz ve Fiş Kontrol'den geçen
 * sonuçlarda açılır. UI ve orkestrasyon aynı kapıyı kullanır.
 */
export function evaluateBankOutputGate(result = {}, { lucaReady = true } = {}) {
  const duplicate =
    Boolean(result.duplicate) ||
    result.code === "DUPLICATE_CONTENT" ||
    result.terminalStatus === "duplicate";
  const balanceMatched =
    result.balanceMatched === true || result.balanceCode === "BALANCE_MATCHED";
  const errors = Math.max(0, Number(result.errors) || 0);
  const critical = Math.max(0, Number(result.critical) || 0);
  const lowConfidence = Math.max(0, Number(result.lowConfidence) || 0);
  const unresolved = Math.max(
    0,
    Number(
      result.uniqueUnresolvedMovements ??
        result.unresolvedMovementCount ??
        result.missingCount ??
        result.reviewCount ??
        0
    ) || 0
  );
  const reviewRequired = Boolean(result.reviewRequired);
  const fisKontrolPassed =
    result.fisKontrolPassed === true || result.canAutoApprove === true;

  let code = "OUTPUT_READY";
  let message = "Luca / ElektraWeb çıktıları hazır.";
  if (duplicate) {
    code = "DUPLICATE_CONTENT";
    message = "Mükerrer ekstre için yeni çıktı üretilmez.";
  } else if (!balanceMatched) {
    code = "BALANCE_NOT_MATCHED";
    message = "Bakiye mutabakatı geçmeden Luca / ElektraWeb çıktısı üretilemez.";
  } else if (errors > 0 || critical > 0) {
    code = "CRITICAL_FINDINGS";
    message = "Kritik bulgular çözülmeden çıktı üretilemez.";
  } else if (unresolved > 0) {
    code = "UNRESOLVED_ACCOUNTS";
    message = "Gerekli hesaplar çözülmeden çıktı üretilemez.";
  } else if (lowConfidence > 0 || reviewRequired || !fisKontrolPassed) {
    code = "REVIEW_REQUIRED";
    message = "Düşük güvenli satırlar onaylanıp Fiş Kontrol geçmeden çıktı üretilemez.";
  } else if (!lucaReady) {
    code = "LUCA_NOT_READY";
    message = "Luca satırları henüz hazırlanmadı.";
  }

  return {
    allowed: code === "OUTPUT_READY",
    code,
    message,
    balanceMatched,
    errors,
    critical,
    lowConfidence,
    unresolved,
  };
}

/** Dosya seçiminin kilitli olduğu gerçek çalışma aşamaları. */
export const BANK_FILE_SELECT_BUSY_STATES = Object.freeze([
  "reading",
  "uploading",
  "parsing",
  "analyzing",
  "syncing",
  "persisting",
  "validating",
  "archiving",
  "deduplicating",
  "applying_core",
  "applying_memory",
  "creating_vouchers",
  "controlling_vouchers",
  "reconciling_edefter",
  "generating_exports",
]);

/** Dosya seçiminin tekrar açıldığı terminal durumlar. */
export const BANK_FILE_SELECT_TERMINAL_STATES = Object.freeze([
  "idle",
  "completed",
  "review_required",
  "duplicate",
  "balance_mismatch",
  "error",
  "failed",
  "cancelled",
  "ocr_required",
]);

const BANK_FILE_SELECT_BUSY_SET = new Set(BANK_FILE_SELECT_BUSY_STATES);
const BANK_FILE_SELECT_TERMINAL_SET = new Set(BANK_FILE_SELECT_TERMINAL_STATES);

function normalizeBankJobStatus(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Dosya seçimi yalnız gerçek busy aşamalarında kilitlenir; tüm terminal
 * durumlarda (mükerrer dahil) yeniden dosya seçilebilir.
 */
export function evaluateBankFileSelection({
  status = "",
  running = false,
  hasFile = false,
} = {}) {
  const normalized = normalizeBankJobStatus(status);
  const terminal = BANK_FILE_SELECT_TERMINAL_SET.has(normalized);
  const busy = !terminal && (BANK_FILE_SELECT_BUSY_SET.has(normalized) || Boolean(running));

  return {
    status: normalized || "idle",
    busy,
    terminal: !busy,
    locked: busy,
    canSelectFile: !busy,
    canPickNewFile: !busy,
    canReprocess: !busy && Boolean(hasFile),
  };
}

export function isBankFileSelectionLocked(state = {}) {
  return evaluateBankFileSelection(state).locked;
}

export function shouldRunPipelineStage(resumeFrom, stage) {
  if (!resumeFrom) return true;
  const startIdx = PIPELINE_STAGE_ORDER.indexOf(resumeFrom);
  const stageIdx = PIPELINE_STAGE_ORDER.indexOf(stage);
  if (startIdx < 0 || stageIdx < 0) return true;
  return stageIdx >= startIdx;
}

export function createAbortError(message = "İşlem iptal edildi.") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

export function assertPipelineSignal(signal, isRunActive, runId) {
  if (signal?.aborted || (typeof isRunActive === "function" && !isRunActive(runId))) {
    throw createAbortError();
  }
}

export function userFacingPipelineError(phase) {
  const map = {
    PARSING: "Dosya okunamadı. Lütfen dosyayı kontrol edip tekrar deneyin.",
    PREVIEW: "Ön izleme oluşturulamadı. Lütfen tekrar deneyin.",
    ACCOUNTING_ANALYSIS:
      "Muhasebe analizi tamamlanamadı. Lütfen tekrar deneyin.",
    LUCA_BUILD: "Luca satırları hazırlanamadı. Lütfen tekrar deneyin.",
    VALIDATION: "Sonuç kontrolü tamamlanamadı. Lütfen tekrar deneyin.",
  };
  return map[phase] || "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
}

export function formatDurationMs(ms) {
  const n = Math.max(0, Math.round(Number(ms) || 0));
  if (n < 1000) return `${n} ms`;
  const sec = n / 1000;
  if (sec < 60) return `${sec.toFixed(1)} sn`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m} dk ${s} sn`;
}

/** mm:ss — timer UI */
export function formatElapsedClock(totalSeconds = 0) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function buildMissingAccountsHint(missingCount) {
  const n = Number(missingCount) || 0;
  if (n <= 0) return "";
  return `${n} satırda hesap bilgisi eksik. Tam dosyayı indirmeden önce inceleyebilir veya eksik satırlar hariç çıktı oluşturabilirsiniz.`;
}

/**
 * Otomatik eşleşen hareket sayısı.
 * Tercihen uniqueMatchedMovements; yoksa ready Luca / 2 tahmini.
 */
export function deriveAutoMatchedMovements(readyLucaCount, options = {}) {
  if (
    options.uniqueMatchedMovements != null &&
    Number.isFinite(Number(options.uniqueMatchedMovements))
  ) {
    return Math.max(0, Number(options.uniqueMatchedMovements));
  }
  const ready = Number(readyLucaCount);
  if (!Number.isFinite(ready) || ready < 0) return null;
  return Math.max(0, Math.round(ready / 2));
}

/** Tanınmayan / unresolved benzersiz hareket */
export function deriveUnresolvedMovements(missingLucaCount, options = {}) {
  if (
    options.uniqueUnresolvedMovements != null &&
    Number.isFinite(Number(options.uniqueUnresolvedMovements))
  ) {
    return Math.max(0, Number(options.uniqueUnresolvedMovements));
  }
  const missing = Number(missingLucaCount);
  if (!Number.isFinite(missing) || missing < 0) return null;
  return Math.max(0, Math.round(missing / 2));
}

export const BANK_PARSER_DEBUG_STORAGE_KEY = "ANNVERO_BANK_DEBUG";

/**
 * Servis / debug UI (Gelişmiş / Manuel Kontrol, teknik paneller).
 *
 * Normal ürün ekranı her zaman kapalıdır.
 * Açmak için localStorage ANNVERO_BANK_DEBUG=1 gerekir.
 * Bayrak varken: yönetim kullanıcısı veya development ortamı.
 *
 * Böylece admin/partner de bayrak açmadan one-click ürün akışını görür;
 * “Gelişmiş / Manuel Kontrol” DOM’a eklenmez.
 */
export function isBankParserServiceModeVisible({
  isManagementUser = false,
  nodeEnv = typeof process !== "undefined" ? process.env.NODE_ENV : "production",
  debugFlag = false,
} = {}) {
  if (!Boolean(debugFlag)) return false;
  if (isManagementUser) return true;
  if (nodeEnv === "development") return true;
  return false;
}
