/**
 * Dosya adına göre deterministik Drive klasör yolu seçimi.
 * Tahakkuk ≠ ödeme. MTV/Emlak tahakkuk klasörü yok — ödemeler `11 - Ödeme Belgeleri`.
 * `_ANNVERO` asla hedef olamaz.
 */

import { DRIVE_UPLOAD_DEFAULT_FOLDER } from "./uploadPolicy.js";
import { ANNVERO_SYSTEM_FOLDER } from "./folderSchema.js";

const BEYANNAME_ROOT = "02 - Beyannameler";
const TAHAKKUK_ROOT = "03 - Tahakkuk Fişleri";
const PAYMENT_ROOT = "11 - Ödeme Belgeleri";

const BEYANNAME_KEYWORDS = Object.freeze([
  ["muhsgk", "MUHSGK"],
  ["sgk", "MUHSGK"],
  ["kdv1", "KDV1"],
  ["kdv-1", "KDV1"],
  ["kdv 1", "KDV1"],
  ["kdv2", "KDV2"],
  ["kdv-2", "KDV2"],
  ["gecici", "Geçici Vergi"],
  ["geçici", "Geçici Vergi"],
  ["kurumlar", "Kurumlar Vergisi"],
  ["damga", "Damga Vergisi"],
  ["konaklama", "Konaklama Vergisi"],
  ["turizm", "Turizm Payı"],
]);

const TAHAKKUK_KEYWORDS = Object.freeze([
  ["tahakkuk", null],
  ["odeme emri", null],
  ["ödeme emri", null],
]);

const PAYMENT_HINTS = Object.freeze([
  "odeme",
  "ödeme",
  "dekont",
  "makbuz",
  "havale",
  "eft",
]);

function normalize(text = "") {
  return String(text || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKC");
}

function matchSubfolder(haystack, pairs) {
  for (const [needle, sub] of pairs) {
    if (haystack.includes(needle)) return sub;
  }
  return null;
}

function hasPaymentHint(name) {
  return PAYMENT_HINTS.some((h) => name.includes(h));
}

function classifyPaymentSubfolder(name) {
  if (name.includes("mtv") || name.includes("motorlu taşıt")) {
    return "MTV Ödemeleri";
  }
  if (
    name.includes("emlak") ||
    name.includes("emlak vergisi") ||
    name.includes("emlak vergi")
  ) {
    return "Emlak Vergisi Ödemeleri";
  }
  if (
    name.includes("ito") ||
    name.includes("i̇to") ||
    name.includes("aidat") ||
    name.includes("ticaret odası")
  ) {
    return "İTO Aidat Ödemeleri";
  }
  if (name.includes("sgk") || name.includes("sgdp")) {
    return "SGK Ödemeleri";
  }
  return "Vergi Ödemeleri";
}

/**
 * @returns {{
 *   targetFolderPath: string,
 *   documentType: string,
 *   confidence: "high" | "medium" | "low",
 *   needsReview: boolean,
 *   reason: string,
 * }}
 */
export function classifyUploadTarget({ fileName = "", mimeType = "" } = {}) {
  const name = normalize(fileName);
  const mime = String(mimeType || "").toLowerCase();

  const denySystem = (path) => {
    const p = String(path || "");
    if (
      p === ANNVERO_SYSTEM_FOLDER ||
      p.startsWith(`${ANNVERO_SYSTEM_FOLDER}/`)
    ) {
      return DRIVE_UPLOAD_DEFAULT_FOLDER;
    }
    return p;
  };

  // Ödeme belgeleri (tahakkuk değil) — önce ödeme ipucu
  const isTahakkukWord = name.includes("tahakkuk") || TAHAKKUK_KEYWORDS.some(
    ([needle]) => name.includes(needle)
  );
  if (hasPaymentHint(name) && !isTahakkukWord) {
    const sub = classifyPaymentSubfolder(name);
    return {
      targetFolderPath: denySystem(`${PAYMENT_ROOT}/${sub}`),
      documentType: "odeme",
      confidence: "medium",
      needsReview: false,
      reason: "filename_odeme",
    };
  }

  if (
    name.includes("personel") ||
    name.includes("bordro") ||
    name.includes("ise giris") ||
    name.includes("işe giriş") ||
    name.includes("sgk hizmet")
  ) {
    return {
      targetFolderPath: denySystem("05 - Personel"),
      documentType: "personel",
      confidence: "medium",
      needsReview: false,
      reason: "filename_personel",
    };
  }

  if (name.includes("police") || name.includes("poliçe") || name.includes("sigorta")) {
    return {
      targetFolderPath: denySystem("08 - Poliçeler"),
      documentType: "police",
      confidence: "medium",
      needsReview: false,
      reason: "filename_police",
    };
  }

  if (
    name.includes("ticaret sicil") ||
    name.includes("mersis") ||
    name.includes("ticari sicil")
  ) {
    return {
      targetFolderPath: denySystem("04 - Ticaret Sicil"),
      documentType: "ticaret_sicil",
      confidence: "medium",
      needsReview: false,
      reason: "filename_ticaret_sicil",
    };
  }

  if (name.includes("sozlesme") || name.includes("sözleşme") || name.includes("kontrat")) {
    return {
      targetFolderPath: denySystem("07 - Sözleşmeler"),
      documentType: "sozlesme",
      confidence: "medium",
      needsReview: false,
      reason: "filename_sozlesme",
    };
  }

  if (name.includes("ruhsat")) {
    return {
      targetFolderPath: denySystem("09 - Ruhsatlar"),
      documentType: "ruhsat",
      confidence: "medium",
      needsReview: false,
      reason: "filename_ruhsat",
    };
  }

  if (name.includes("tapu")) {
    return {
      targetFolderPath: denySystem("10 - Tapular"),
      documentType: "tapu",
      confidence: "medium",
      needsReview: false,
      reason: "filename_tapu",
    };
  }

  if (isTahakkukWord || name.includes("tahakkuk")) {
    const sub = matchSubfolder(name, BEYANNAME_KEYWORDS) || "Düzeltmeler";
    return {
      targetFolderPath: denySystem(`${TAHAKKUK_ROOT}/${sub}`),
      documentType: "tahakkuk",
      confidence: "medium",
      needsReview: false,
      reason: "filename_tahakkuk",
    };
  }

  if (
    name.includes("beyanname") ||
    name.includes("kdv") ||
    name.includes("muhsgk") ||
    name.includes("kurumlar") ||
    name.includes("gecici vergi") ||
    name.includes("geçici vergi")
  ) {
    const sub = matchSubfolder(name, BEYANNAME_KEYWORDS) || "Düzeltmeler";
    return {
      targetFolderPath: denySystem(`${BEYANNAME_ROOT}/${sub}`),
      documentType: "beyanname",
      confidence: "medium",
      needsReview: false,
      reason: "filename_beyanname",
    };
  }

  if (mime.startsWith("image/") || /\.(png|jpe?g)$/i.test(fileName)) {
    return {
      targetFolderPath: denySystem(DRIVE_UPLOAD_DEFAULT_FOLDER),
      documentType: "image",
      confidence: "low",
      needsReview: true,
      reason: "image_ocr_unavailable",
    };
  }

  return {
    targetFolderPath: denySystem(DRIVE_UPLOAD_DEFAULT_FOLDER),
    documentType: "diger",
    confidence: "low",
    needsReview: true,
    reason: "unclassified_filename",
  };
}
