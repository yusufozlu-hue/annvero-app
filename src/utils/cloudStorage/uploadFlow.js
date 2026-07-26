/**
 * Cloud Storage upload UI durum makinesi (pure).
 * API / güvenlik kurallarını değiştirmez.
 */

export const UPLOAD_PHASE = Object.freeze({
  IDLE: "idle",
  UPLOADING: "uploading",
  SYNCING: "syncing",
  COMPLETED: "completed",
  DUPLICATE: "duplicate",
  ERROR: "error",
});

export const DUPLICATE_USER_MESSAGE =
  "Mükerrer — daha önce yüklenmiş, yeni kopya oluşturulmadı.";

export const UPLOADED_INDEXING_MESSAGE = "Drive’a yüklendi, indeksleniyor…";

export const UPLOADED_AND_INDEXED_MESSAGE = "Yüklendi ve indekslendi.";

export const UPLOADED_SYNC_FAILED_MESSAGE =
  "Drive’a yüklendi fakat indeksleme başarısız. Senkronizasyonu Yenile’yi deneyin.";

/**
 * Buton etiketi — faz’a göre.
 */
export function uploadButtonLabel(phase) {
  switch (phase) {
    case UPLOAD_PHASE.UPLOADING:
      return "Drive’a yükleniyor…";
    case UPLOAD_PHASE.SYNCING:
      return "İndeksleniyor…";
    case UPLOAD_PHASE.ERROR:
      return "Tekrar dene";
    case UPLOAD_PHASE.COMPLETED:
    case UPLOAD_PHASE.DUPLICATE:
    case UPLOAD_PHASE.IDLE:
    default:
      return "Dosya seç";
  }
}

/**
 * En az bir yeni (non-duplicate) başarı var mı → sync gerekir.
 */
export function shouldRunSyncAfterUploadResults(itemStatuses = []) {
  return itemStatuses.some((status) => status === "success");
}

/**
 * Upload turu bittikten sonra faz:
 * - en az bir success → syncing
 * - success yok, en az bir duplicate → duplicate
 * - yalnız error → error
 * - boş → idle
 */
export function phaseAfterUploadResults(itemStatuses = []) {
  const hasSuccess = itemStatuses.some((s) => s === "success");
  const hasDuplicate = itemStatuses.some((s) => s === "duplicate");
  const hasError = itemStatuses.some((s) => s === "error");
  if (hasSuccess) return UPLOAD_PHASE.SYNCING;
  if (hasDuplicate) return UPLOAD_PHASE.DUPLICATE;
  if (hasError) return UPLOAD_PHASE.ERROR;
  return UPLOAD_PHASE.IDLE;
}

/**
 * Sync sonucu sonrası faz.
 */
export function phaseAfterSyncResult({ ok }) {
  return ok ? UPLOAD_PHASE.COMPLETED : UPLOAD_PHASE.ERROR;
}

/**
 * Upload/sync sırasında hedef klasör ve dosya seçimi kilitli mi?
 */
export function isUploadUiLocked(phase) {
  return phase === UPLOAD_PHASE.UPLOADING || phase === UPLOAD_PHASE.SYNCING;
}

/**
 * aria-live / özet metin.
 */
export function uploadPhaseLiveMessage(phase, { syncError = false } = {}) {
  switch (phase) {
    case UPLOAD_PHASE.UPLOADING:
      return "Dosyalar Drive’a yükleniyor.";
    case UPLOAD_PHASE.SYNCING:
      return UPLOADED_INDEXING_MESSAGE;
    case UPLOAD_PHASE.COMPLETED:
      return UPLOADED_AND_INDEXED_MESSAGE;
    case UPLOAD_PHASE.DUPLICATE:
      return DUPLICATE_USER_MESSAGE;
    case UPLOAD_PHASE.ERROR:
      return syncError
        ? UPLOADED_SYNC_FAILED_MESSAGE
        : "Yükleme başarısız. Tekrar deneyebilirsiniz.";
    case UPLOAD_PHASE.IDLE:
    default:
      return "";
  }
}
