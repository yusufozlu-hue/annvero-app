/**
 * SheetJS güvenli read/write sarmalayıcı.
 * Formüller JS olarak değerlendirilmez; HTML üretimi kapalı.
 * Export'ta kullanıcı kontrollü =+@- hücreleri için formula injection koruması.
 */

import * as XLSX from "xlsx";
import { sanitizeSpreadsheetCell } from "@/src/lib/security/redact";

export const SHEETJS_PACKAGE_VERSION = "0.20.3";

/** Güvenli okuma varsayılanları — muhasebe motoruna dokunmaz */
export const SAFE_XLSX_READ_DEFAULTS = Object.freeze({
  cellHTML: false,
  cellStyles: false,
  cellNF: false,
  // Formül metni okunabilir; JS yürütülmez. Değer hücresi tercih edilir.
  cellFormula: true,
});

export function assertSheetJsVersion(expected = SHEETJS_PACKAGE_VERSION) {
  const actual = String(XLSX.version || "");
  if (actual !== expected) {
    throw new Error(
      `xlsx sürüm uyuşmazlığı: beklenen ${expected}, bulunan ${actual || "(yok)"}`
    );
  }
  return actual;
}

export function getSheetJsVersion() {
  return String(XLSX.version || "");
}

/**
 * Workbook okuma — güvenli varsayılanlar + çağıran override.
 */
export function safeRead(data, options = {}) {
  const { readOptions = {}, ...rest } = options;
  return XLSX.read(data, {
    ...SAFE_XLSX_READ_DEFAULTS,
    ...rest,
    ...readOptions,
  });
}

/**
 * AOA / JSON satırlarındaki string hücrelere formula-injection koruması.
 * Sayısal / tarih değerlerine dokunmaz.
 */
export function sanitizeExportValue(value) {
  if (value == null) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  return sanitizeSpreadsheetCell(value);
}

export function sanitizeExportRowObject(row = {}) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = sanitizeExportValue(value);
  }
  return out;
}

export function sanitizeExportAoa(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (!Array.isArray(row)) return row;
    return row.map((cell) => sanitizeExportValue(cell));
  });
}

export function sanitizeExportJsonRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => sanitizeExportRowObject(row));
}

export {
  XLSX,
};
