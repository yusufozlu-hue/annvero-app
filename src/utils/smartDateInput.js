/**
 * Akıllı TR tarih girişi yardımcıları.
 * Görüntü: gg.aa.yyyy | Değer (API/filtre): yyyy-mm-dd
 */

export function parseSmartDate(value, referenceYear = new Date().getFullYear()) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;

  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const date = new Date(`${trimmed.slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Slash → nokta
  const normalized = trimmed.replace(/\//g, ".");

  // gg.aa.yyyy
  const full = normalized.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (full) {
    const day = Number(full[1]);
    const month = Number(full[2]);
    let year = Number(full[3]);
    if (year < 100) year += 2000;
    const date = new Date(year, month - 1, day);
    if (
      Number.isNaN(date.getTime()) ||
      date.getDate() !== day ||
      date.getMonth() !== month - 1
    ) {
      return null;
    }
    return date;
  }

  // gg.aa (yıl yok)
  const short = normalized.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (short) {
    const day = Number(short[1]);
    const month = Number(short[2]);
    const date = new Date(referenceYear, month - 1, day);
    if (
      Number.isNaN(date.getTime()) ||
      date.getDate() !== day ||
      date.getMonth() !== month - 1
    ) {
      return null;
    }
    return date;
  }

  const digits = normalized.replace(/\D/g, "");

  if (digits.length === 4) {
    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const date = new Date(referenceYear, month - 1, day);
    if (
      Number.isNaN(date.getTime()) ||
      date.getDate() !== day ||
      date.getMonth() !== month - 1
    ) {
      return null;
    }
    return date;
  }

  if (digits.length === 6) {
    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const year = 2000 + Number(digits.slice(4, 6));
    const date = new Date(year, month - 1, day);
    if (
      Number.isNaN(date.getTime()) ||
      date.getDate() !== day ||
      date.getMonth() !== month - 1
    ) {
      return null;
    }
    return date;
  }

  if (digits.length === 8) {
    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const year = Number(digits.slice(4, 8));
    const date = new Date(year, month - 1, day);
    if (
      Number.isNaN(date.getTime()) ||
      date.getDate() !== day ||
      date.getMonth() !== month - 1
    ) {
      return null;
    }
    return date;
  }

  return null;
}

export function formatDateDisplayTR(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

export function formatDateIso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${year}-${month}-${day}`;
}

/** Kullanıcı girdisini tamamla → gg.aa.yyyy (geçersizse "") */
export function completeSmartDateDisplay(
  value,
  referenceYear = new Date().getFullYear()
) {
  const date = parseSmartDate(value, referenceYear);
  return date ? formatDateDisplayTR(date) : "";
}

/** Kullanıcı girdisini tamamla → yyyy-mm-dd (geçersizse "") */
export function completeSmartDateIso(
  value,
  referenceYear = new Date().getFullYear()
) {
  const date = parseSmartDate(value, referenceYear);
  return date ? formatDateIso(date) : "";
}

/** ISO veya TR değeri görüntü metnine çevir */
export function isoOrTrToDisplay(value) {
  if (!value) return "";
  const date = parseSmartDate(value);
  return date ? formatDateDisplayTR(date) : String(value);
}
