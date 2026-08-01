/**
 * Yapılandırılmamış OCR — sahte hareket üretmez.
 */

import { OCR_SAFE_MESSAGES, OCR_STATUS } from "@/src/utils/bankOcr/ocrPolicy.js";

export function createNullOcrProvider({
  name = "none",
  code = OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
  message = OCR_SAFE_MESSAGES.OCR_PROVIDER_NOT_CONFIGURED,
} = {}) {
  return {
    name,
    configured: false,
    async recognize() {
      return {
        ok: false,
        code,
        status: code,
        message,
        pages: [],
        configured: false,
      };
    },
  };
}
