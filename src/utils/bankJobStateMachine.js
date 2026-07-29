/**
 * Banka parser işlem durum makinesi (saf).
 */

export const BANK_JOB_STATE = Object.freeze({
  IDLE: "idle",
  READING: "reading",
  PARSING: "parsing",
  PREVIEW_READY: "preview_ready",
  ANALYZING: "analyzing",
  REVIEW_REQUIRED: "review_required",
  READY: "ready",
  GENERATING: "generating",
  COMPLETED: "completed",
  ERROR: "error",
  CANCELLED: "cancelled",
  OCR_REQUIRED: "OCR_REQUIRED",
});

const TRANSITIONS = Object.freeze({
  [BANK_JOB_STATE.IDLE]: [BANK_JOB_STATE.READING, BANK_JOB_STATE.ERROR],
  [BANK_JOB_STATE.READING]: [
    BANK_JOB_STATE.PARSING,
    BANK_JOB_STATE.ERROR,
    BANK_JOB_STATE.CANCELLED,
    BANK_JOB_STATE.OCR_REQUIRED,
  ],
  [BANK_JOB_STATE.PARSING]: [
    BANK_JOB_STATE.PREVIEW_READY,
    BANK_JOB_STATE.REVIEW_REQUIRED,
    BANK_JOB_STATE.OCR_REQUIRED,
    BANK_JOB_STATE.ERROR,
    BANK_JOB_STATE.CANCELLED,
  ],
  [BANK_JOB_STATE.PREVIEW_READY]: [
    BANK_JOB_STATE.ANALYZING,
    BANK_JOB_STATE.ERROR,
    BANK_JOB_STATE.CANCELLED,
    BANK_JOB_STATE.IDLE,
  ],
  [BANK_JOB_STATE.ANALYZING]: [
    BANK_JOB_STATE.REVIEW_REQUIRED,
    BANK_JOB_STATE.READY,
    BANK_JOB_STATE.ERROR,
    BANK_JOB_STATE.CANCELLED,
  ],
  [BANK_JOB_STATE.REVIEW_REQUIRED]: [
    BANK_JOB_STATE.READY,
    BANK_JOB_STATE.ANALYZING,
    BANK_JOB_STATE.ERROR,
    BANK_JOB_STATE.IDLE,
  ],
  [BANK_JOB_STATE.READY]: [
    BANK_JOB_STATE.GENERATING,
    BANK_JOB_STATE.ERROR,
    BANK_JOB_STATE.IDLE,
  ],
  [BANK_JOB_STATE.GENERATING]: [
    BANK_JOB_STATE.COMPLETED,
    BANK_JOB_STATE.ERROR,
    BANK_JOB_STATE.CANCELLED,
  ],
  [BANK_JOB_STATE.COMPLETED]: [BANK_JOB_STATE.IDLE, BANK_JOB_STATE.READING],
  [BANK_JOB_STATE.ERROR]: [BANK_JOB_STATE.IDLE, BANK_JOB_STATE.READING, BANK_JOB_STATE.PARSING],
  [BANK_JOB_STATE.CANCELLED]: [BANK_JOB_STATE.IDLE, BANK_JOB_STATE.READING],
  [BANK_JOB_STATE.OCR_REQUIRED]: [BANK_JOB_STATE.IDLE, BANK_JOB_STATE.READING],
});

export function canTransitionBankJob(from, to) {
  const allowed = TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export function transitionBankJob(state, to, meta = {}) {
  const from = state?.phase || BANK_JOB_STATE.IDLE;
  if (!canTransitionBankJob(from, to)) {
    return {
      ...state,
      phase: BANK_JOB_STATE.ERROR,
      error: `Geçersiz durum geçişi: ${from} → ${to}`,
      loading: false,
    };
  }
  const loading = ![
    BANK_JOB_STATE.IDLE,
    BANK_JOB_STATE.PREVIEW_READY,
    BANK_JOB_STATE.REVIEW_REQUIRED,
    BANK_JOB_STATE.READY,
    BANK_JOB_STATE.COMPLETED,
    BANK_JOB_STATE.ERROR,
    BANK_JOB_STATE.CANCELLED,
    BANK_JOB_STATE.OCR_REQUIRED,
  ].includes(to);

  return {
    ...state,
    ...meta,
    phase: to,
    loading,
    error: to === BANK_JOB_STATE.ERROR ? meta.error || state?.error || "İşlem başarısız." : null,
  };
}

export function createInitialBankJobState() {
  return {
    phase: BANK_JOB_STATE.IDLE,
    loading: false,
    error: null,
    jobId: null,
    fileName: "",
    companyId: "",
  };
}

/** Çift tıklama / çift job guard */
export function shouldBlockNewBankJob(state) {
  return Boolean(state?.loading) ||
    [
      BANK_JOB_STATE.READING,
      BANK_JOB_STATE.PARSING,
      BANK_JOB_STATE.ANALYZING,
      BANK_JOB_STATE.GENERATING,
    ].includes(state?.phase);
}
