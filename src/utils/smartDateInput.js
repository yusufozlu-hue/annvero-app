/**
 * Akıllı TR tarih girişi yardımcıları.
 * Görüntü: gg.aa.yyyy | Değer (API/filtre): yyyy-mm-dd
 * Timezone kayması yok — yerel takvim parçaları kullanılır.
 */

function isValidYmdParts(day, month, year) {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return false;
  }
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function toDateFromParts(day, month, year) {
  if (!isValidYmdParts(day, month, year)) return null;
  return new Date(year, month - 1, day);
}

export function parseSmartDate(value, referenceYear = new Date().getFullYear()) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;

  // ISO yyyy-mm-dd (önce kontrol — tire ayracı bozulmasın)
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const [y, m, d] = trimmed.slice(0, 10).split("-").map(Number);
    return toDateFromParts(d, m, y);
  }

  // Slash / tire → nokta (gg.aa veya gg.aa.yyyy)
  const normalized = trimmed.replace(/[/-]/g, ".");

  // gg.aa.yyyy veya gg.aa.yy
  const full = normalized.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (full) {
    const day = Number(full[1]);
    const month = Number(full[2]);
    let year = Number(full[3]);
    if (year < 100) year += 2000;
    return toDateFromParts(day, month, year);
  }

  // gg.aa (yıl yok) → içinde bulunulan yıl
  const short = normalized.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (short) {
    const day = Number(short[1]);
    const month = Number(short[2]);
    return toDateFromParts(day, month, referenceYear);
  }

  const digits = normalized.replace(/\D/g, "");

  if (digits.length === 4) {
    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    return toDateFromParts(day, month, referenceYear);
  }

  if (digits.length === 6) {
    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const year = 2000 + Number(digits.slice(4, 6));
    return toDateFromParts(day, month, year);
  }

  if (digits.length === 8) {
    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const year = Number(digits.slice(4, 8));
    return toDateFromParts(day, month, year);
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

/**
 * Tab / blur tamamlama sonucu.
 * @returns {{ ok: boolean, empty: boolean, display: string, iso: string, error: string }}
 */
export function resolveSmartDateInput(
  value,
  referenceYear = new Date().getFullYear()
) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return { ok: true, empty: true, display: "", iso: "", error: "" };
  }

  const date = parseSmartDate(trimmed, referenceYear);
  if (!date) {
    return {
      ok: false,
      empty: false,
      display: "",
      iso: "",
      error: "Geçersiz tarih. gg.aa.yyyy biçiminde girin.",
    };
  }

  return {
    ok: true,
    empty: false,
    display: formatDateDisplayTR(date),
    iso: formatDateIso(date),
    error: "",
  };
}

/** ISO veya TR değeri görüntü metnine çevir */
export function isoOrTrToDisplay(value) {
  if (!value) return "";
  const date = parseSmartDate(value);
  return date ? formatDateDisplayTR(date) : String(value);
}
