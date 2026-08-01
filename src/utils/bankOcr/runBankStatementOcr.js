/**
 * Taranmış PDF → OCR → mevcut PDF normalize katmanı.
 * OCR çıktısı doğrudan fiş olmaz; parsePdfMovementLines + balance reconcile.
 */

import {
  BANK_PARSE_STATUS,
  BANK_STATEMENT_SOURCE,
  buildSourceFileHash,
  createCanonicalBankTransaction,
} from "@/src/utils/bankCanonicalTransaction.js";
import {
  BALANCE_EVIDENCE_MISSING,
  BALANCE_MISMATCH,
  reconcileStatementBalances,
} from "@/src/utils/bankBalanceReconcile.js";
import {
  extractBalanceHintsFromText,
  estimatePdfPageCount,
  isEncryptedPdf,
  isPdfBuffer,
  looksIncompletePdf,
  parsePdfMovementLines,
  pdfTextToSheetRows,
  PDF_MAX_BYTES,
  PDF_MAX_PAGES,
} from "@/src/utils/bankStatementPdf.js";
import {
  OCR_POLICY,
  OCR_SAFE_MESSAGES,
  OCR_STATUS,
} from "@/src/utils/bankOcr/ocrPolicy.js";
import { createOcrProvider } from "@/src/utils/bankOcr/ocrProvider.js";

function asBytes(input) {
  if (!input) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (typeof ArrayBuffer !== "undefined" && input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(0);
}

function estimatePixels(pageCount = 1) {
  // A4 @ ~150 DPI yaklaşık üst sınır tahmini (bomb koruması)
  const per = 1240 * 1754;
  return { per, total: per * Math.max(1, pageCount) };
}

export function validateOcrPdfBounds(bytes, { pageCount } = {}) {
  const buf = asBytes(bytes);
  if (!buf.length) {
    return { ok: false, code: "EMPTY_PDF", message: OCR_SAFE_MESSAGES.OCR_CORRUPT };
  }
  if (buf.byteLength > OCR_POLICY.MAX_BYTES || buf.byteLength > PDF_MAX_BYTES) {
    return { ok: false, code: "PDF_TOO_LARGE", message: OCR_SAFE_MESSAGES.OCR_TOO_LARGE };
  }
  if (!isPdfBuffer(buf)) {
    return { ok: false, code: "NOT_PDF", message: OCR_SAFE_MESSAGES.OCR_CORRUPT };
  }
  if (isEncryptedPdf(buf)) {
    return { ok: false, code: "PDF_ENCRYPTED", message: OCR_SAFE_MESSAGES.OCR_ENCRYPTED };
  }
  const pages = pageCount || estimatePdfPageCount(buf) || 1;
  if (pages > OCR_POLICY.MAX_PAGES || pages > PDF_MAX_PAGES) {
    return {
      ok: false,
      code: "PDF_TOO_MANY_PAGES",
      message: OCR_SAFE_MESSAGES.OCR_TOO_MANY_PAGES,
      pageCount: pages,
    };
  }
  if (looksIncompletePdf(buf)) {
    return { ok: false, code: "PDF_INCOMPLETE", message: OCR_SAFE_MESSAGES.OCR_CORRUPT };
  }
  const px = estimatePixels(pages);
  if (px.per > OCR_POLICY.MAX_PIXELS_PER_PAGE || px.total > OCR_POLICY.MAX_TOTAL_PIXELS) {
    return { ok: false, code: "OCR_PIXEL_BOMB", message: OCR_SAFE_MESSAGES.OCR_PIXEL_BOMB };
  }
  return { ok: true, pageCount: pages };
}

function joinOcrPages(pages = []) {
  return (pages || [])
    .map((p) => {
      const pageNo = Number(p.page) || 1;
      const body = String(p.text || "").trim();
      return `--- page ${pageNo} ---\n${body}`;
    })
    .join("\n");
}

function applyOcrConfidence(transactions = [], pages = [], options = {}) {
  const pageConf = new Map();
  for (const p of pages) {
    pageConf.set(Number(p.page) || 1, Number(p.confidence) || 0);
  }
  const low = Number(options.lowConfidenceThreshold) || OCR_POLICY.LOW_CONFIDENCE;
  const autoMin =
    Number(options.autoPostMinConfidence) || OCR_POLICY.AUTO_POST_MIN_CONFIDENCE;
  let lowCount = 0;
  const out = transactions.map((tx) => {
    const conf = pageConf.get(Number(tx.sourcePage) || 1);
    const ocrConfidence = Number.isFinite(conf) ? conf : 0.8;
    const lowOcr = ocrConfidence < low;
    if (lowOcr) lowCount += 1;
    return createCanonicalBankTransaction({
      ...tx,
      sourceType: BANK_STATEMENT_SOURCE.PDF_OCR,
      ocrConfidence,
      lowOcrConfidence: lowOcr,
      reviewRequired: Boolean(tx.reviewRequired || lowOcr),
      sourceBoundingBox: tx.sourceBoundingBox || null,
    });
  });
  return {
    transactions: out,
    lowConfidenceCount: lowCount,
    canAutoPost: lowCount === 0 && out.every((t) => (t.ocrConfidence ?? 1) >= autoMin),
  };
}

/**
 * OCR sayfalarını mevcut PDF normalize/validation katmanından geçir.
 */
export function finalizeOcrPagesToParseResult(ocrPages = [], options = {}) {
  const started = Date.now();
  const sourceFileHash = options.sourceFileHash || "";
  const text = joinOcrPages(ocrPages);
  const parsed = parsePdfMovementLines(text, {
    ...options,
    sourceFileHash,
    selectedBank: options.selectedBank || options.detectedBank || undefined,
  });
  const withConf = applyOcrConfidence(parsed.transactions, ocrPages, options);
  const hints = extractBalanceHintsFromText(text);
  const balance = reconcileStatementBalances(withConf.transactions, hints);

  if (!withConf.transactions.length) {
    return {
      ok: false,
      status: BANK_PARSE_STATUS.REVIEW_REQUIRED,
      code: "PDF_UNSUPPORTED_LAYOUT",
      message: "OCR metni banka ekstresi olarak tanınamadı.",
      transactions: [],
      sourceFileHash,
      sheetRows: pdfTextToSheetRows(text),
      detectedBank: parsed.bank,
      ocrUsed: true,
    };
  }

  const reviewRequired =
    Boolean(balance.reviewRequired) ||
    withConf.lowConfidenceCount > 0 ||
    !withConf.canAutoPost;

  let code = "OK";
  if (balance.reviewRequired || balance.code === BALANCE_MISMATCH) {
    code = BALANCE_MISMATCH;
  } else if (balance.code === BALANCE_EVIDENCE_MISSING) {
    code = BALANCE_EVIDENCE_MISSING;
  } else if (withConf.lowConfidenceCount > 0) {
    code = "OCR_LOW_CONFIDENCE";
  }

  return {
    ok: !reviewRequired,
    status: reviewRequired
      ? BANK_PARSE_STATUS.REVIEW_REQUIRED
      : parsed.warnings.length
        ? BANK_PARSE_STATUS.WARNING
        : BANK_PARSE_STATUS.OK,
    code,
    message: reviewRequired
      ? balance.reviewRequired
        ? balance.message
        : "Düşük güvenli OCR satırları inceleme gerektirir. Otomatik fiş kapalı."
      : "",
    transactions: withConf.transactions,
    warnings: parsed.warnings,
    sourceFileHash,
    pageCount: options.pageCount || ocrPages.length,
    detectedBank: parsed.bank || options.detectedBank,
    balance,
    elapsedMs: Date.now() - started,
    sourceType: BANK_STATEMENT_SOURCE.PDF_OCR,
    sheetRows: pdfTextToSheetRows(text),
    ocrUsed: true,
    ocrProvider: options.ocrProvider || "local-test",
    lowConfidenceCount: withConf.lowConfidenceCount,
    canAutoPost: withConf.canAutoPost && !balance.reviewRequired,
    reviewRequired,
  };
}

/**
 * OCR çalıştır + ortak PDF parser’a bağla.
 */
export async function runBankStatementOcr(bytes, options = {}) {
  const started = Date.now();
  const buf = asBytes(bytes);
  const sourceFileHash = buildSourceFileHash(buf);
  const signal = options.signal;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

  const ackTimer = setTimeout(() => {
    onProgress?.({
      status: OCR_STATUS.PREPARING,
      detail: "OCR hazırlanıyor",
      percent: 2,
    });
  }, 0);
  onProgress?.({
    status: OCR_STATUS.PREPARING,
    detail: "OCR hazırlanıyor",
    percent: 1,
  });

  try {
    const bounds = validateOcrPdfBounds(buf);
    if (!bounds.ok) {
      return {
        ok: false,
        status: BANK_PARSE_STATUS.ERROR,
        code: bounds.code,
        message: bounds.message,
        transactions: [],
        sourceFileHash,
        ocrRequired: false,
      };
    }

    const provider = options.provider || createOcrProvider({ env: options.env });
    if (!provider?.configured) {
      return {
        ok: false,
        status: BANK_PARSE_STATUS.OCR_REQUIRED,
        code: OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
        message: OCR_SAFE_MESSAGES.OCR_PROVIDER_NOT_CONFIGURED,
        transactions: [],
        sourceFileHash,
        pageCount: bounds.pageCount,
        ocrRequired: true,
        ocrConfigured: false,
      };
    }

    const timeoutMs = Number(options.timeoutMs) || OCR_POLICY.TIMEOUT_MS;
    let ocrResult;
    try {
      ocrResult = await Promise.race([
        provider.recognize({
          bytes: buf,
          pageCount: options.pageCount || bounds.pageCount,
          signal,
          onProgress,
          selectedBank: options.selectedBank,
          fileName: options.fileName,
          lowConfidence: options.lowConfidence,
          balanceMismatch: options.balanceMismatch,
          simulateFail: options.simulateFail,
          simulateTimeout: options.simulateTimeout,
        }),
        new Promise((_, reject) => {
          const err = new Error(OCR_SAFE_MESSAGES.OCR_TIMEOUT);
          err.code = "OCR_TIMEOUT";
          setTimeout(() => reject(err), timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error?.code === "OCR_CANCELLED" || signal?.aborted) {
        return {
          ok: false,
          status: BANK_PARSE_STATUS.ERROR,
          code: "OCR_CANCELLED",
          message: OCR_SAFE_MESSAGES.OCR_CANCELLED,
          transactions: [],
          sourceFileHash,
        };
      }
      if (error?.code === "OCR_TIMEOUT") {
        return {
          ok: false,
          status: BANK_PARSE_STATUS.ERROR,
          code: "OCR_TIMEOUT",
          message: OCR_SAFE_MESSAGES.OCR_TIMEOUT,
          transactions: [],
          sourceFileHash,
        };
      }
      return {
        ok: false,
        status: BANK_PARSE_STATUS.ERROR,
        code: OCR_STATUS.OCR_FAILED,
        message: OCR_SAFE_MESSAGES.OCR_FAILED,
        transactions: [],
        sourceFileHash,
      };
    }

    if (!ocrResult?.ok) {
      return {
        ok: false,
        status:
          ocrResult?.code === OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED
            ? BANK_PARSE_STATUS.OCR_REQUIRED
            : BANK_PARSE_STATUS.ERROR,
        code: ocrResult?.code || OCR_STATUS.OCR_FAILED,
        message: ocrResult?.message || OCR_SAFE_MESSAGES.OCR_FAILED,
        transactions: [],
        sourceFileHash,
        pageCount: bounds.pageCount,
        ocrRequired: ocrResult?.code === OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
        ocrConfigured: Boolean(ocrResult?.configured),
      };
    }

    onProgress?.({
      status: OCR_STATUS.VALIDATING,
      detail: "Hareketler doğrulanıyor",
      percent: 94,
    });

    const finalized = finalizeOcrPagesToParseResult(ocrResult.pages || [], {
      ...options,
      sourceFileHash,
      pageCount: bounds.pageCount,
      detectedBank: ocrResult.detectedBank,
      ocrProvider: ocrResult.provider || provider.name,
      selectedBank: options.selectedBank || ocrResult.detectedBank,
    });

    onProgress?.({
      status: finalized.reviewRequired
        ? OCR_STATUS.REVIEW_REQUIRED
        : OCR_STATUS.COMPLETED,
      detail: finalized.reviewRequired ? "İnceleme gerekli" : "Tamamlandı",
      percent: 100,
    });

    return {
      ...finalized,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(ackTimer);
  }
}
