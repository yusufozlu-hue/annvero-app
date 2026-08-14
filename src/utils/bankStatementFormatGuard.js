/**
 * Banka ekstresi başlık imzası — seçili banka ile dosya formatı uyumu.
 * Parser / worker / ana thread aynı kuralları kullanır.
 *
 * Excel auto-detect puanlaması: bankExcelAutoDetect.js
 * Kanonik kimlik: bankIdentity.js
 */

import { bankIdsEqual, toParserBankId } from "@/src/utils/bankIdentity";
import {
  detectExcelBank,
  detectKnownBankFormatScored,
} from "@/src/utils/bankExcelAutoDetect";

export const BANK_FORMAT_MISMATCH_MESSAGE =
  "Seçilen banka ile yüklenen ekstre formatı uyuşmuyor.";

export const BANK_FORMAT_MISMATCH_HINT =
  "Dosyayı yeniden seçin; sistem bankayı otomatik ayarlamayı dener.";

export const BANK_DETECT_UNKNOWN_MESSAGE =
  "Banka ekstresi otomatik tanınamadı. Desteklenen Excel formatını yükleyin (TEB, Ziraat, Kuveyt Türk, Vakıfbank, Garanti).";

export const BANK_DETECT_AMBIGUOUS_MESSAGE =
  "Birden fazla banka formatı olası görünüyor. Net bir banka ekstresi yükleyin; yanlış banka seçilmedi.";

/** Bilinen Excel formatları (kanonik → parser id ile karşılaştırılır) */
const KNOWN_BANK_FORMATS = new Set([
  "GARANTI",
  "VAKIFBANK",
  "TEB",
  "ZIRAAT",
  "KUVEYT",
  "KUVEYTTURK",
]);

export function normalizeStatementHeaderText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

export function joinRowHeaderText(row) {
  if (!Array.isArray(row)) return "";
  return row.map((cell) => normalizeStatementHeaderText(cell)).join(" ");
}

/**
 * Vakıfbank native ekstre — sıkı fingerprint (yalnız "islem tarihi" yetmez).
 * Geriye uyumluluk için export edilir; asıl skor bankExcelAutoDetect’tedir.
 */
export function isVakifbankStatementHeaderText(text) {
  const t = normalizeStatementHeaderText(text);
  if (!t) return false;

  if (t.includes("b/a") && (t.includes("tutar") || t.includes("fis no"))) {
    return true;
  }
  if (t.includes("hesap hareket")) return true;
  if (t.includes("hesap") && t.includes("hareket") && t.includes("tutar")) {
    return true;
  }
  if (t.includes("fis no") && t.includes("hareket") && t.includes("tutar")) {
    return true;
  }
  if (
    t.includes("hesap no") &&
    t.includes("fis no") &&
    (t.includes("islem") || t.includes("aciklama")) &&
    t.includes("tutar")
  ) {
    return true;
  }
  if (t.includes("hareket tarih") && t.includes("tutar")) return true;
  if (t.includes("islem tarihi") && t.includes("b/a")) return true;

  return false;
}

/**
 * Garanti BBVA hesap hareketleri başlığı:
 * Tarih | Açıklama | Etiket | Tutar | Bakiye | Dekont No
 */
export function isGarantiStatementHeaderText(text) {
  const t = normalizeStatementHeaderText(text);
  if (!t || isVakifbankStatementHeaderText(t)) return false;

  const hasTarih = t.includes("tarih");
  const hasAciklama =
    t.includes("aciklama") || t.includes("islem aciklamasi");
  const hasAmount =
    t.includes("tutar") ||
    t.includes("bakiye") ||
    t.includes("borc") ||
    t.includes("alacak");
  const hasEtiket = t.includes("etiket");
  const hasDekont = t.includes("dekont");
  const hasBorcAlacakPair = t.includes("borc") && t.includes("alacak");
  // Etiket klasik Garanti; dekont yalnız tutar kolonlu export’ta (borç/alacak yok)
  const hasGarantiMarker = hasEtiket || (hasDekont && !hasBorcAlacakPair);

  return Boolean(hasTarih && hasAciklama && hasAmount && hasGarantiMarker);
}

/**
 * @param {unknown[][]} sheetRows
 * @param {number|{scanLimit?:number,fileName?:string,sheetName?:string}} [scanLimitOrOptions]
 */
export function detectKnownBankFormat(sheetRows, scanLimitOrOptions = 40) {
  const options =
    typeof scanLimitOrOptions === "number"
      ? { scanLimit: scanLimitOrOptions }
      : scanLimitOrOptions || {};
  return detectKnownBankFormatScored(sheetRows, options);
}

export function createBankFormatMismatchError(selectedBank, detectedBank) {
  const err = new Error(
    `${BANK_FORMAT_MISMATCH_MESSAGE} ${BANK_FORMAT_MISMATCH_HINT}`
  );
  err.code = "BANK_FORMAT_MISMATCH";
  err.selectedBank = selectedBank;
  err.detectedBank = detectedBank;
  return err;
}

/**
 * Bilinen format seçili bankadan farklıysa parse’ı engeller.
 * UNKNOWN / AMBIGUOUS → uyumsuzluk fırlatılmaz (üst katman UNKNOWN kartı gösterir).
 */
export function assertSelectedBankMatchesSheet(
  sheetRows,
  selectedBank,
  options = {}
) {
  const bank = String(selectedBank || "")
    .trim()
    .toUpperCase();
  if (!bank) return "UNKNOWN";

  const resolved = detectExcelBank(sheetRows, options);
  if (resolved.status !== "detected" || !resolved.bankId) {
    return resolved.detected || "UNKNOWN";
  }

  const detected = resolved.bankId;
  if (KNOWN_BANK_FORMATS.has(detected) || KNOWN_BANK_FORMATS.has(resolved.canonicalBankId)) {
    if (!bankIdsEqual(detected, bank)) {
      throw createBankFormatMismatchError(bank, detected);
    }
  }

  return detected;
}

/**
 * Dosya başlığından parser banka kimliği çözümü.
 * high/medium → bankId güvenle set; unknown/ambiguous → bankId null.
 */
export function resolveParserBankFromSheet(sheetRows, scanLimitOrOptions = 40) {
  const options =
    typeof scanLimitOrOptions === "number"
      ? { scanLimit: scanLimitOrOptions }
      : scanLimitOrOptions || {};
  const resolved = detectExcelBank(sheetRows, options);
  return {
    status: resolved.status,
    confidence: resolved.confidence,
    bankId: resolved.bankId,
    canonicalBankId: resolved.canonicalBankId || null,
    detected: resolved.detected,
    diagnostics: resolved.diagnostics,
  };
}

export { toParserBankId, bankIdsEqual };
