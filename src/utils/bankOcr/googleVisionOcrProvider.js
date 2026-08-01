/**
 * Google Cloud Vision — DOCUMENT_TEXT_DETECTION (PDF files:annotate).
 * Server-only. Credential / ham PDF / OCR metni loglanmaz.
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

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const VISION_FILES_URL = "https://vision.googleapis.com/v1/files:annotate";
const VISION_SCOPE = "https://www.googleapis.com/auth/cloud-vision";
/** Vision sync PDF: en fazla 5 sayfa / istek */
const PAGES_PER_REQUEST = 5;

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
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
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwtRs256(
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
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const err = new Error("OCR_AUTH_FAILED");
    err.code = OCR_STATUS.OCR_FAILED;
    throw err;
  }
  const json = await res.json();
  const token = String(json?.access_token || "").trim();
  if (!token) {
    const err = new Error("OCR_AUTH_FAILED");
    err.code = OCR_STATUS.OCR_FAILED;
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

function extractPagesFromVisionResponse(visionJson, pageOffset = 0) {
  const fileResponses = visionJson?.responses || [];
  const out = [];
  for (const fileRes of fileResponses) {
    const pageResponses = fileRes?.responses || [];
    for (let i = 0; i < pageResponses.length; i += 1) {
      const pr = pageResponses[i];
      if (pr?.error) continue;
      const full = pr?.fullTextAnnotation;
      const text = String(full?.text || "").trim();
      const pageMeta = (full?.pages || [])[0];
      const pageNo = pageOffset + i + 1;
      out.push({
        page: pageNo,
        text,
        confidence: pageConfidence(pageMeta),
        width: Number(pageMeta?.width) || 0,
        height: Number(pageMeta?.height) || 0,
        dpi: 0,
      });
    }
  }
  return out;
}

async function annotatePdfChunk({
  accessToken,
  pdfBase64,
  pages,
  fetchImpl,
  signal,
}) {
  const res = await fetchImpl(VISION_FILES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          inputConfig: {
            content: pdfBase64,
            mimeType: "application/pdf",
          },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          pages,
        },
      ],
    }),
    signal,
  });
  if (!res.ok) {
    const err = new Error("OCR_VISION_FAILED");
    err.code = OCR_STATUS.OCR_FAILED;
    throw err;
  }
  return res.json();
}

/**
 * @param {object} [options]
 * @param {object} [options.env]
 * @param {typeof fetch} [options.fetchImpl] — unit test mock
 * @param {(creds:object)=>Promise<string>} [options.tokenFn] — unit test mock
 */
export function createGoogleVisionOcrProvider(options = {}) {
  const env = options.env;
  const credentials = resolveGoogleVisionCredentials(env);
  const fetchImpl = options.fetchImpl || fetch;
  const tokenFn = options.tokenFn;

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
        return {
          ok: false,
          code: OCR_STATUS.OCR_FAILED,
          message: OCR_SAFE_MESSAGES.OCR_CORRUPT,
          pages: [],
          configured: true,
        };
      }

      const pages = Math.max(
        1,
        Math.min(Number(pageCount) || 1, OCR_POLICY.MAX_PAGES)
      );
      onProgress?.({
        status: OCR_STATUS.PREPARING,
        detail: "OCR hazırlanıyor",
        percent: 4,
        page: 0,
        pageCount: pages,
      });

      try {
        const accessToken = tokenFn
          ? await tokenFn(credentials)
          : await fetchAccessToken(credentials, fetchImpl);
        const pdfBase64 = Buffer.from(buf).toString("base64");
        const allPages = [];

        for (let start = 1; start <= pages; start += PAGES_PER_REQUEST) {
          if (signal?.aborted) {
            const err = new Error(OCR_SAFE_MESSAGES.OCR_CANCELLED);
            err.code = "OCR_CANCELLED";
            throw err;
          }
          const end = Math.min(start + PAGES_PER_REQUEST - 1, pages);
          const pageList = [];
          for (let p = start; p <= end; p += 1) pageList.push(p);

          onProgress?.({
            status: OCR_STATUS.READING_PAGE,
            detail: `Sayfa ${start}–${end}/${pages} okunuyor`,
            percent: Math.round((start / pages) * 85),
            page: start,
            pageCount: pages,
          });

          const json = await annotatePdfChunk({
            accessToken,
            pdfBase64,
            pages: pageList,
            fetchImpl,
            signal,
          });
          const chunkPages = extractPagesFromVisionResponse(json, start - 1);
          allPages.push(...chunkPages);
        }

        onProgress?.({
          status: OCR_STATUS.VALIDATING,
          detail: "Hareketler doğrulanıyor",
          percent: 92,
          page: pages,
          pageCount: pages,
        });

        if (!allPages.length || allPages.every((p) => !p.text)) {
          return {
            ok: false,
            code: OCR_STATUS.OCR_FAILED,
            message: OCR_SAFE_MESSAGES.OCR_FAILED,
            pages: [],
            configured: true,
            provider: OCR_PROVIDER_GOOGLE_VISION,
          };
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
        return {
          ok: false,
          code: OCR_STATUS.OCR_FAILED,
          message: OCR_SAFE_MESSAGES.OCR_FAILED,
          pages: [],
          configured: true,
          provider: OCR_PROVIDER_GOOGLE_VISION,
        };
      }
    },
  };
}

/** Test / mock yardımcı — Vision files:annotate yanıt şekli */
export function buildMockVisionFilesAnnotateResponse(pages = []) {
  return {
    responses: [
      {
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
      },
    ],
  };
}
