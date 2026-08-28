export const CORRECTION_RECORD_STATUS = {
  EXPORTED: "EXPORTED",
  APPLIED: "APPLIED",
  CANCELLED: "CANCELLED",
};

export const CORRECTION_RECORD_EXTERNAL_SYSTEM = {
  LUCA: "LUCA",
};

export const CORRECTION_RECORD_ERROR = {
  UNAUTHORIZED: "CORRECTION_RECORD_UNAUTHORIZED",
  INVALID: "CORRECTION_RECORD_INVALID",
  CONFLICT: "CORRECTION_RECORD_CONFLICT",
  NOT_FOUND: "CORRECTION_RECORD_NOT_FOUND",
  EXPORT_FAILED: "CORRECTION_RECORD_EXPORT_FAILED",
  APPLY_FAILED: "CORRECTION_RECORD_APPLY_FAILED",
};

export const CORRECTION_RECORD_USER_MESSAGE_TR = {
  [CORRECTION_RECORD_ERROR.UNAUTHORIZED]: "Bu firmaya erişim yetkiniz yok.",
  [CORRECTION_RECORD_ERROR.INVALID]: "Düzeltme kaydı doğrulanamadı.",
  [CORRECTION_RECORD_ERROR.CONFLICT]: "Bu düzeltme zaten kayıtlı.",
  [CORRECTION_RECORD_ERROR.NOT_FOUND]: "Düzeltme kaydı bulunamadı.",
  [CORRECTION_RECORD_ERROR.EXPORT_FAILED]: "Düzeltme export kaydı oluşturulamadı.",
  [CORRECTION_RECORD_ERROR.APPLY_FAILED]: "Düzeltme uygulama kaydı güncellenemedi.",
};

export function correctionRecordUserMessage(code = "", fallback = "") {
  return (
    CORRECTION_RECORD_USER_MESSAGE_TR[code] ||
    fallback ||
    "İşlem tamamlanamadı. Lütfen tekrar deneyin."
  );
}
