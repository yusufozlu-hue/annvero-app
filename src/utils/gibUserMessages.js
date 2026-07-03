import { GIB_QUERY_STATUS } from "@/src/config/gibQueryStatuses";

export const GIB_ROBOT_TECHNICAL_ERROR_MESSAGE =
  "GİB robot servisi çalışırken teknik hata oluştu. Lütfen servis loglarını kontrol edin.";

const TECHNICAL_ERROR_PATTERNS = [
  /playwright/i,
  /libglib/i,
  /shared libraries/i,
  /chromium/i,
  /browserType\.launch/i,
  /Failed to load external module/i,
  /node_modules\/playwright/i,
  /cannot open shared object/i,
  /ENOENT/i,
];

const FRIENDLY_ERROR_PREFIXES = [
  "GİB robot servisi yapılandırılmamış",
  "GİB kullanıcı bilgisi tanımlı değil",
  "Oturum bulunamadı",
  "Doğrulama kodu",
  "companyId zorunludur",
  "sessionId zorunludur",
  "GİB robot servisine ulaşılamadı",
  "Sorgulanacak aktif GİB bilgisi olan firma yok",
  "Veriler yüklenemedi",
  "Firma sorgu listesi yüklenemedi",
];

export function isTechnicalGibError(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  if (text.length > 140) return true;
  return TECHNICAL_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function isFriendlyGibUserMessage(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  return FRIENDLY_ERROR_PREFIXES.some((prefix) => text.startsWith(prefix));
}

export function toGibUserFacingError(message, resultStatus) {
  if (resultStatus === GIB_QUERY_STATUS.LOGIN_ERROR) {
    return "GİB giriş bilgileri veya doğrulama kodu hatalı.";
  }

  const text = String(message || "").trim();

  if (isFriendlyGibUserMessage(text)) {
    return text;
  }

  if (
    resultStatus === GIB_QUERY_STATUS.SYSTEM_ERROR ||
    isTechnicalGibError(text)
  ) {
    return GIB_ROBOT_TECHNICAL_ERROR_MESSAGE;
  }

  return text || GIB_ROBOT_TECHNICAL_ERROR_MESSAGE;
}

export function logGibTechnicalError(context, technicalDetail, extra = {}) {
  if (!technicalDetail) return;
  console.error(`[GIB ${context}]`, technicalDetail, extra);
}
