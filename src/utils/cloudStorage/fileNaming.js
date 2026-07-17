/**
 * Evrak dosya isimlendirme standardı (V1).
 *
 * Örnekler:
 * MUHSGK_Byn_202605.pdf
 * MUHSGK_Thk_202605.pdf
 * SGK_Thk_202605_5510.pdf
 * SGK_Thk_202605_SGDP.pdf
 * MUHSGK_Byn_202601_Duzeltme01.pdf
 */

import { DOCUMENT_KIND } from "./types.js";

const PERIOD_RE = /^\d{6}$/;
const KIND_RE = /^(Byn|Thk)$/;
const SAFE_CODE_RE = /^[A-Z0-9]+$/i;

function padRev(n) {
  const num = Math.max(1, Number(n) || 1);
  return String(num).padStart(2, "0");
}

/**
 * @param {object} opts
 * @param {string} opts.obligationCode — MUHSGK, KDV1, SGK…
 * @param {"Byn"|"Thk"} opts.kind
 * @param {string} opts.periodKey — YYYYMM
 * @param {number} [opts.revisionNo] — 0 = normal; 1+ = DuzeltmeNN
 * @param {string} [opts.sgkVariant] — 5510 | 6661 | 14857 | SGDP
 * @param {string} [opts.extension]
 */
export function buildStandardDocumentFileName({
  obligationCode,
  kind,
  periodKey,
  revisionNo = 0,
  sgkVariant = "",
  extension = "pdf",
} = {}) {
  const code = String(obligationCode || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const k = String(kind || "").trim();
  const period = String(periodKey || "").trim();
  const ext = String(extension || "pdf").replace(/^\./, "");

  if (!code || !SAFE_CODE_RE.test(code)) {
    throw new Error("Geçersiz yükümlülük kodu.");
  }
  if (!KIND_RE.test(k)) {
    throw new Error("Belge türü Byn veya Thk olmalı.");
  }
  if (!PERIOD_RE.test(period)) {
    throw new Error("Dönem YYYYMM olmalı.");
  }

  const parts = [code, k, period];
  const variant = String(sgkVariant || "").trim().toUpperCase();
  if (variant) {
    if (!SAFE_CODE_RE.test(variant)) {
      throw new Error("Geçersiz SGK varyantı.");
    }
    parts.push(variant);
  }

  const rev = Number(revisionNo) || 0;
  if (rev > 0) {
    parts.push(`Duzeltme${padRev(rev)}`);
  }

  return `${parts.join("_")}.${ext}`;
}

/**
 * Standart dosya adını parse eder; uymazsa null.
 */
export function parseStandardDocumentFileName(fileName) {
  const raw = String(fileName || "").trim();
  const match = raw.match(
    /^([A-Za-z0-9]+)_(Byn|Thk)_(\d{6})(?:_([A-Za-z0-9]+))?(?:_Duzeltme(\d{2}))?\.(pdf|PDF)$/
  );
  if (!match) return null;

  const [, obligationCode, kind, periodKey, maybeVariant, revStr] = match;
  let sgkVariant = "";
  let revisionNo = 0;
  if (revStr) {
    revisionNo = Number(revStr) || 0;
    sgkVariant = maybeVariant || "";
  } else if (maybeVariant) {
    sgkVariant = maybeVariant;
  }

  return {
    obligationCode: obligationCode.toUpperCase(),
    kind,
    periodKey,
    sgkVariant: sgkVariant.toUpperCase(),
    revisionNo,
    documentCategory: kind === DOCUMENT_KIND.BYN ? "beyanname" : "tahakkuk",
  };
}

export function isCorrectionFileName(fileName) {
  return /_Duzeltme\d{2}\./i.test(String(fileName || ""));
}
