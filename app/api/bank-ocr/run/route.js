/**
 * POST /api/bank-ocr/run
 * Taranmış banka PDF OCR — Google Vision sunucu tarafı.
 * Ham PDF / OCR metni / IBAN / VKN loglanmaz.
 */

import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import {
  isOcrProviderConfigured,
  resolveOcrProviderName,
  createOcrProvider,
} from "@/src/utils/bankOcr/ocrProvider.js";
import { OCR_SAFE_MESSAGES, OCR_STATUS, OCR_POLICY } from "@/src/utils/bankOcr/ocrPolicy.js";
import { runBankStatementOcr } from "@/src/utils/bankOcr/runBankStatementOcr.js";
import { OCR_PROVIDER_GOOGLE_VISION } from "@/src/utils/bankOcr/ocrEnv.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function publicOcrResult(result) {
  if (!result || typeof result !== "object") {
    return {
      ok: false,
      code: OCR_STATUS.OCR_FAILED,
      message: OCR_SAFE_MESSAGES.OCR_FAILED,
      transactions: [],
    };
  }
  // sheetRows UI için gerekli; ham OCR sayfa metni istemciye gönderilmez
  const {
    ok,
    status,
    code,
    message,
    transactions,
    warnings,
    sourceFileHash,
    pageCount,
    detectedBank,
    balance,
    elapsedMs,
    sourceType,
    sheetRows,
    ocrUsed,
    ocrProvider,
    lowConfidenceCount,
    canAutoPost,
    reviewRequired,
    ocrRequired,
    ocrConfigured,
  } = result;
  return {
    ok: Boolean(ok),
    status: status || undefined,
    code: code || (ok ? "OK" : OCR_STATUS.OCR_FAILED),
    message: message || "",
    transactions: Array.isArray(transactions) ? transactions : [],
    warnings: Array.isArray(warnings) ? warnings : undefined,
    sourceFileHash: sourceFileHash || "",
    pageCount: pageCount || 0,
    detectedBank: detectedBank || undefined,
    balance: balance || undefined,
    elapsedMs: elapsedMs || undefined,
    sourceType: sourceType || undefined,
    sheetRows: Array.isArray(sheetRows) ? sheetRows : undefined,
    ocrUsed: Boolean(ocrUsed),
    ocrProvider:
      ocrProvider === OCR_PROVIDER_GOOGLE_VISION ? OCR_PROVIDER_GOOGLE_VISION : undefined,
    lowConfidenceCount: lowConfidenceCount ?? undefined,
    canAutoPost: canAutoPost ?? undefined,
    reviewRequired: Boolean(reviewRequired),
    ocrRequired: Boolean(ocrRequired),
    ocrConfigured: ocrConfigured ?? isOcrProviderConfigured(),
  };
}

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const limited = enforceRateLimit(request, session, "bank-ocr-run", {
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  if (!isOcrProviderConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        code: OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
        message: OCR_SAFE_MESSAGES.OCR_PROVIDER_NOT_CONFIGURED,
        transactions: [],
        ocrRequired: true,
        ocrConfigured: false,
        provider: "none",
      },
      { status: 503 }
    );
  }

  const providerName = resolveOcrProviderName();
  if (providerName !== OCR_PROVIDER_GOOGLE_VISION) {
    // Production’da local-test kabul edilmez; yalnız gerçek provider
    return NextResponse.json(
      {
        ok: false,
        code: OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
        message: OCR_SAFE_MESSAGES.OCR_PROVIDER_NOT_CONFIGURED,
        transactions: [],
        ocrRequired: true,
        ocrConfigured: false,
        provider: "none",
      },
      { status: 503 }
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "Geçersiz istek.", transactions: [] },
      { status: 400 }
    );
  }

  const companyId = String(form.get("companyId") || "").trim();
  const access = assertCompanyAccess(session.access, companyId, { required: true });
  if (!access.ok) return access.response;

  const file = form.get("file");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "PDF dosyası gerekli.", transactions: [] },
      { status: 400 }
    );
  }

  const size = Number(file.size) || 0;
  if (size <= 0 || size > OCR_POLICY.MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        code: "PDF_TOO_LARGE",
        message: OCR_SAFE_MESSAGES.OCR_TOO_LARGE,
        transactions: [],
      },
      { status: 400 }
    );
  }

  const fileName = String(form.get("fileName") || file.name || "statement.pdf").slice(
    0,
    240
  );
  const pageCount = Number(form.get("pageCount")) || 0;
  const selectedBank = String(form.get("selectedBank") || "").trim();

  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: OCR_STATUS.OCR_FAILED,
        message: OCR_SAFE_MESSAGES.OCR_CORRUPT,
        transactions: [],
      },
      { status: 400 }
    );
  }

  const provider = createOcrProvider();
  const result = await runBankStatementOcr(bytes, {
    provider,
    companyId,
    fileName,
    pageCount: pageCount || undefined,
    selectedBank: selectedBank || undefined,
    timeoutMs: OCR_POLICY.TIMEOUT_MS,
  });

  const code = result?.code;
  let status = 422;
  if (code === OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED) status = 503;
  else if (result?.ok || (result?.transactions || []).length) status = 200;
  else if (code === "OCR_CANCELLED") status = 499;
  else if (code === OCR_STATUS.OCR_AUTH_FAILED) status = 401;
  else if (code === OCR_STATUS.OCR_PERMISSION_DENIED) status = 403;
  else if (code === OCR_STATUS.OCR_RATE_LIMITED) status = 429;
  else if (
    code === OCR_STATUS.OCR_PROVIDER_TIMEOUT ||
    code === "OCR_TIMEOUT"
  )
    status = 504;
  else if (
    code === "PDF_TOO_LARGE" ||
    code === "PDF_TOO_MANY_PAGES" ||
    code === "PDF_ENCRYPTED" ||
    code === "NOT_PDF" ||
    code === "EMPTY_PDF" ||
    code === OCR_STATUS.OCR_INVALID_DOCUMENT
  )
    status = 400;

  return NextResponse.json(publicOcrResult(result), { status });
}
