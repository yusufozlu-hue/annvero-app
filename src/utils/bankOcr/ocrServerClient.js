/**
 * Tarayıcı → sunucu OCR round-trip.
 * Credential / provider teknik ayrıntı istemciye gönderilmez.
 */

import { OCR_SAFE_MESSAGES, OCR_STATUS } from "@/src/utils/bankOcr/ocrPolicy.js";

function asArrayBuffer(bytes) {
  if (!bytes) return new ArrayBuffer(0);
  if (bytes instanceof ArrayBuffer) return bytes;
  if (bytes instanceof Uint8Array) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return new ArrayBuffer(0);
}

/**
 * POST /api/bank-ocr/run — multipart PDF + companyId.
 */
export async function runBankOcrViaServer({
  bytes,
  companyId = "",
  fileName = "",
  pageCount = 0,
  selectedBank = "",
  signal,
  onProgress,
  statusUrl = "/api/bank-ocr/status",
  runUrl = "/api/bank-ocr/run",
} = {}) {
  onProgress?.({
    status: OCR_STATUS.PREPARING,
    detail: "OCR hazırlanıyor",
    percent: 2,
  });

  const statusRes = await fetch(statusUrl, { signal, credentials: "same-origin" }).catch(
    () => null
  );
  const statusJson = statusRes?.ok ? await statusRes.json().catch(() => null) : null;
  if (!statusJson?.configured) {
    return {
      ok: false,
      code: OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
      message: OCR_SAFE_MESSAGES.OCR_PROVIDER_NOT_CONFIGURED,
      transactions: [],
      ocrRequired: true,
      ocrConfigured: false,
    };
  }

  onProgress?.({
    status: OCR_STATUS.READING_PAGE,
    detail: "Sayfalar sunucuda okunuyor",
    percent: 20,
    page: 1,
    pageCount: pageCount || null,
  });

  const form = new FormData();
  form.set("companyId", String(companyId || ""));
  if (fileName) form.set("fileName", String(fileName));
  if (pageCount) form.set("pageCount", String(pageCount));
  if (selectedBank) form.set("selectedBank", String(selectedBank));
  const ab = asArrayBuffer(bytes);
  // FormData Blob için bağımsız kopya — çağıranın buffer'ı transfer edilmesin
  const uploadBytes = ab.byteLength ? ab.slice(0) : ab;
  form.set(
    "file",
    new Blob([uploadBytes], { type: "application/pdf" }),
    fileName || "statement.pdf"
  );

  const res = await fetch(runUrl, {
    method: "POST",
    body: form,
    signal,
    credentials: "same-origin",
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    return {
      ok: false,
      code: json?.code || OCR_STATUS.OCR_FAILED,
      message: json?.message || OCR_SAFE_MESSAGES.OCR_FAILED,
      transactions: [],
      ocrConfigured: Boolean(statusJson?.configured),
    };
  }

  onProgress?.({
    status: json.reviewRequired ? OCR_STATUS.REVIEW_REQUIRED : OCR_STATUS.COMPLETED,
    detail: json.reviewRequired ? "İnceleme gerekli" : "Tamamlandı",
    percent: 100,
  });

  return json;
}
