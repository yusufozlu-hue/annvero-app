/**
 * OCR sağlayıcı çözümleme — production’da credential yoksa sahte başarı yok.
 */

import { OCR_SAFE_MESSAGES, OCR_STATUS } from "@/src/utils/bankOcr/ocrPolicy.js";
import { createLocalTestOcrProvider } from "@/src/utils/bankOcr/localTestOcrProvider.js";
import { createNullOcrProvider } from "@/src/utils/bankOcr/nullOcrProvider.js";

export function resolveOcrProviderName(env) {
  const fromArg =
    env && typeof env === "object"
      ? env.ANNVERO_OCR_PROVIDER ?? env.NEXT_PUBLIC_ANNVERO_OCR_PROVIDER
      : undefined;
  const raw =
    fromArg !== undefined
      ? fromArg
      : (typeof process !== "undefined" ? process.env?.ANNVERO_OCR_PROVIDER : "") ||
        (typeof process !== "undefined"
          ? process.env?.NEXT_PUBLIC_ANNVERO_OCR_PROVIDER
          : "") ||
        "";
  const name = String(raw || "")
    .trim()
    .toLowerCase();
  if (name === "local-test" || name === "test" || name === "fixture") {
    return "local-test";
  }
  if (name === "none" || name === "off" || name === "disabled") return "none";
  return name || "none";
}

export function createOcrProvider(options = {}) {
  const name = resolveOcrProviderName(options.env || {});
  if (name === "local-test") {
    return createLocalTestOcrProvider(options);
  }
  return createNullOcrProvider({
    name: "none",
    code: OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
    message: OCR_SAFE_MESSAGES.OCR_PROVIDER_NOT_CONFIGURED,
  });
}

export function isOcrProviderConfigured(env) {
  return resolveOcrProviderName(env) === "local-test";
}
