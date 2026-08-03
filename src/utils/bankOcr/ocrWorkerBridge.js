/**
 * Bank OCR worker bridge — ana UI thread’i bloklamaz.
 * Browser (gerçek provider): sunucu round-trip (/api/bank-ocr/run).
 * Browser (local-test worker): classic Worker.
 * Node test: doğrudan runBankStatementOcr.
 */

import { OCR_POLICY, OCR_SAFE_MESSAGES } from "@/src/utils/bankOcr/ocrPolicy.js";
import {
  cancelBankOcrJob,
  getOcrJobHandles,
  setOcrJobHandles,
} from "@/src/utils/bankOcr/ocrJobCancel.js";

export { cancelBankOcrJob } from "@/src/utils/bankOcr/ocrJobCancel.js";

let activeJobId = 0;

function runInNode(bytes, options, onProgress) {
  return import("@/src/utils/bankOcr/runBankStatementOcr.js").then(({ runBankStatementOcr }) =>
    runBankStatementOcr(bytes, { ...options, onProgress })
  );
}

async function finalizeWorkerPages(workerResult, bytes, options, onProgress) {
  const { finalizeOcrPagesToParseResult, validateOcrPdfBounds } = await import(
    "@/src/utils/bankOcr/runBankStatementOcr.js"
  );
  const { buildSourceFileHash } = await import("@/src/utils/bankCanonicalTransaction.js");
  const buf =
    bytes instanceof Uint8Array
      ? bytes
      : bytes instanceof ArrayBuffer
        ? new Uint8Array(bytes)
        : new Uint8Array(0);
  const bounds = validateOcrPdfBounds(buf);
  onProgress?.({
    status: "ocr_validating",
    detail: "Hareketler doğrulanıyor",
    percent: 94,
  });
  const finalized = finalizeOcrPagesToParseResult(workerResult.pages || [], {
    ...options,
    sourceFileHash: buildSourceFileHash(buf),
    pageCount: bounds.pageCount || (workerResult.pages || []).length,
    detectedBank: workerResult.detectedBank,
    ocrProvider: workerResult.provider || "local-test",
    selectedBank: options.selectedBank || workerResult.detectedBank,
  });
  onProgress?.({
    status: finalized.reviewRequired ? "review_required" : "completed",
    detail: finalized.reviewRequired ? "İnceleme gerekli" : "Tamamlandı",
    percent: 100,
  });
  return finalized;
}

/**
 * @param {object} params
 * @param {ArrayBuffer|Uint8Array} params.bytes
 * @param {object} [params.options]
 * @param {(p:object)=>void} [params.onProgress]
 * @param {AbortSignal} [params.signal]
 * @param {number} [params.timeoutMs]
 * @param {URL|string} [params.workerUrl]
 */
export async function runBankOcrJob({
  bytes,
  options = {},
  onProgress,
  signal,
  timeoutMs = OCR_POLICY.TIMEOUT_MS,
  workerUrl = null,
  preferServer = true,
} = {}) {
  const started = Date.now();
  onProgress?.({
    status: "ocr_preparing",
    detail: "OCR hazırlanıyor",
    percent: 1,
  });

  // Tarayıcıda gerçek OCR yalnız sunucu üzerinden (credential sızıntısı yok)
  if (preferServer && typeof window !== "undefined" && typeof fetch === "function") {
    const { runBankOcrViaServer } = await import("@/src/utils/bankOcr/ocrServerClient.js");
    cancelBankOcrJob("superseded");
    const ctrl = new AbortController();
    setOcrJobHandles({ abort: ctrl });
    const onAbort = () => ctrl.abort();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await runBankOcrViaServer({
        bytes,
        companyId: options.companyId || "",
        fileName: options.fileName || "",
        pageCount: options.pageCount || 0,
        selectedBank: options.selectedBank || "",
        signal: ctrl.signal,
        onProgress,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      setOcrJobHandles({ abort: null });
    }
  }

  if (typeof Worker === "undefined" || !workerUrl) {
    return runInNode(bytes, { ...options, signal, timeoutMs }, onProgress);
  }

  const jobId = ++activeJobId;
  cancelBankOcrJob("superseded");

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      if (getOcrJobHandles().worker === worker) setOcrJobHandles({ worker: null });
      fn(value);
    };

    const worker = new Worker(workerUrl /* classic */);
    setOcrJobHandles({ worker });

    const timer = setTimeout(() => {
      finish(resolve, {
        ok: false,
        code: "OCR_TIMEOUT",
        message: OCR_SAFE_MESSAGES.OCR_TIMEOUT,
        transactions: [],
      });
    }, timeoutMs);

    const onAbort = () => {
      finish(resolve, {
        ok: false,
        code: "OCR_CANCELLED",
        message: OCR_SAFE_MESSAGES.OCR_CANCELLED,
        transactions: [],
      });
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });

    worker.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.jobId !== jobId) return;
      if (msg.type === "progress") {
        onProgress?.(msg.progress || {});
        return;
      }
      if (msg.type === "result") {
        const raw = msg.result || {};
        if (raw.needsNormalize && raw.ok) {
          finalizeWorkerPages(raw, bytes, options, onProgress)
            .then((finalized) =>
              finish(resolve, { ...finalized, elapsedMs: Date.now() - started })
            )
            .catch(() =>
              finish(resolve, {
                ok: false,
                code: "OCR_FAILED",
                message: OCR_SAFE_MESSAGES.OCR_FAILED,
                transactions: [],
              })
            );
          return;
        }
        finish(resolve, {
          ...raw,
          elapsedMs: Date.now() - started,
        });
        return;
      }
      if (msg.type === "error") {
        finish(resolve, {
          ok: false,
          code: msg.code || "OCR_FAILED",
          message: msg.message || OCR_SAFE_MESSAGES.OCR_FAILED,
          transactions: [],
        });
      }
    };

    worker.onerror = () => {
      // Worker yüklenemezse Node/main async yola düş
      finish(reject, new Error("OCR_WORKER_UNAVAILABLE"));
    };

    const transfer =
      bytes instanceof ArrayBuffer
        ? bytes.slice(0)
        : bytes?.buffer
          ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
          : null;

    try {
      worker.postMessage(
        {
          type: "ocr",
          jobId,
          options: {
            selectedBank: options.selectedBank || "",
            fileName: options.fileName || "",
            pageCount: options.pageCount || 0,
            lowConfidence: Boolean(options.lowConfidence),
            balanceMismatch: Boolean(options.balanceMismatch),
            simulateFail: Boolean(options.simulateFail),
            providerName: options.providerName || "",
            companyId: options.companyId || "",
          },
          bytes: transfer,
        },
        transfer ? [transfer] : []
      );
    } catch {
      finish(reject, new Error("OCR_WORKER_UNAVAILABLE"));
    }
  }).catch(async (error) => {
    if (String(error?.message || error).includes("OCR_WORKER_UNAVAILABLE")) {
      return runInNode(bytes, { ...options, signal, timeoutMs }, onProgress);
    }
    throw error;
  });
}
