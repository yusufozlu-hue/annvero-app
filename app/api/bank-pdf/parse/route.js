/**
 * POST /api/bank-pdf/parse
 * Metin katmanı PDF parse — Node pdf.js (client bundle’dan bağımsız).
 * Ham PDF / metin / IBAN / VKN loglanmaz; yalnız güvenli metrikler.
 */

import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import {
  parseBankStatementPdf,
  PDF_MAX_BYTES,
} from "@/src/utils/bankStatementPdf.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function publicParseResult(result) {
  if (!result || typeof result !== "object") {
    return {
      ok: false,
      code: "PDF_PARSE_FAILED",
      message: "PDF okunamadı.",
      transactions: [],
    };
  }
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
    ocrRequired,
    layoutFallback,
    priorCode,
    extractDiagnostics,
    txCount,
    ocrUsed,
  } = result;
  return {
    ok: Boolean(ok),
    status: status || undefined,
    code: code || (ok ? "OK" : "PDF_PARSE_FAILED"),
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
    ocrRequired: Boolean(ocrRequired),
    layoutFallback: Boolean(layoutFallback),
    priorCode: priorCode || undefined,
    extractDiagnostics: extractDiagnostics || undefined,
    txCount:
      typeof txCount === "number"
        ? txCount
        : Array.isArray(transactions)
          ? transactions.length
          : 0,
    ocrUsed: Boolean(ocrUsed),
  };
}

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const limited = enforceRateLimit(request, session, "bank-pdf-parse", {
    limit: 40,
    windowMs: 60_000,
  });
  if (limited) return limited;

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
  if (size <= 0 || size > PDF_MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        code: "PDF_TOO_LARGE",
        message: `PDF çok büyük. En fazla ${(PDF_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB.`,
        transactions: [],
      },
      { status: 400 }
    );
  }

  const selectedBank = String(form.get("selectedBank") || "").trim();

  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: "PDF_CORRUPT",
        message: "PDF bozuk veya okunamadı.",
        transactions: [],
      },
      { status: 400 }
    );
  }

  try {
    console.error(
      "[bank-pdf-parse]",
      JSON.stringify({
        event: "parse_start",
        byteLength: bytes.byteLength,
        hasBank: Boolean(selectedBank),
      })
    );
  } catch {
    /* ignore */
  }

  const result = await parseBankStatementPdf(bytes, {
    companyId,
    selectedBank: selectedBank || undefined,
  });

  try {
    console.error(
      "[bank-pdf-parse]",
      JSON.stringify({
        event: "parse_done",
        code: result?.code,
        txCount: (result?.transactions || []).length,
        ocrRequired: Boolean(result?.ocrRequired),
        extractPath: result?.extractDiagnostics?.extractPath,
        pdfjsOk: Boolean(result?.extractDiagnostics?.pdfjsOk),
        textLen: result?.extractDiagnostics?.textLen,
        dateCount: result?.extractDiagnostics?.dateCount,
      })
    );
  } catch {
    /* ignore */
  }

  const code = result?.code;
  let status = 200;
  if (result?.ok || (result?.transactions || []).length) status = 200;
  else if (code === "OCR_REQUIRED") status = 422;
  else if (
    code === "PDF_TOO_LARGE" ||
    code === "PDF_TOO_MANY_PAGES" ||
    code === "PDF_ENCRYPTED" ||
    code === "NOT_PDF" ||
    code === "EMPTY_PDF" ||
    code === "PDF_INCOMPLETE"
  )
    status = 400;
  else if (code === "PDF_CANCELLED") status = 499;
  else if (!(result?.transactions || []).length) status = 422;

  return NextResponse.json(publicParseResult(result), { status });
}
