/**
 * Tarayıcı → sunucu PDF metin katmanı parse.
 * pdf.js Node tarafında çalışır (Vercel client bundle / worker sorunlarından bağımsız).
 * Ham PDF / IBAN / VKN / metin istemci loguna yazılmaz.
 */

import { PDF_MAX_BYTES } from "@/src/utils/bankStatementPdf";

function asArrayBuffer(bytes) {
  if (!bytes) return new ArrayBuffer(0);
  if (bytes instanceof ArrayBuffer) return bytes;
  if (bytes instanceof Uint8Array) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return new ArrayBuffer(0);
}

/**
 * POST /api/bank-pdf/parse — multipart PDF + companyId.
 * Başarısız ağ/5xx durumunda null döner; çağıran istemci fallback kullanabilir.
 */
export async function runBankPdfParseViaServer({
  bytes,
  companyId = "",
  fileName = "",
  selectedBank = "",
  signal,
  parseUrl = "/api/bank-pdf/parse",
} = {}) {
  const ab = asArrayBuffer(bytes);
  if (!ab.byteLength || ab.byteLength > PDF_MAX_BYTES) {
    return null;
  }

  const form = new FormData();
  form.set("companyId", String(companyId || ""));
  if (fileName) form.set("fileName", String(fileName));
  if (selectedBank) form.set("selectedBank", String(selectedBank));
  const uploadBytes = ab.byteLength ? ab.slice(0) : ab;
  form.set(
    "file",
    new Blob([uploadBytes], { type: "application/pdf" }),
    fileName || "statement.pdf"
  );

  try {
    const res = await fetch(parseUrl, {
      method: "POST",
      body: form,
      signal,
      credentials: "same-origin",
    });
    const json = await res.json().catch(() => null);
    if (!json || typeof json !== "object") return null;
    // 422 OCR_REQUIRED / REVIEW de geçerli yanıt
    if (res.status >= 500) return null;
    return json;
  } catch {
    return null;
  }
}
