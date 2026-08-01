import { NextResponse } from "next/server";
import {
  isOcrProviderConfigured,
  resolveOcrProviderName,
} from "@/src/utils/bankOcr/ocrProvider.js";
import { OCR_SAFE_MESSAGES, OCR_STATUS } from "@/src/utils/bankOcr/ocrPolicy.js";
import { OCR_PROVIDER_GOOGLE_VISION } from "@/src/utils/bankOcr/ocrEnv.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OCR sağlayıcı durumu — credential/teknik ayrıntı döndürmez.
 * GET /api/bank-ocr/status
 */
export async function GET() {
  const configured = isOcrProviderConfigured();
  const provider = resolveOcrProviderName();
  const publicProvider =
    configured && provider === OCR_PROVIDER_GOOGLE_VISION
      ? OCR_PROVIDER_GOOGLE_VISION
      : configured && provider === "local-test"
        ? "local-test"
        : "none";
  return NextResponse.json({
    configured,
    provider: publicProvider,
    code: configured ? "OK" : OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
    message: configured ? "" : OCR_SAFE_MESSAGES.OCR_PROVIDER_NOT_CONFIGURED,
  });
}
