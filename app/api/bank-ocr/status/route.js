import { NextResponse } from "next/server";
import {
  isOcrProviderConfigured,
  resolveOcrProviderName,
} from "@/src/utils/bankOcr/ocrProvider.js";
import { OCR_SAFE_MESSAGES, OCR_STATUS } from "@/src/utils/bankOcr/ocrPolicy.js";

/**
 * OCR sağlayıcı durumu — credential/teknik ayrıntı döndürmez.
 */
export async function GET() {
  const configured = isOcrProviderConfigured();
  const provider = resolveOcrProviderName();
  return NextResponse.json({
    configured,
    provider: configured ? provider : "none",
    code: configured ? "OK" : OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
    message: configured ? "" : OCR_SAFE_MESSAGES.OCR_PROVIDER_NOT_CONFIGURED,
  });
}
