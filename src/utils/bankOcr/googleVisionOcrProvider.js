/**
 * Google Cloud Vision — DOCUMENT_TEXT_DETECTION via images:annotate.
 * PDF bytes are NEVER sent to Vision; pages are rasterized server-side first.
 * Credential / ham PDF / OCR metni loglanmaz.
 */

import { createSign } from "node:crypto";
import {
  OCR_POLICY,
  OCR_SAFE_MESSAGES,
  OCR_STATUS,
} from "@/src/utils/bankOcr/ocrPolicy.js";
import {
  OCR_PROVIDER_GOOGLE_VISION,
  resolveGoogleVisionCredentials,
} from "@/src/utils/bankOcr/ocrEnv.js";
import { rasterizePdfPages } from "@/src/utils/bankOcr/rasterizePdfPages.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const VISION_IMAGES_URL = "https://vision.googleapis.com/v1/images:annotate";
const VISION_SCOPE = "https://www.googleapis.com/auth/cloud-vision";
/** Vision images:annotate batch size */
const IMAGES_PER_REQUEST = 5;

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function safeOcrLog(event, fields = {}) {
  try {
    console.error(
      "[bank-ocr]",
      JSON.stringify({
        event,
        httpStatus: fields.httpStatus ?? undefined,
        code: fields.code ?? undefined,
        stage: fields.stage ?? undefined,
      })
    );
  } catch {
    /* ignore */
  }
}

function failResult(code, message, extra = {}) {
  return {
    ok: false,
    code,
    status: code,
    message: message || OCR_SAFE_MESSAGES[code] || OCR_SAFE_MESSAGES.OCR_FAILED,
    pages: [],
    configured: true,
    provider: OCR_PROVIDER_GOOGLE_VISION,
    ...extra,
  };
}

export function classifyVisionHttpStatus(httpStatus, stage = "vision") {
  const s = Number(httpStatus) || 0;
  if (s === 401) {
    return {
      code: OCR_STATUS.OCR_AUTH_FAILED,
      message: OCR_SAFE_MESSAGES.OCR_AUTH_FAILED,
      stage,
    };
  }
  if (s === 403) {
    return {
      code: OCR_STATUS.OCR_PERMISSION_DENIED,
      message: OCR_SAFE_MESSAGES.OCR_PERMISSION_DENIED,
      stage,
    };
  }
  if (s === 400) {
    return {
      code: OCR_STATUS.OCR_INVALID_DOCUMENT,
      message: OCR_SAFE_MESSAGES.OCR_INVALID_DOCUMENT,
      stage,
    };
  }
  if (s === 429) {
    return {
      code: OCR_STATUS.OCR_RATE_LIMITED,
      message: OCR_SAFE_MESSAGES.OCR_RATE_LIMITED,
      stage,
    };
  }
  if (s === 408 || s === 504 || s === 524) {
    return {
      code: OCR_STATUS.OCR_PROVIDER_TIMEOUT,
      message: OCR_SAFE_MESSAGES.OCR_PROVIDER_TIMEOUT,
      stage,
    };
  }
  return {
    code: OCR_STATUS.OCR_PROVIDER_FAILED,
    message: OCR_SAFE_MESSAGES.OCR_PROVIDER_FAILED,
    stage,
  };
}

function signJwtRs256(header, payload, privateKeyPem) {
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const sig = signer.sign(privateKeyPem);
  return `${data}.${base64url(sig)}`;
}

async function fetchAccessToken(credentials, fetchImpl = fetch) {
  let assertion;
  try {
    const now = Math.floor(Date.now() / 1000);
    assertion = signJwtRs256(
      { alg: "RS256", typ: "JWT" },
      {
        iss: credentials.clientEmail,
        scope: VISION_SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      },
      credentials.privateKey
    );
  } catch {
    safeOcrLog("token_sign_failed", {
      code: OCR_STATUS.OCR_AUTH_FAILED,
      stage: "oauth",
    });
    const err = new Error("OCR_AUTH_FAILED");
    err.code = OCR_STATUS.OCR_AUTH_FAILED;
    throw err;
  }

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  let res;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    const err = new Error("OCR_PROVIDER_TIMEOUT");
    err.code = OCR_STATUS.OCR_PROVIDER_TIMEOUT;
    throw err;
  }
  if (!res.ok) {
    const classified = classifyVisionHttpStatus(res.status, "oauth");
    safeOcrLog("token_http_failed", {
      httpStatus: res.status,
      code: classified.code,
      stage: "oauth",
    });
    const err = new Error(classified.code);
    err.code = classified.code;
    err.httpStatus = res.status;
    throw err;
  }
  const json = await res.json();
  const token = String(json?.access_token || "").trim();
  if (!token) {
    const err = new Error("OCR_AUTH_FAILED");
    err.code = OCR_STATUS.OCR_AUTH_FAILED;
    throw err;
  }
  return token;
}

function pageConfidence(page) {
  if (page && typeof page.confidence === "number") return page.confidence;
  const blocks = page?.blocks || [];
  if (!blocks.length) return 0.75;
  let sum = 0;
  let n = 0;
  for (const b of blocks) {
    if (typeof b.confidence === "number") {
      sum += b.confidence;
      n += 1;
    }
  }
  return n ? sum / n : 0.75;
}

function vertexCenter(vertices = []) {
  if (!Array.isArray(vertices) || !vertices.length) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const v of vertices) {
    const x = Number(v?.x);
    const y = Number(v?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x;
    sy += y;
    n += 1;
  }
  if (!n) return null;
  return { x: sx / n, y: sy / n };
}

function wordTextFromSymbols(word) {
  const symbols = word?.symbols || [];
  let out = "";
  for (const s of symbols) {
    out += String(s?.text || "");
    const br = s?.property?.detectedBreak?.type;
    if (br === "SPACE" || br === "SURE_SPACE") out += " ";
    else if (br === "EOL_SURE_SPACE" || br === "LINE_BREAK") out += "\n";
  }
  return out;
}

/**
 * Vision tablo OCR: kelimeleri Y bandına göre satırlara diz.
 * fullText tek blok olduğunda tarih/tutar kırılmalarını azaltır.
 * Ham metin loglanmaz.
 */
export function rebuildTextLinesFromVisionPage(page) {
  const words = [];
  for (const block of page?.blocks || []) {
    for (const para of block?.paragraphs || []) {
      for (const word of para?.words || []) {
        const text = wordTextFromSymbols(word).replace(/\s+/g, " ").trim();
        if (!text) continue;
        const c = vertexCenter(word?.boundingBox?.vertices);
        if (!c) continue;
        const ys = (word?.boundingBox?.vertices || [])
          .map((v) => Number(v?.y))
          .filter((y) => Number.isFinite(y));
        const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 12;
        words.push({ text, x: c.x, y: c.y, height: Math.max(8, height) });
      }
    }
  }
  if (!words.length) return "";

  words.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const lines = [];
  let current = null;
  for (const w of words) {
    const band = Math.max(10, (current?.avgHeight || w.height) * 0.55);
    if (!current || Math.abs(w.y - current.y) > band) {
      if (current) {
        current.words.sort((a, b) => a.x - b.x);
        lines.push(current.words.map((x) => x.text).join(" ").trim());
      }
      current = { y: w.y, avgHeight: w.height, words: [w] };
    } else {
      const n = current.words.length + 1;
      current.y = (current.y * (n - 1) + w.y) / n;
      current.avgHeight = (current.avgHeight * (n - 1) + w.height) / n;
      current.words.push(w);
    }
  }
  if (current) {
    current.words.sort((a, b) => a.x - b.x);
    lines.push(current.words.map((x) => x.text).join(" ").trim());
  }
  return lines.filter(Boolean).join("\n");
}

function extractPagesFromImagesResponse(visionJson, pageStart = 1) {
  const responses = visionJson?.responses || [];
  const out = [];
  let providerError = null;
  for (let i = 0; i < responses.length; i += 1) {
    const pr = responses[i];
    if (pr?.error) {
      const status = Number(pr.error.code) || 0;
      // google.rpc.Code: 7=PERMISSION_DENIED, 16=UNAUTHENTICATED, 8=RESOURCE_EXHAUSTED, 3=INVALID_ARGUMENT
      if (status === 16) providerError = OCR_STATUS.OCR_AUTH_FAILED;
      else if (status === 7) providerError = OCR_STATUS.OCR_PERMISSION_DENIED;
      else if (status === 8) providerError = OCR_STATUS.OCR_RATE_LIMITED;
      else if (status === 3 || status === 9) providerError = OCR_STATUS.OCR_INVALID_DOCUMENT;
      else providerError = providerError || OCR_STATUS.OCR_PROVIDER_FAILED;
      continue;
    }
    const full = pr?.fullTextAnnotation;
    const pageMeta = (full?.pages || [])[0];
    const geometric = rebuildTextLinesFromVisionPage(pageMeta);
    const fallback = String(full?.text || "").trim();
    const text = (geometric || fallback).trim();
    out.push({
      page: pageStart + i,
      text,
      confidence: pageConfidence(pageMeta),
      width: Number(pageMeta?.width) || 0,
      height: Number(pageMeta?.height) || 0,
      dpi: TARGET_DPI_HINT,
    });
  }
  return { pages: out, providerError };
}

const TARGET_DPI_HINT = 150;

async function annotateImageBatch({
  accessToken,
  images,
  fetchImpl,
  signal,
}) {
  const res = await fetchImpl(VISION_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: images.map((img) => ({
        image: {
          content: Buffer.from(img.bytes).toString("base64"),
        },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      })),
    }),
    signal,
  });
  if (!res.ok) {
    const classified = classifyVisionHttpStatus(res.status, "vision");
    safeOcrLog("vision_http_failed", {
      httpStatus: res.status,
      code: classified.code,
      stage: "vision",
    });
    const err = new Error(classified.code);
    err.code = classified.code;
    err.httpStatus = res.status;
    throw err;
  }
  return res.json();
}

/**
 * @param {object} [options]
 * @param {object} [options.env]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(creds:object)=>Promise<string>} [options.tokenFn]
 * @param {typeof rasterizePdfPages} [options.rasterizeFn]
 */
export function createGoogleVisionOcrProvider(options = {}) {
  const env = options.env;
  const credentials = resolveGoogleVisionCredentials(env);
  const fetchImpl = options.fetchImpl || fetch;
  const tokenFn = options.tokenFn;
  const rasterizeFn = options.rasterizeFn || rasterizePdfPages;

  return {
    name: OCR_PROVIDER_GOOGLE_VISION,
    configured: Boolean(credentials),
    async recognize({
      bytes,
      pageCount = 1,
      signal,
      onProgress,
    } = {}) {
      if (!credentials) {
        return {
          ok: false,
          code: OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
          status: OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED,
          message: OCR_SAFE_MESSAGES.OCR_PROVIDER_NOT_CONFIGURED,
          pages: [],
          configured: false,
        };
      }

      const buf =
        bytes instanceof Uint8Array
          ? bytes
          : bytes instanceof ArrayBuffer
            ? new Uint8Array(bytes)
            : new Uint8Array(0);
      if (!buf.length) {
        return failResult(
          OCR_STATUS.OCR_INVALID_DOCUMENT,
          OCR_SAFE_MESSAGES.OCR_CORRUPT
        );
      }

      const pagesHint = Math.max(
        1,
        Math.min(Number(pageCount) || 1, OCR_POLICY.MAX_PAGES)
      );
      onProgress?.({
        status: OCR_STATUS.PREPARING,
        detail: "OCR hazırlanıyor",
        percent: 4,
        page: 0,
        pageCount: pagesHint,
      });

      try {
        let rasterPages;
        try {
          rasterPages = await rasterizeFn(buf, {
            pageCount: pagesHint,
            signal,
            onProgress,
          });
        } catch (error) {
          if (error?.code === "OCR_CANCELLED" || signal?.aborted) {
            const err = new Error(OCR_SAFE_MESSAGES.OCR_CANCELLED);
            err.code = "OCR_CANCELLED";
            throw err;
          }
          const code = String(error?.code || "");
          if (
            code === "OCR_TOO_LARGE" ||
            code === "OCR_TOO_MANY_PAGES" ||
            code === "OCR_PIXEL_BOMB" ||
            code === "OCR_LOW_RESOLUTION" ||
            code === OCR_STATUS.OCR_INVALID_DOCUMENT ||
            code === "OCR_INVALID_DOCUMENT"
          ) {
            return failResult(
              code === "OCR_TOO_LARGE"
                ? "PDF_TOO_LARGE"
                : code === "OCR_TOO_MANY_PAGES"
                  ? "PDF_TOO_MANY_PAGES"
                  : code === "OCR_PIXEL_BOMB"
                    ? "OCR_PIXEL_BOMB"
                    : code === "OCR_LOW_RESOLUTION"
                      ? "OCR_LOW_RESOLUTION"
                      : OCR_STATUS.OCR_INVALID_DOCUMENT,
              error?.message || OCR_SAFE_MESSAGES.OCR_INVALID_DOCUMENT
            );
          }
          if (code === OCR_STATUS.OCR_PROVIDER_TIMEOUT || code === "OCR_PROVIDER_TIMEOUT") {
            return failResult(
              OCR_STATUS.OCR_PROVIDER_TIMEOUT,
              OCR_SAFE_MESSAGES.OCR_PROVIDER_TIMEOUT
            );
          }
          safeOcrLog("rasterize_failed", {
            code: OCR_STATUS.OCR_INVALID_DOCUMENT,
            stage: "rasterize",
          });
          return failResult(
            OCR_STATUS.OCR_INVALID_DOCUMENT,
            OCR_SAFE_MESSAGES.OCR_INVALID_DOCUMENT
          );
        }

        if (!rasterPages?.length) {
          return failResult(
            OCR_STATUS.OCR_INVALID_DOCUMENT,
            OCR_SAFE_MESSAGES.OCR_INVALID_DOCUMENT
          );
        }

        const accessToken = tokenFn
          ? await tokenFn(credentials)
          : await fetchAccessToken(credentials, fetchImpl);

        const allPages = [];
        const total = rasterPages.length;
        let batchProviderError = null;

        for (let start = 0; start < total; start += IMAGES_PER_REQUEST) {
          if (signal?.aborted) {
            const err = new Error(OCR_SAFE_MESSAGES.OCR_CANCELLED);
            err.code = "OCR_CANCELLED";
            throw err;
          }
          const chunk = rasterPages.slice(start, start + IMAGES_PER_REQUEST);
          const pageNo = start + 1;
          onProgress?.({
            status: OCR_STATUS.READING_PAGE,
            detail: `Sayfa ${pageNo}–${start + chunk.length}/${total} okunuyor`,
            percent: Math.round(20 + (start / total) * 70),
            page: pageNo,
            pageCount: total,
          });

          const json = await annotateImageBatch({
            accessToken,
            images: chunk,
            fetchImpl,
            signal,
          });
          const extracted = extractPagesFromImagesResponse(json, pageNo);
          if (extracted.providerError) batchProviderError = extracted.providerError;
          allPages.push(...extracted.pages);
        }

        onProgress?.({
          status: OCR_STATUS.VALIDATING,
          detail: "Hareketler doğrulanıyor",
          percent: 92,
          page: total,
          pageCount: total,
        });

        if (!allPages.length || allPages.every((p) => !p.text)) {
          if (batchProviderError) {
            return failResult(
              batchProviderError,
              OCR_SAFE_MESSAGES[batchProviderError] || OCR_SAFE_MESSAGES.OCR_FAILED
            );
          }
          return failResult(
            OCR_STATUS.OCR_PROVIDER_FAILED,
            OCR_SAFE_MESSAGES.OCR_PROVIDER_FAILED
          );
        }

        return {
          ok: true,
          code: "OK",
          status: OCR_STATUS.COMPLETED,
          message: "",
          pages: allPages,
          configured: true,
          provider: OCR_PROVIDER_GOOGLE_VISION,
        };
      } catch (error) {
        if (error?.code === "OCR_CANCELLED" || signal?.aborted) {
          const err = new Error(OCR_SAFE_MESSAGES.OCR_CANCELLED);
          err.code = "OCR_CANCELLED";
          throw err;
        }
        const code = String(error?.code || "");
        if (
          code === OCR_STATUS.OCR_AUTH_FAILED ||
          code === OCR_STATUS.OCR_PERMISSION_DENIED ||
          code === OCR_STATUS.OCR_INVALID_DOCUMENT ||
          code === OCR_STATUS.OCR_PROVIDER_TIMEOUT ||
          code === OCR_STATUS.OCR_RATE_LIMITED ||
          code === OCR_STATUS.OCR_PROVIDER_FAILED
        ) {
          return failResult(code, OCR_SAFE_MESSAGES[code]);
        }
        safeOcrLog("recognize_failed", {
          code: OCR_STATUS.OCR_PROVIDER_FAILED,
          stage: "recognize",
          httpStatus: error?.httpStatus,
        });
        return failResult(
          OCR_STATUS.OCR_PROVIDER_FAILED,
          OCR_SAFE_MESSAGES.OCR_PROVIDER_FAILED
        );
      }
    },
  };
}

/** Test / mock yardımcı — Vision images:annotate yanıt şekli */
export function buildMockVisionImagesAnnotateResponse(pages = []) {
  return {
    responses: pages.map((p) => ({
      fullTextAnnotation: {
        text: p.text || "",
        pages: [
          {
            width: p.width || 1240,
            height: p.height || 1754,
            confidence: p.confidence ?? 0.9,
            blocks: [{ confidence: p.confidence ?? 0.9 }],
          },
        ],
      },
    })),
  };
}

/** @deprecated alias — eski files:annotate mock adı */
export function buildMockVisionFilesAnnotateResponse(pages = []) {
  return buildMockVisionImagesAnnotateResponse(pages);
}
