/**
 * Banka PDF OCR — merkezi güvenlik ve performans politikası.
 * Ham PDF / OCR metni / IBAN / VKN loglanmaz.
 */

export const OCR_POLICY = Object.freeze({
  MAX_BYTES: 8 * 1024 * 1024,
  MAX_PAGES: 80,
  MAX_PIXELS_PER_PAGE: 25_000_000,
  MAX_TOTAL_PIXELS: 200_000_000,
  MIN_DPI: 72,
  MIN_EDGE_PX: 200,
  TIMEOUT_MS: 60_000,
  PAGE_TIMEOUT_MS: 15_000,
  PROGRESS_FIRST_MS: 500,
  UI_ACK_MS: 200,
  LOW_CONFIDENCE: 0.72,
  AUTO_POST_MIN_CONFIDENCE: 0.85,
});

export const OCR_SAFE_MESSAGES = Object.freeze({
  OCR_REQUIRED:
    "Bu PDF taranmış görünüyor; metin katmanı yok. OCR tamamlanana kadar inceleme kuyruğuna alındı.",
  OCR_FAILED:
    "OCR tamamlanamadı. Dosyayı kontrol edip güvenli biçimde yeniden deneyin.",
  OCR_PROVIDER_NOT_CONFIGURED:
    "OCR servisi yapılandırılmamış. Taranmış PDF’ler inceleme kuyruğunda bekler.",
  OCR_TIMEOUT: "OCR zaman aşımına uğradı. Dosyayı bölüp tekrar deneyin.",
  OCR_CANCELLED: "OCR iptal edildi.",
  OCR_TOO_LARGE: `PDF çok büyük. En fazla ${(OCR_POLICY.MAX_BYTES / (1024 * 1024)).toFixed(0)} MB desteklenir.`,
  OCR_TOO_MANY_PAGES: `Sayfa sayısı çok yüksek. En fazla ${OCR_POLICY.MAX_PAGES} sayfa desteklenir.`,
  OCR_LOW_RESOLUTION:
    "Sayfa çözünürlüğü OCR için çok düşük. Daha net bir tarama yükleyin.",
  OCR_PIXEL_BOMB: "PDF görüntü boyutu güvenlik sınırını aşıyor.",
  OCR_ENCRYPTED: "Şifreli PDF desteklenmiyor. Şifreyi kaldırıp tekrar yükleyin.",
  OCR_CORRUPT: "PDF bozuk veya desteklenmeyen biçimde.",
});

export const OCR_STATUS = Object.freeze({
  IDLE: "idle",
  PREPARING: "ocr_preparing",
  READING_PAGE: "ocr_reading_page",
  VALIDATING: "ocr_validating",
  REVIEW_REQUIRED: "review_required",
  OCR_REQUIRED: "OCR_REQUIRED",
  OCR_FAILED: "OCR_FAILED",
  OCR_PROVIDER_NOT_CONFIGURED: "OCR_PROVIDER_NOT_CONFIGURED",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});
