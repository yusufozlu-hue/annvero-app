/**
 * Banka ekstresi başlık imzası — seçili banka ile dosya formatı uyumu.
 * Parser / worker / ana thread aynı kuralları kullanır.
 */

export const BANK_FORMAT_MISMATCH_MESSAGE =
  "Seçilen banka ile yüklenen ekstre formatı uyuşmuyor.";

export const BANK_FORMAT_MISMATCH_HINT =
  "Dosyayı yeniden seçin; sistem bankayı otomatik ayarlamayı dener. Gerekirse bankayı düzeltip tekrar deneyin.";

const KNOWN_BANK_FORMATS = new Set(["GARANTI", "VAKIFBANK"]);

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

/** Vakıfbank native ekstre başlığı (HESAP/HAREKET, İŞLEM TARİHİ, B/A, …) */
export function isVakifbankStatementHeaderText(text) {
  const t = normalizeStatementHeaderText(text);
  if (!t) return false;

  if (t.includes("islem tarihi")) return true;
  if (t.includes("hareket tarih")) return true;
  if (t.includes("b/a")) return true;
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

  return false;
}

/**
 * Garanti BBVA hesap hareketleri başlığı:
 * Tarih | Açıklama | Etiket | Tutar | Bakiye | Dekont No
 */
export function isGarantiStatementHeaderText(text) {
  const t = normalizeStatementHeaderText(text);
  if (!t || isVakifbankStatementHeaderText(t)) return false;

  // "islem tarihi" contains "tarih" — Vakıf imzası yukarıda elendi.
  const hasTarih = t.includes("tarih");
  const hasAciklama =
    t.includes("aciklama") || t.includes("islem aciklamasi");
  const hasAmount =
    t.includes("tutar") ||
    t.includes("bakiye") ||
    t.includes("borc") ||
    t.includes("alacak");
  // Gerçek Garanti export: Etiket ve/veya Dekont No
  const hasGarantiMarker = t.includes("dekont") || t.includes("etiket");

  return Boolean(hasTarih && hasAciklama && hasAmount && hasGarantiMarker);
}

export function detectKnownBankFormat(sheetRows, scanLimit = 40) {
  if (!Array.isArray(sheetRows) || sheetRows.length === 0) return "UNKNOWN";

  const limit = Math.min(sheetRows.length, Math.max(1, scanLimit));
  for (let i = 0; i < limit; i += 1) {
    const text = joinRowHeaderText(sheetRows[i]);
    if (!text) continue;
    if (isVakifbankStatementHeaderText(text)) return "VAKIFBANK";
    if (isGarantiStatementHeaderText(text)) return "GARANTI";
  }

  return "UNKNOWN";
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
 * Bilinen format (Garanti/Vakıfbank) seçili bankadan farklıysa parse'ı engeller.
 * UNKNOWN için banka parser'ı kendi başlık aramasına bırakılır.
 */
export function assertSelectedBankMatchesSheet(sheetRows, selectedBank) {
  const bank = String(selectedBank || "")
    .trim()
    .toUpperCase();
  if (!bank) return "UNKNOWN";

  const detected = detectKnownBankFormat(sheetRows);
  if (detected === "UNKNOWN") return detected;

  if (KNOWN_BANK_FORMATS.has(detected) && detected !== bank) {
    throw createBankFormatMismatchError(bank, detected);
  }

  return detected;
}

/**
 * Dosya başlığından parser banka kimliği çözümü.
 * high → bankId güvenle set edilebilir; unknown → kullanıcı seçmeli.
 */
export function resolveParserBankFromSheet(sheetRows, scanLimit = 40) {
  const detected = detectKnownBankFormat(sheetRows, scanLimit);
  if (detected === "VAKIFBANK" || detected === "GARANTI") {
    return {
      status: "detected",
      confidence: "high",
      bankId: detected,
      detected,
    };
  }
  return {
    status: "unknown",
    confidence: "unknown",
    bankId: null,
    detected: "UNKNOWN",
  };
}
