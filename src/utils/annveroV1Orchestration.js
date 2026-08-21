/**
 * ANNVERO V1 — ince orkestrasyon katmanı.
 * Mevcut Banka Parser / CORE / hafıza / Fiş Kontrol / Drive / E-Defter motorlarını
 * tek durum makinesi altında bağlar. Yeni bağımsız ürün modülü değildir.
 */

import {
  analyzeStandardLucaRows,
  buildPassedExportPayload,
  filterPassedRowsForExport,
  groupLucaFisBatches,
  KONTROL_DURUM,
  LUCA_FIS_GROUP_SIZE,
} from "@/src/utils/fisKontrolMerkezi";
import { applySessionMovementDedup } from "@/src/utils/bankStatementDedup";
import { mergeExcelAndPdfTransactions } from "@/src/utils/bankStatementPdf";
import { DRIVE_UPLOAD_DEFAULT_FOLDER } from "@/src/utils/cloudStorage/uploadPolicy";

export const ANNVERO_V1_ENGINE_VERSION = "annvero-v1-orchestration/1.0.0";

/** Kanonik durum makinesi (test edilebilir) */
export const V1_JOB_STATE = Object.freeze({
  IDLE: "idle",
  VALIDATING: "validating",
  ARCHIVING: "archiving",
  PARSING: "parsing",
  DEDUPLICATING: "deduplicating",
  APPLYING_CORE: "applying_core",
  APPLYING_MEMORY: "applying_memory",
  CREATING_VOUCHERS: "creating_vouchers",
  CONTROLLING_VOUCHERS: "controlling_vouchers",
  RECONCILING_EDEFTER: "reconciling_edefter",
  GENERATING_EXPORTS: "generating_exports",
  PERSISTING: "persisting",
  COMPLETED: "completed",
  REVIEW_REQUIRED: "review_required",
  DUPLICATE: "duplicate",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const V1_STAGE_ORDER = Object.freeze([
  V1_JOB_STATE.VALIDATING,
  V1_JOB_STATE.ARCHIVING,
  V1_JOB_STATE.PARSING,
  V1_JOB_STATE.DEDUPLICATING,
  V1_JOB_STATE.APPLYING_CORE,
  V1_JOB_STATE.APPLYING_MEMORY,
  V1_JOB_STATE.CREATING_VOUCHERS,
  V1_JOB_STATE.CONTROLLING_VOUCHERS,
  V1_JOB_STATE.RECONCILING_EDEFTER,
  V1_JOB_STATE.GENERATING_EXPORTS,
  V1_JOB_STATE.PERSISTING,
]);

export const V1_TERMINAL_STATES = Object.freeze([
  V1_JOB_STATE.COMPLETED,
  V1_JOB_STATE.REVIEW_REQUIRED,
  V1_JOB_STATE.DUPLICATE,
  V1_JOB_STATE.FAILED,
  V1_JOB_STATE.CANCELLED,
]);

export const V1_ACTIVE_STATES = Object.freeze(
  V1_STAGE_ORDER.filter(Boolean)
);

const TRANSITIONS = Object.freeze({
  [V1_JOB_STATE.IDLE]: [
    V1_JOB_STATE.VALIDATING,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
  ],
  [V1_JOB_STATE.VALIDATING]: [
    V1_JOB_STATE.ARCHIVING,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
  ],
  [V1_JOB_STATE.ARCHIVING]: [
    V1_JOB_STATE.PARSING,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
  ],
  [V1_JOB_STATE.PARSING]: [
    V1_JOB_STATE.DEDUPLICATING,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
    V1_JOB_STATE.DUPLICATE,
  ],
  [V1_JOB_STATE.DEDUPLICATING]: [
    V1_JOB_STATE.APPLYING_CORE,
    V1_JOB_STATE.DUPLICATE,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
  ],
  [V1_JOB_STATE.APPLYING_CORE]: [
    V1_JOB_STATE.APPLYING_MEMORY,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
  ],
  [V1_JOB_STATE.APPLYING_MEMORY]: [
    V1_JOB_STATE.CREATING_VOUCHERS,
    V1_JOB_STATE.REVIEW_REQUIRED,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
  ],
  [V1_JOB_STATE.CREATING_VOUCHERS]: [
    V1_JOB_STATE.CONTROLLING_VOUCHERS,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
  ],
  [V1_JOB_STATE.CONTROLLING_VOUCHERS]: [
    V1_JOB_STATE.RECONCILING_EDEFTER,
    V1_JOB_STATE.REVIEW_REQUIRED,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
  ],
  [V1_JOB_STATE.RECONCILING_EDEFTER]: [
    V1_JOB_STATE.GENERATING_EXPORTS,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
  ],
  [V1_JOB_STATE.GENERATING_EXPORTS]: [
    V1_JOB_STATE.PERSISTING,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
  ],
  [V1_JOB_STATE.PERSISTING]: [
    V1_JOB_STATE.COMPLETED,
    V1_JOB_STATE.REVIEW_REQUIRED,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
  ],
  [V1_JOB_STATE.COMPLETED]: [V1_JOB_STATE.IDLE, V1_JOB_STATE.VALIDATING],
  [V1_JOB_STATE.REVIEW_REQUIRED]: [
    V1_JOB_STATE.IDLE,
    V1_JOB_STATE.VALIDATING,
    V1_JOB_STATE.APPLYING_MEMORY,
    V1_JOB_STATE.CONTROLLING_VOUCHERS,
  ],
  [V1_JOB_STATE.DUPLICATE]: [V1_JOB_STATE.IDLE, V1_JOB_STATE.VALIDATING],
  [V1_JOB_STATE.FAILED]: [
    V1_JOB_STATE.IDLE,
    V1_JOB_STATE.VALIDATING,
    ...V1_STAGE_ORDER,
  ],
  [V1_JOB_STATE.CANCELLED]: [V1_JOB_STATE.IDLE, V1_JOB_STATE.VALIDATING],
});

/** Progress bantları (global %) */
export const V1_PROGRESS_BANDS = Object.freeze({
  [V1_JOB_STATE.VALIDATING]: {
    from: 0,
    to: 4,
    label: "Dosya ve firma doğrulanıyor…",
  },
  [V1_JOB_STATE.ARCHIVING]: {
    from: 4,
    to: 10,
    label: "Drive arşivleniyor…",
  },
  [V1_JOB_STATE.PARSING]: {
    from: 10,
    to: 28,
    label: "Hareketler ayrıştırılıyor…",
  },
  [V1_JOB_STATE.DEDUPLICATING]: {
    from: 28,
    to: 34,
    label: "Mükerrerlik kontrol ediliyor…",
  },
  [V1_JOB_STATE.APPLYING_CORE]: {
    from: 34,
    to: 48,
    label: "ANNVERO CORE uygulanıyor…",
  },
  [V1_JOB_STATE.APPLYING_MEMORY]: {
    from: 48,
    to: 62,
    label: "Firma muhasebe hafızası uygulanıyor…",
  },
  [V1_JOB_STATE.CREATING_VOUCHERS]: {
    from: 62,
    to: 74,
    label: "Fiş taslakları oluşturuluyor…",
  },
  [V1_JOB_STATE.CONTROLLING_VOUCHERS]: {
    from: 74,
    to: 84,
    label: "Fiş Kontrol çalışıyor…",
  },
  [V1_JOB_STATE.RECONCILING_EDEFTER]: {
    from: 84,
    to: 90,
    label: "E-Defter çapraz kontrol…",
  },
  [V1_JOB_STATE.GENERATING_EXPORTS]: {
    from: 90,
    to: 96,
    label: "Luca / ElektraWeb çıktıları hazırlanıyor…",
  },
  [V1_JOB_STATE.PERSISTING]: {
    from: 96,
    to: 99,
    label: "Güvenli özet kaydediliyor…",
  },
  [V1_JOB_STATE.COMPLETED]: { from: 100, to: 100, label: "Tamamlandı" },
  [V1_JOB_STATE.REVIEW_REQUIRED]: {
    from: 100,
    to: 100,
    label: "İnceleme gerekli",
  },
  [V1_JOB_STATE.DUPLICATE]: {
    from: 100,
    to: 100,
    label: "Mükerrer ekstre",
  },
});

export const V1_UI_STEPS = Object.freeze([
  { id: "validate", label: "Doğrulama", phase: V1_JOB_STATE.VALIDATING },
  { id: "archive", label: "Drive arşiv", phase: V1_JOB_STATE.ARCHIVING },
  { id: "parse", label: "Ayrıştırma", phase: V1_JOB_STATE.PARSING },
  { id: "dedupe", label: "Mükerrerlik", phase: V1_JOB_STATE.DEDUPLICATING },
  { id: "core", label: "CORE + hafıza", phase: V1_JOB_STATE.APPLYING_CORE },
  { id: "vouchers", label: "Fiş + kontrol", phase: V1_JOB_STATE.CREATING_VOUCHERS },
  { id: "edefter", label: "E-Defter / çıktı", phase: V1_JOB_STATE.RECONCILING_EDEFTER },
  { id: "persist", label: "Kayıt", phase: V1_JOB_STATE.PERSISTING },
]);

export const V1_EDEFTER_STATUS = Object.freeze({
  EDEFTER_NOT_AVAILABLE: "EDEFTER_NOT_AVAILABLE",
  NOT_APPLICABLE: "NOT_APPLICABLE",
  RECONCILED: "RECONCILED",
  MISMATCHED: "MISMATCHED",
  PARTIAL: "PARTIAL",
});

export const V1_CTA_LABEL = "İşle ve Kontrol Et";
export const V1_CTA_RETRY_LABEL = "Güvenli Yeniden Dene";
export const V1_CTA_RERUN_LABEL = "Yeniden İşle";

export function createInitialV1JobState(overrides = {}) {
  return {
    phase: V1_JOB_STATE.IDLE,
    loading: false,
    error: null,
    jobId: null,
    leaseId: null,
    companyId: "",
    fileName: "",
    contentHash: "",
    checkpointPhase: null,
    completedStages: [],
    stageOutputs: {},
    ...overrides,
  };
}

export function canTransitionV1Job(from, to) {
  const allowed = TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export function transitionV1Job(state, to, meta = {}) {
  const from = state?.phase || V1_JOB_STATE.IDLE;
  if (!canTransitionV1Job(from, to)) {
    return {
      ...state,
      phase: V1_JOB_STATE.FAILED,
      loading: false,
      error: `Geçersiz durum geçişi: ${from} → ${to}`,
    };
  }
  const loading = V1_ACTIVE_STATES.includes(to);
  const completedStages = Array.isArray(state?.completedStages)
    ? [...state.completedStages]
    : [];
  if (
    V1_ACTIVE_STATES.includes(from) &&
    from !== to &&
    !completedStages.includes(from)
  ) {
    completedStages.push(from);
  }
  return {
    ...state,
    ...meta,
    phase: to,
    loading,
    checkpointPhase: loading ? to : state?.checkpointPhase || from,
    completedStages,
    error:
      to === V1_JOB_STATE.FAILED
        ? meta.error || state?.error || "İşlem başarısız."
        : null,
  };
}

export function shouldBlockNewV1Job(state) {
  return Boolean(state?.loading) || V1_ACTIVE_STATES.includes(state?.phase);
}

export function shouldRunV1Stage(resumeFrom, stage) {
  if (!resumeFrom) return true;
  const startIdx = V1_STAGE_ORDER.indexOf(resumeFrom);
  const stageIdx = V1_STAGE_ORDER.indexOf(stage);
  if (startIdx < 0 || stageIdx < 0) return true;
  return stageIdx >= startIdx;
}

/** Fail sonrası yalnız fail aşamadan; önceki başarılı çıktı yeniden üretilmez. */
export function resolveRetryFromPhase(failedPhase, stageOutputs = {}) {
  if (!failedPhase || !V1_STAGE_ORDER.includes(failedPhase)) {
    return V1_JOB_STATE.VALIDATING;
  }
  // Checkpoint: başarılı aşamalar stageOutputs'ta; fail aşamasından devam.
  for (const stage of V1_STAGE_ORDER) {
    if (stage === failedPhase) return failedPhase;
    if (!stageOutputs?.[stage]) {
      // Ara boşluk varsa en erken eksik aşamaya düş (güvenli)
      return stage;
    }
  }
  return failedPhase;
}

export function mapLocalProgressToV1(phase, localPercent = 0) {
  const band = V1_PROGRESS_BANDS[phase];
  if (!band) return 0;
  if (
    phase === V1_JOB_STATE.COMPLETED ||
    phase === V1_JOB_STATE.REVIEW_REQUIRED ||
    phase === V1_JOB_STATE.DUPLICATE
  ) {
    return 100;
  }
  const local = Math.max(0, Math.min(100, Number(localPercent) || 0));
  return Math.round(band.from + ((band.to - band.from) * local) / 100);
}

export function getV1PhaseLabel(phase, detail = "") {
  const band = V1_PROGRESS_BANDS[phase];
  if (!band) return detail || "";
  return detail || band.label;
}

export function getV1PhaseTitle(phase) {
  const titles = {
    [V1_JOB_STATE.VALIDATING]: "Doğrulama",
    [V1_JOB_STATE.ARCHIVING]: "Drive arşiv",
    [V1_JOB_STATE.PARSING]: "Ayrıştırma",
    [V1_JOB_STATE.DEDUPLICATING]: "Mükerrerlik",
    [V1_JOB_STATE.APPLYING_CORE]: "CORE",
    [V1_JOB_STATE.APPLYING_MEMORY]: "Muhasebe hafızası",
    [V1_JOB_STATE.CREATING_VOUCHERS]: "Fiş oluşturma",
    [V1_JOB_STATE.CONTROLLING_VOUCHERS]: "Fiş Kontrol",
    [V1_JOB_STATE.RECONCILING_EDEFTER]: "E-Defter",
    [V1_JOB_STATE.GENERATING_EXPORTS]: "Çıktılar",
    [V1_JOB_STATE.PERSISTING]: "Kayıt",
    [V1_JOB_STATE.COMPLETED]: "Tamamlandı",
    [V1_JOB_STATE.REVIEW_REQUIRED]: "İnceleme",
    [V1_JOB_STATE.DUPLICATE]: "Mükerrer",
    [V1_JOB_STATE.FAILED]: "Hata",
    [V1_JOB_STATE.CANCELLED]: "İptal",
  };
  return titles[phase] || "İşleniyor";
}

const PHASE_TO_UI_INDEX = Object.freeze({
  [V1_JOB_STATE.IDLE]: -1,
  [V1_JOB_STATE.VALIDATING]: 0,
  [V1_JOB_STATE.ARCHIVING]: 1,
  [V1_JOB_STATE.PARSING]: 2,
  [V1_JOB_STATE.DEDUPLICATING]: 3,
  [V1_JOB_STATE.APPLYING_CORE]: 4,
  [V1_JOB_STATE.APPLYING_MEMORY]: 4,
  [V1_JOB_STATE.CREATING_VOUCHERS]: 5,
  [V1_JOB_STATE.CONTROLLING_VOUCHERS]: 5,
  [V1_JOB_STATE.RECONCILING_EDEFTER]: 6,
  [V1_JOB_STATE.GENERATING_EXPORTS]: 6,
  [V1_JOB_STATE.PERSISTING]: 7,
  [V1_JOB_STATE.COMPLETED]: 8,
  [V1_JOB_STATE.REVIEW_REQUIRED]: 8,
  [V1_JOB_STATE.DUPLICATE]: 8,
});

export function getV1UiStepStatuses(phase, { errorPhase } = {}) {
  if (
    phase === V1_JOB_STATE.COMPLETED ||
    phase === V1_JOB_STATE.REVIEW_REQUIRED ||
    phase === V1_JOB_STATE.DUPLICATE
  ) {
    return V1_UI_STEPS.map((step) => ({ ...step, status: "done" }));
  }
  if (phase === V1_JOB_STATE.CANCELLED) {
    return V1_UI_STEPS.map((step) => ({ ...step, status: "cancelled" }));
  }
  if (phase === V1_JOB_STATE.FAILED) {
    const errIdx = PHASE_TO_UI_INDEX[errorPhase] ?? 0;
    return V1_UI_STEPS.map((step, i) => ({
      ...step,
      status: i < errIdx ? "done" : i === errIdx ? "error" : "pending",
    }));
  }
  const idx = PHASE_TO_UI_INDEX[phase];
  if (idx == null || idx < 0) {
    return V1_UI_STEPS.map((step) => ({ ...step, status: "pending" }));
  }
  return V1_UI_STEPS.map((step, i) => ({
    ...step,
    status: i < idx ? "done" : i === idx ? "active" : "pending",
  }));
}

export function canStartV1Pipeline({
  selectedCompanyId,
  selectedFile,
  isJobBusy,
  pipelinePhase,
  selectedBank = null,
} = {}) {
  if (!selectedCompanyId || !selectedFile) return false;
  if (selectedBank === "") return false;
  if (isJobBusy) return false;
  const idle = new Set([
    V1_JOB_STATE.IDLE,
    V1_JOB_STATE.COMPLETED,
    V1_JOB_STATE.REVIEW_REQUIRED,
    V1_JOB_STATE.DUPLICATE,
    V1_JOB_STATE.FAILED,
    V1_JOB_STATE.CANCELLED,
    "",
    null,
    undefined,
  ]);
  if (pipelinePhase && !idle.has(pipelinePhase)) return false;
  return true;
}

export function createAbortError(message = "İşlem iptal edildi.") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

export function assertV1Signal(signal, isRunActive, runId) {
  if (
    signal?.aborted ||
    (typeof isRunActive === "function" && !isRunActive(runId))
  ) {
    throw createAbortError();
  }
}

export function userFacingV1Error(phase) {
  const map = {
    [V1_JOB_STATE.VALIDATING]:
      "Dosya veya firma doğrulanamadı. Lütfen tekrar deneyin.",
    [V1_JOB_STATE.ARCHIVING]:
      "Drive arşivi tamamlanamadı. Lütfen tekrar deneyin.",
    [V1_JOB_STATE.PARSING]:
      "Dosya okunamadı. Lütfen dosyayı kontrol edip tekrar deneyin.",
    [V1_JOB_STATE.DEDUPLICATING]:
      "Mükerrerlik kontrolü tamamlanamadı. Lütfen tekrar deneyin.",
    [V1_JOB_STATE.APPLYING_CORE]:
      "CORE kararları uygulanamadı. Lütfen tekrar deneyin.",
    [V1_JOB_STATE.APPLYING_MEMORY]:
      "Muhasebe hafızası uygulanamadı. Lütfen tekrar deneyin.",
    [V1_JOB_STATE.CREATING_VOUCHERS]:
      "Fiş satırları hazırlanamadı. Lütfen tekrar deneyin.",
    [V1_JOB_STATE.CONTROLLING_VOUCHERS]:
      "Fiş Kontrol tamamlanamadı. Lütfen tekrar deneyin.",
    [V1_JOB_STATE.RECONCILING_EDEFTER]:
      "E-Defter çapraz kontrolü tamamlanamadı.",
    [V1_JOB_STATE.GENERATING_EXPORTS]:
      "Çıktılar hazırlanamadı. Lütfen tekrar deneyin.",
    [V1_JOB_STATE.PERSISTING]:
      "Güvenli özet kaydedilemedi. Lütfen tekrar deneyin.",
  };
  return map[phase] || "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
}

/** Muhasebe önceliği — değiştirilemez sıra */
export const ACCOUNTING_PRIORITY = Object.freeze([
  "core_mevzuat",
  "company_user_rules",
  "account_memory",
  "system_defaults",
  "review_queue",
]);

export function buildIdempotencyKey({
  companyId = "",
  contentHash = "",
  engineVersion = ANNVERO_V1_ENGINE_VERSION,
} = {}) {
  return [
    "annvero-v1",
    String(companyId || "").trim(),
    String(contentHash || "").trim() || "nohash",
    String(engineVersion || "").trim(),
  ].join(":");
}

export function buildLeaseKey(companyId = "") {
  return `annvero-v1-lease:${String(companyId || "").trim()}`;
}

/**
 * Aynı firmada eşzamanlı iki aktif iş engeli (istemci lease).
 * TTL ms; süresi dolmuş lease serbest bırakılır.
 */
export function tryAcquireCompanyLease(
  store,
  { companyId, leaseId, ttlMs = 15 * 60 * 1000, now = Date.now() } = {}
) {
  const key = buildLeaseKey(companyId);
  if (!companyId || !leaseId) {
    return { ok: false, code: "INVALID_LEASE", store };
  }
  const next = store instanceof Map ? new Map(store) : new Map(store || []);
  const existing = next.get(key);
  if (
    existing &&
    existing.leaseId !== leaseId &&
    Number(existing.expiresAt || 0) > now
  ) {
    return {
      ok: false,
      code: "COMPANY_JOB_ACTIVE",
      message: "Bu firma için zaten aktif bir işlem var.",
      store: next,
    };
  }
  next.set(key, { leaseId, companyId, expiresAt: now + ttlMs, acquiredAt: now });
  return { ok: true, store: next, lease: next.get(key) };
}

export function releaseCompanyLease(store, { companyId, leaseId } = {}) {
  const key = buildLeaseKey(companyId);
  const next = store instanceof Map ? new Map(store) : new Map(store || []);
  const existing = next.get(key);
  if (!existing) return next;
  if (leaseId && existing.leaseId !== leaseId) return next;
  next.delete(key);
  return next;
}

/** Firma değişince job/sonuç/cache temizlenir. */
export function clearV1CompanyScopedState(state = {}) {
  return createInitialV1JobState({
    companyId: "",
    fileName: state.fileName || "",
  });
}

export function validateV1Inputs({
  companyId,
  file,
  bankId = null,
  maxBytes = 25 * 1024 * 1024,
  fromCanonicalSnapshot = false,
} = {}) {
  if (!companyId) {
    return { ok: false, code: "MISSING_COMPANY", message: "Önce firma seçmelisin." };
  }
  if (!file && fromCanonicalSnapshot) {
    if (bankId === "") {
      return {
        ok: false,
        code: "MISSING_BANK",
        message: "Banka otomatik belirlenemedi. Lütfen bankayı seçin.",
      };
    }
    return { ok: true, code: "CANONICAL_SNAPSHOT", message: "" };
  }
  if (!file) {
    return { ok: false, code: "MISSING_FILE", message: "Önce dosya seçmelisin." };
  }
  const size = Number(file.size || 0);
  if (size <= 0) {
    return { ok: false, code: "EMPTY_FILE", message: "Boş dosya işlenemez." };
  }
  if (size > maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `Dosya çok büyük. En fazla ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    };
  }
  const name = String(file.name || "").toLowerCase();
  const encrypted =
    /\.encrypted\./i.test(name) ||
    Boolean(file.encrypted) ||
    Boolean(file.isEncrypted);
  if (encrypted) {
    return {
      ok: false,
      code: "ENCRYPTED_FILE",
      message: "Şifreli dosya açılamadı. Lütfen şifresiz bir kopya yükleyin.",
    };
  }
  if (bankId === "") {
    return {
      ok: false,
      code: "MISSING_BANK",
      message: "Banka otomatik belirlenemedi. Lütfen bankayı seçin.",
    };
  }
  return { ok: true };
}

/**
 * Drive arşiv — mevcut upload API’ye ince sarmalayıcı.
 * Bağlantı yoksa banka akışını engellemez; skipped kodu döner.
 */
export async function archiveStatementToDrive({
  companyId,
  file,
  fetchImpl = typeof fetch !== "undefined" ? fetch : null,
  targetFolderPath = DRIVE_UPLOAD_DEFAULT_FOLDER,
  signal,
} = {}) {
  if (!companyId || !file) {
    return {
      ok: false,
      skipped: true,
      code: "MISSING_INPUT",
      message: "Arşiv için firma veya dosya eksik.",
    };
  }
  if (!fetchImpl) {
    return {
      ok: false,
      skipped: true,
      code: "NO_FETCH",
      message: "Arşiv ortamı hazır değil.",
    };
  }
  try {
    const form = new FormData();
    form.set("companyId", companyId);
    form.set("file", file, file.name || "ekstre");
    if (targetFolderPath) form.set("targetFolderPath", targetFolderPath);
    const response = await fetchImpl("/api/google-drive/files/upload", {
      method: "POST",
      credentials: "include",
      body: form,
      signal,
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409 && body?.code === "DUPLICATE_CONTENT") {
      return {
        ok: true,
        duplicate: true,
        code: "DUPLICATE_CONTENT",
        message: body.message || "Dosya daha önce arşivlendi.",
        safeSummary: {
          archived: true,
          duplicate: true,
          folder: targetFolderPath,
        },
      };
    }
    if (!response.ok) {
      const code = body?.code || "DRIVE_UPLOAD_FAILED";
      const softSkip = [
        "DRIVE_CONNECTION_MISSING",
        "FOLDER_BINDING_MISSING",
        "OFFICE_CONNECTION_PENDING",
        "COMPANY_INACTIVE",
      ].includes(code);
      return {
        ok: softSkip,
        skipped: softSkip,
        code,
        message: body?.message || "Drive arşivi tamamlanamadı.",
        safeSummary: { archived: false, skipped: softSkip, code },
      };
    }
    return {
      ok: true,
      code: "ARCHIVED",
      safeSummary: {
        archived: true,
        duplicate: false,
        folder: targetFolderPath,
        // fileId / token asla istemci özetine alınmaz
        hasDriveRef: Boolean(body?.ok),
      },
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {
      ok: false,
      skipped: true,
      code: "DRIVE_ARCHIVE_ERROR",
      message: "Drive arşivi atlandı; banka işlemi sürdürülüyor.",
      safeSummary: { archived: false, skipped: true },
    };
  }
}

export function runDedupStage({
  rows = [],
  existingKeys = new Set(),
  context = {},
  pdfResult = null,
} = {}) {
  if (pdfResult && (pdfResult.transactions || pdfResult.status)) {
    if (pdfResult.code === "OCR_REQUIRED" || pdfResult.status === "OCR_REQUIRED") {
      return {
        ok: false,
        code: "OCR_REQUIRED",
        message: pdfResult.message || "Taranmış PDF için OCR gerekli.",
        unique: [],
        duplicates: [],
        allDuplicate: false,
      };
    }
    const merged = mergeExcelAndPdfTransactions(rows, pdfResult, context);
    const prior =
      existingKeys instanceof Set ? existingKeys : new Set(existingKeys || []);
    const fresh = [];
    const dups = [];
    for (const tx of merged.unique || []) {
      if (tx?.transactionId && prior.has(tx.transactionId)) dups.push(tx);
      else fresh.push(tx);
    }
    const allDuplicate =
      (merged.unique?.length || 0) + (merged.duplicates?.length || 0) > 0 &&
      fresh.length === 0;
    return {
      ok: true,
      unique: fresh,
      duplicates: [...(merged.duplicates || []), ...dups],
      allDuplicate,
      crossSource: true,
      excelCount: merged.excelCount,
      pdfCount: merged.pdfCount,
      suppressedMovements: (merged.duplicates?.length || 0) + dups.length,
    };
  }
  return applySessionMovementDedup(rows, existingKeys, context);
}

/**
 * Fiş Kontrol — kritik / düşük güven → otomatik onay yok.
 */
export function runVoucherControlStage(lucaRows = [], options = {}) {
  const analysis = analyzeStandardLucaRows(lucaRows, {
    firmaId: options.companyId || options.firmaId || "",
    ...options,
  });
  const rows = analysis?.rows || [];
  const summary = analysis?.summary || {};
  let passed = Number(summary.gectiRowCount) || 0;
  let warnings = Number(summary.uyariRowCount) || 0;
  let errors = Number(summary.hataRowCount) || 0;
  let lowConfidence = 0;
  let critical = errors;
  if (!summary.gectiRowCount && !summary.hataRowCount) {
    passed = 0;
    warnings = 0;
    errors = 0;
    for (const row of rows) {
      const durum = row._kontrol?.kontrolDurumu || row.kontrolDurumu;
      if (durum === KONTROL_DURUM.GECTI) passed += 1;
      else if (durum === KONTROL_DURUM.UYARI) warnings += 1;
      else if (durum === KONTROL_DURUM.HATA) errors += 1;
      const issues = row._kontrol?.issueTypes || [];
      if (issues.includes("Düşük güven skoru") || Number(row.guvenSkoru) < 70) {
        lowConfidence += 1;
      }
      if (durum === KONTROL_DURUM.HATA) critical += 1;
    }
  } else {
    for (const row of rows) {
      const issues = row._kontrol?.issueTypes || [];
      if (issues.includes("Düşük güven skoru") || Number(row.guvenSkoru) < 70) {
        lowConfidence += 1;
      }
    }
  }
  const canAutoApprove = errors === 0 && critical === 0 && lowConfidence === 0;
  const reviewRequired = errors > 0 || lowConfidence > 0;
  const passedRows = filterPassedRowsForExport(analysis);
  const batches = groupLucaFisBatches(passedRows, LUCA_FIS_GROUP_SIZE);
  const exportPayload = buildPassedExportPayload(analysis, {
    canAutoApprove,
    reviewRequired,
  });
  return {
    analysis,
    passed,
    warnings,
    errors,
    lowConfidence,
    critical,
    canAutoApprove,
    reviewRequired,
    passedRowCount: passedRows.length,
    lucaBatchCount: batches.length,
    lucaGroupSize: LUCA_FIS_GROUP_SIZE,
    exportPayload,
    fisKontrolHref: `/muhasebe/fis-kontrol?source=bank&companyId=${encodeURIComponent(
      String(options.companyId || options.firmaId || "")
    )}`,
  };
}

/**
 * E-Defter yoksa sahte sonuç yok — banka akışını engellemez.
 */
export function reconcileEdefterStage({
  edefterPackage = null,
  edefterResult = null,
  forceNotApplicable = false,
} = {}) {
  if (forceNotApplicable) {
    return {
      status: V1_EDEFTER_STATUS.NOT_APPLICABLE,
      code: V1_EDEFTER_STATUS.NOT_APPLICABLE,
      message: "Bu işlem için E-Defter çapraz kontrolü uygulanmaz.",
      blocksBankFlow: false,
    };
  }
  if (!edefterPackage && !edefterResult) {
    return {
      status: V1_EDEFTER_STATUS.EDEFTER_NOT_AVAILABLE,
      code: V1_EDEFTER_STATUS.EDEFTER_NOT_AVAILABLE,
      message: "E-Defter paketi yok — çapraz kontrol atlandı.",
      blocksBankFlow: false,
    };
  }
  if (edefterResult?.status) {
    return {
      status: edefterResult.status,
      code: edefterResult.code || edefterResult.status,
      message: edefterResult.message || "",
      summary: edefterResult.summary || null,
      blocksBankFlow: false,
    };
  }
  return {
    status: V1_EDEFTER_STATUS.PARTIAL,
    code: V1_EDEFTER_STATUS.PARTIAL,
    message: "E-Defter paketi alındı; özet mutabakat hazır.",
    blocksBankFlow: false,
  };
}

/**
 * Deterministik Luca satır sayısı kontrolü (hareket × 2 varsayılan).
 */
export function assertLucaRowExpectation(movementCount, lucaRowCount, {
  rowsPerMovement = 2,
} = {}) {
  const expected = Math.max(0, Number(movementCount) || 0) * rowsPerMovement;
  const actual = Math.max(0, Number(lucaRowCount) || 0);
  return {
    ok: actual === expected || actual === 0,
    expected,
    actual,
    deterministic: true,
  };
}

export function decideTerminalStatus({
  duplicate = false,
  reviewRequired = false,
  failed = false,
  cancelled = false,
} = {}) {
  if (cancelled) return V1_JOB_STATE.CANCELLED;
  if (failed) return V1_JOB_STATE.FAILED;
  if (duplicate) return V1_JOB_STATE.DUPLICATE;
  if (reviewRequired) return V1_JOB_STATE.REVIEW_REQUIRED;
  return V1_JOB_STATE.COMPLETED;
}

/**
 * Tek sonuç ekranı için güvenli özet — IBAN/VKN/token/fileId/ham içerik yok.
 */
export function buildV1ResultSummary({
  movementCount = 0,
  lucaRowCount = 0,
  autoMatchedCount = 0,
  reviewCount = 0,
  fisKontrol = null,
  edefter = null,
  archive = null,
  duplicate = false,
  totalDurationMs = 0,
  stageDurations = {},
  terminalStatus = V1_JOB_STATE.COMPLETED,
  contentHash = "",
  parseMs = null,
  chainMs = null,
  reviewRequired = null,
  canAutoApprove = null,
  balanceMismatch = false,
  balanceCode = "",
  openingBalance = null,
  closingBalance = null,
  balanceDelta = null,
  expectedClosing = null,
  balanceEvidenceSource = "",
  outputGateCode = "",
  pipelineVersion = "",
  sourceId = "",
  sourceRevision = "",
  planFingerprint = "",
  snapshotFingerprint = "",
} = {}) {
  const resolvedReviewRequired =
    reviewRequired != null
      ? Boolean(reviewRequired)
      : Boolean(fisKontrol?.reviewRequired) || Boolean(balanceMismatch);
  const resolvedCanAutoApprove =
    canAutoApprove != null
      ? Boolean(canAutoApprove)
      : balanceMismatch
        ? false
        : Boolean(fisKontrol?.canAutoApprove);
  const finiteOrNull = (value) => {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    engineVersion: ANNVERO_V1_ENGINE_VERSION,
    terminalStatus,
    movementCount,
    lucaRowCount,
    autoMatchedCount,
    reviewCount,
    passed: fisKontrol?.passed ?? 0,
    warnings: fisKontrol?.warnings ?? 0,
    errors: fisKontrol?.errors ?? 0,
    duplicate,
    suppressedMovements: archive?.suppressedMovements ?? 0,
    edefterStatus: edefter?.status || V1_EDEFTER_STATUS.EDEFTER_NOT_AVAILABLE,
    edefterCode: edefter?.code || V1_EDEFTER_STATUS.EDEFTER_NOT_AVAILABLE,
    driveArchived: Boolean(archive?.safeSummary?.archived),
    driveSkipped: Boolean(archive?.skipped || archive?.safeSummary?.skipped),
    canAutoApprove: resolvedCanAutoApprove,
    reviewRequired: resolvedReviewRequired,
    lucaBatchCount: fisKontrol?.lucaBatchCount ?? 0,
    fisKontrolHref: fisKontrol?.fisKontrolHref || "/muhasebe/fis-kontrol",
    totalDurationMs,
    stageDurations,
    parseMs,
    chainMs,
    contentHashPresent: Boolean(contentHash),
    balanceMismatch: Boolean(balanceMismatch),
    balanceCode: String(
      balanceCode || (balanceMismatch ? "BALANCE_MISMATCH" : "")
    ).slice(0, 40),
    openingBalance: finiteOrNull(openingBalance),
    closingBalance: finiteOrNull(closingBalance),
    balanceDelta: finiteOrNull(balanceDelta),
    expectedClosing: finiteOrNull(expectedClosing),
    balanceEvidenceSource: String(balanceEvidenceSource || "").slice(0, 64),
    outputGateCode: String(outputGateCode || "").slice(0, 40),
    pipelineVersion: String(pipelineVersion || "").slice(0, 96),
    sourceId: String(sourceId || "").slice(0, 36),
    sourceRevision: String(sourceRevision ?? "").slice(0, 16),
    planFingerprint: String(planFingerprint || "").slice(0, 64),
    snapshotFingerprint: String(snapshotFingerprint || "").slice(0, 64),
    // hassas alanlar bilinçli olarak yok
  };
}

/** Eski banka pipeline fazlarını V1’e map (geriye uyum) */
export function mapLegacyPhaseToV1(legacyPhase) {
  const map = {
    IDLE: V1_JOB_STATE.IDLE,
    PARSING: V1_JOB_STATE.PARSING,
    PREVIEW: V1_JOB_STATE.DEDUPLICATING,
    ACCOUNTING_ANALYSIS: V1_JOB_STATE.APPLYING_CORE,
    LUCA_BUILD: V1_JOB_STATE.CREATING_VOUCHERS,
    VALIDATION: V1_JOB_STATE.CONTROLLING_VOUCHERS,
    READY_FOR_EXPORT: V1_JOB_STATE.COMPLETED,
    ERROR: V1_JOB_STATE.FAILED,
    CANCELLED: V1_JOB_STATE.CANCELLED,
  };
  return map[legacyPhase] || legacyPhase;
}

export function mapV1PhaseToLegacy(v1Phase) {
  const map = {
    [V1_JOB_STATE.IDLE]: "IDLE",
    [V1_JOB_STATE.VALIDATING]: "PARSING",
    [V1_JOB_STATE.ARCHIVING]: "PARSING",
    [V1_JOB_STATE.PARSING]: "PARSING",
    [V1_JOB_STATE.DEDUPLICATING]: "PREVIEW",
    [V1_JOB_STATE.APPLYING_CORE]: "ACCOUNTING_ANALYSIS",
    [V1_JOB_STATE.APPLYING_MEMORY]: "ACCOUNTING_ANALYSIS",
    [V1_JOB_STATE.CREATING_VOUCHERS]: "LUCA_BUILD",
    [V1_JOB_STATE.CONTROLLING_VOUCHERS]: "VALIDATION",
    [V1_JOB_STATE.RECONCILING_EDEFTER]: "VALIDATION",
    [V1_JOB_STATE.GENERATING_EXPORTS]: "VALIDATION",
    [V1_JOB_STATE.PERSISTING]: "VALIDATION",
    [V1_JOB_STATE.COMPLETED]: "READY_FOR_EXPORT",
    [V1_JOB_STATE.REVIEW_REQUIRED]: "READY_FOR_EXPORT",
    [V1_JOB_STATE.DUPLICATE]: "ERROR",
    [V1_JOB_STATE.FAILED]: "ERROR",
    [V1_JOB_STATE.CANCELLED]: "CANCELLED",
  };
  return map[v1Phase] || "IDLE";
}
