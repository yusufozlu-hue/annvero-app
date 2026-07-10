/**
 * Movement / Luca satırı — yalnızca ekran dilimi için hafif kopya.
 * Full dataset üzerinde map etme; sadece verilen slice için çağır.
 */

export function sanitizeMovementForPreview(movement = {}) {
  if (!movement || typeof movement !== "object") return null;

  const suggestions = Array.isArray(movement.accountSuggestions)
    ? movement.accountSuggestions.slice(0, 5).map((item) => ({
        code: item?.code || item?.accountCode || "",
        label: item?.label || item?.accountName || "",
        accountCode: item?.accountCode || item?.code || "",
        accountName: item?.accountName || item?.label || "",
      }))
    : [];

  return {
    id: String(movement.id || ""),
    date: String(movement.date || ""),
    description: String(movement.description || "").slice(0, 500),
    amount: Number(movement.amount) || 0,
    direction: movement.direction === "CIKIS" ? "CIKIS" : "GIRIS",
    bankName: String(movement.bankName || ""),
    accountCode: String(movement.accountCode || ""),
    counterAccountCode: String(movement.counterAccountCode || ""),
    documentType: String(movement.documentType || "DK"),
    lucaDescription: String(movement.lucaDescription || "").slice(0, 500),
    warning: String(movement.warning || "").slice(0, 400),
    matchedMemoryId: movement.matchedMemoryId || null,
    accountSuggestions: suggestions,
    _coreMatched: Boolean(movement._coreMatched),
    _coreFallback: Boolean(movement._coreFallback),
    _coreSkipped: Boolean(movement._coreSkipped),
    _coreConfidence: Number(movement._coreConfidence) || 0,
    _coreRiskLevel: String(movement._coreRiskLevel || ""),
    _coreDecisionSource: String(movement._coreDecisionSource || ""),
    _coreStatus: String(movement._coreStatus || ""),
    _knowledgeTeachSaved: Boolean(movement._knowledgeTeachSaved),
    corePreview: movement.corePreview
      ? {
          core_status: String(movement.corePreview.core_status || ""),
          confidence_score:
            movement.corePreview.confidence_score == null
              ? null
              : Number(movement.corePreview.confidence_score),
          decision_source: String(movement.corePreview.decision_source || ""),
          suggested_account_code: String(
            movement.corePreview.suggested_account_code || ""
          ),
          risk_level: String(movement.corePreview.risk_level || ""),
          needs_manual_review: Boolean(movement.corePreview.needs_manual_review),
        }
      : undefined,
  };
}

export function sanitizeLucaRowForPreview(row = {}) {
  if (!row || typeof row !== "object") return null;
  return {
    id: String(row.id || ""),
    firmaId: String(row.firmaId || ""),
    kaynakTipi: String(row.kaynakTipi || ""),
    kaynakAdi: String(row.kaynakAdi || ""),
    fisNo: row.fisNo,
    fisTarihi: String(row.fisTarihi || ""),
    fisAciklama: String(row.fisAciklama || "").slice(0, 500),
    belgeTuru: String(row.belgeTuru || "DK"),
    belgeNo: String(row.belgeNo || ""),
    hesapKodu: String(row.hesapKodu || ""),
    hesapAdi: String(row.hesapAdi || "").slice(0, 200),
    evrakNo: String(row.evrakNo || ""),
    evrakTarihi: String(row.evrakTarihi || ""),
    detayAciklama: String(row.detayAciklama || "").slice(0, 500),
    borc: row.borc === "" || row.borc == null ? "" : Number(row.borc) || 0,
    alacak: row.alacak === "" || row.alacak == null ? "" : Number(row.alacak) || 0,
    kontrolNotu: String(row.kontrolNotu || "").slice(0, 400),
    hafizaEslesme: Boolean(row.hafizaEslesme),
    _movementId: row._movementId || null,
    riskDurumu: row.riskDurumu || null,
  };
}

/** Yalnızca verilen dilimi sanitize eder — full dizi map edilmez. */
export function sanitizeLucaSliceForPreview(rows = [], start = 0, end = rows.length) {
  const out = [];
  const from = Math.max(0, start);
  const to = Math.min(rows.length, end);
  for (let i = from; i < to; i += 1) {
    const safe = sanitizeLucaRowForPreview(rows[i]);
    if (safe) out.push(safe);
  }
  return out;
}

export function sanitizeMovementSliceForPreview(rows = [], start = 0, end = rows.length) {
  const out = [];
  const from = Math.max(0, start);
  const to = Math.min(rows.length, end);
  for (let i = from; i < to; i += 1) {
    const safe = sanitizeMovementForPreview(rows[i]);
    if (safe) out.push(safe);
  }
  return out;
}

export const EMPTY_CORE_SUMMARY = Object.freeze({
  enabled: false,
  core: 0,
  fallback: 0,
  total: 0,
  coreLimit: 0,
  skipped: 0,
  unknownFromCore: 0,
  partial: false,
  userWarning: "",
  timeoutBatches: 0,
  errorBatches: 0,
  skippedByBudget: 0,
  successBatches: 0,
  uniqueDescriptions: 0,
  uniqueRequested: 0,
  batchTimeoutMs: 0,
  totalBudgetMs: 0,
  coreElapsedMs: 0,
  batchError: false,
});

export function normalizeCoreSummary(input = null) {
  if (!input || typeof input !== "object") {
    return { ...EMPTY_CORE_SUMMARY };
  }
  return {
    ...EMPTY_CORE_SUMMARY,
    ...input,
    unknownFromCore: Number(input.unknownFromCore) || 0,
    timeoutBatches: Number(input.timeoutBatches) || 0,
    errorBatches: Number(input.errorBatches) || 0,
    skippedByBudget: Number(input.skippedByBudget) || 0,
    successBatches: Number(input.successBatches) || 0,
    core: Number(input.core) || 0,
    fallback: Number(input.fallback) || 0,
    total: Number(input.total) || 0,
    coreLimit: Number(input.coreLimit) || 0,
    skipped: Number(input.skipped) || 0,
    partial: Boolean(input.partial),
    userWarning: String(input.userWarning || ""),
    enabled: Boolean(input.enabled),
    batchError: Boolean(input.batchError),
  };
}
