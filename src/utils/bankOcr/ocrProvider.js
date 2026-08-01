/**
 * OCR sağlayıcı çözümleme — production’da credential yoksa sahte başarı yok.
 * NEXT_PUBLIC_* kullanılmaz; provider seçimi yalnız sunucu env.
 */

import { OCR_SAFE_MESSAGES, OCR_STATUS } from "@/src/utils/bankOcr/ocrPolicy.js";
import {
  OCR_ENV_KEYS,
  OCR_PROVIDER_GOOGLE_VISION,
  OCR_PROVIDER_LOCAL_TEST,
  OCR_PROVIDER_NONE,
  allowLocalTestProvider,
  hasGoogleVisionCredentials,
} from "@/src/utils/bankOcr/ocrEnv.js";
import { createLocalTestOcrProvider } from "@/src/utils/bankOcr/localTestOcrProvider.js";
import { createNullOcrProvider } from "@/src/utils/bankOcr/nullOcrProvider.js";
import { createGoogleVisionOcrProvider } from "@/src/utils/bankOcr/googleVisionOcrProvider.js";

function readProviderRaw(env) {
  if (env && typeof env === "object" && env[OCR_ENV_KEYS.provider] != null) {
    return String(env[OCR_ENV_KEYS.provider]).trim();
  }
  if (typeof process !== "undefined" && process.env?.[OCR_ENV_KEYS.provider]) {
    return String(process.env[OCR_ENV_KEYS.provider]).trim();
  }
  return "";
}

export function resolveOcrProviderName(env) {
  const name = String(readProviderRaw(env) || "")
    .trim()
    .toLowerCase();
  if (
    name === OCR_PROVIDER_LOCAL_TEST ||
    name === "test" ||
    name === "fixture"
  ) {
    return allowLocalTestProvider(env) ? OCR_PROVIDER_LOCAL_TEST : OCR_PROVIDER_NONE;
  }
  if (name === OCR_PROVIDER_GOOGLE_VISION || name === "google_vision") {
    return OCR_PROVIDER_GOOGLE_VISION;
  }
  if (name === "none" || name === "off" || name === "disabled" || !name) {
    return OCR_PROVIDER_NONE;
  }
  // Bilinmeyen gerçek provider adı → none (sahte başarı yok)
  return OCR_PROVIDER_NONE;
}

export function createOcrProvider(options = {}) {
  const env = options.env || {};
  const name = resolveOcrProviderName(env);
  if (name === OCR_PROVIDER_LOCAL_TEST) {
    return createLocalTestOcrProvider(options);
  }
  if (name === OCR_PROVIDER_GOOGLE_VISION) {
    return createGoogleVisionOcrProvider({ ...options, env });
  }
  return createNullOcrProvider({
    name: OCR_PROVIDER_NONE,
    code: OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
    message: OCR_SAFE_MESSAGES.OCR_PROVIDER_NOT_CONFIGURED,
  });
}

/**
 * Gerçek provider + gerekli credential’lar doluysa true.
 * local-test yalnız non-production’da configured sayılır.
 */
export function isOcrProviderConfigured(env) {
  const name = resolveOcrProviderName(env);
  if (name === OCR_PROVIDER_LOCAL_TEST) {
    return allowLocalTestProvider(env);
  }
  if (name === OCR_PROVIDER_GOOGLE_VISION) {
    return hasGoogleVisionCredentials(env);
  }
  return false;
}
