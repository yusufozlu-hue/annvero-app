/**
 * Düzeltme fişi tarih/dönem politikası — analiz dönemi ≠ kapalı e-Defter dönemi.
 * Kapalı dönem güvenilir değilse otomatik tarih üretilmez (fail-closed).
 * Tüm hesaplar saf YYYY/AA ve YYYY-MM-DD bileşenleriyle; UTC/local Date kayması yok.
 */
import { formatDateTR } from "@/src/utils/formatDateTR";
import { normalizePeriodKey } from "@/src/utils/eDefterSecurity";

export const CORRECTION_DATE_SOURCE = {
  AUTO_DEFAULT: "AUTO_DEFAULT",
  USER_SELECTED: "USER_SELECTED",
};

function parsePeriodParts(period = "") {
  const key = normalizePeriodKey(period);
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return null;
  const [yearText, monthText] = key.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  const table = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return table[month - 1] || 0;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isoDateOrdinal(isoDate = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return year * 10000 + month * 100 + day;
}

/** "YYYY/AA" veya "YYYY-MM" → canonical "YYYY/AA" */
export function formatLedgerPeriodKey(period = "") {
  const parts = parsePeriodParts(period);
  if (!parts) return "";
  return `${parts.year}/${pad2(parts.month)}`;
}

/** ISO date → "YYYY/AA" muhasebe dönemi (saf string ayrıştırma) */
export function ledgerPeriodFromIsoDate(isoDate = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || "").trim());
  if (!match) return "";
  return `${match[1]}/${match[2]}`;
}

/** Kapalı dönemin son günü — ISO YYYY-MM-DD */
export function closedPeriodLastDayIso(period = "") {
  const parts = parsePeriodParts(period);
  if (!parts) return "";
  const day = daysInMonth(parts.year, parts.month);
  return `${parts.year}-${pad2(parts.month)}-${pad2(day)}`;
}

/** @deprecated use closedPeriodLastDayIso — geriye dönük test uyumu */
export function ledgerPeriodEndDate(period = "") {
  const iso = closedPeriodLastDayIso(period);
  if (!iso) return null;
  const ord = isoDateOrdinal(iso);
  if (ord == null) return null;
  const year = Math.floor(ord / 10000);
  const month = Math.floor((ord % 10000) / 100);
  const day = ord % 100;
  return new Date(year, month - 1, day);
}

/** Kapalı dönemi takip eden ilk açık gün — ISO YYYY-MM-DD */
export function firstOpenDateAfterClosedPeriod(lastClosedLedgerPeriod = "") {
  const parts = parsePeriodParts(lastClosedLedgerPeriod);
  if (!parts) return "";
  let year = parts.year;
  let month = parts.month + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${pad2(month)}-01`;
}

/**
 * Firma profilinden veya kullanıcı onayından son kapalı e-Defter dönemi.
 * reliability: "COMPANY_PROFILE" | "USER_CONFIRMED" | null
 */
export function resolveLastClosedLedgerPeriod({
  companyAccountingRules = {},
  userSelectedPeriod = "",
} = {}) {
  const fromCompany = formatLedgerPeriodKey(
    companyAccountingRules.lastClosedEdefterPeriod || ""
  );
  if (fromCompany) {
    return {
      lastClosedLedgerPeriod: fromCompany,
      reliability: "COMPANY_PROFILE",
    };
  }

  const fromUser = formatLedgerPeriodKey(userSelectedPeriod);
  if (fromUser) {
    return {
      lastClosedLedgerPeriod: fromUser,
      reliability: "USER_CONFIRMED",
    };
  }

  return {
    lastClosedLedgerPeriod: "",
    reliability: null,
  };
}

/**
 * Düzeltme tarihi bağlamı — otomatik varsayılan veya kullanıcı seçimi.
 * Kapalı dönem bilinmiyorsa correctionDate boş kalır.
 */
export function resolveCorrectionDateContext({
  lastClosedLedgerPeriod = "",
  lastClosedReliability = null,
  userCorrectionDate = "",
  correctionDateSource = "",
} = {}) {
  const period = formatLedgerPeriodKey(lastClosedLedgerPeriod);
  const reliable = Boolean(period && lastClosedReliability);

  if (!reliable) {
    return {
      lastClosedLedgerPeriod: period,
      firstOpenDate: "",
      correctionDate: userCorrectionDate || "",
      correctionDateSource: userCorrectionDate
        ? CORRECTION_DATE_SOURCE.USER_SELECTED
        : "",
      requiresClosedPeriodInput: true,
    };
  }

  const firstOpenDate = firstOpenDateAfterClosedPeriod(period);
  let correctionDate = "";
  let source = "";

  if (userCorrectionDate) {
    correctionDate = userCorrectionDate;
    source =
      correctionDateSource === CORRECTION_DATE_SOURCE.AUTO_DEFAULT &&
      userCorrectionDate === firstOpenDate
        ? CORRECTION_DATE_SOURCE.AUTO_DEFAULT
        : CORRECTION_DATE_SOURCE.USER_SELECTED;
  } else if (firstOpenDate) {
    correctionDate = firstOpenDate;
    source = CORRECTION_DATE_SOURCE.AUTO_DEFAULT;
  }

  return {
    lastClosedLedgerPeriod: period,
    firstOpenDate,
    correctionDate,
    correctionDateSource: source,
    requiresClosedPeriodInput: false,
  };
}

/** correctionDate > lastClosedLedgerPeriod bitişi ve açık dönemde mi? */
export function validateCorrectionDate({
  correctionDate = "",
  lastClosedLedgerPeriod = "",
  lastClosedReliability = null,
} = {}) {
  const issues = [];

  if (!lastClosedLedgerPeriod || !lastClosedReliability) {
    issues.push({
      code: "CLOSED_PERIOD_UNKNOWN",
      message: "Son kapalı e-Defter dönemi belirlenemedi; düzeltme tarihi seçilemez.",
    });
    return { ok: false, issues };
  }

  if (!correctionDate) {
    issues.push({
      code: "CORRECTION_DATE_MISSING",
      message: "Düzeltme tarihi seçilmelidir.",
    });
    return { ok: false, issues };
  }

  const correctionOrdinal = isoDateOrdinal(correctionDate);
  const closedEndOrdinal = isoDateOrdinal(closedPeriodLastDayIso(lastClosedLedgerPeriod));

  if (correctionOrdinal == null) {
    issues.push({
      code: "CORRECTION_DATE_INVALID",
      message: "Geçersiz düzeltme tarihi.",
    });
    return { ok: false, issues };
  }

  if (closedEndOrdinal != null && correctionOrdinal <= closedEndOrdinal) {
    issues.push({
      code: "CORRECTION_DATE_IN_CLOSED_PERIOD",
      message: `Seçilen tarih kapalı dönem (${lastClosedLedgerPeriod}) içinde veya öncesinde; düzeltme yapılamaz.`,
    });
  }

  const correctionPeriod = ledgerPeriodFromIsoDate(correctionDate);
  const closedKey = normalizePeriodKey(lastClosedLedgerPeriod);
  const openKey = normalizePeriodKey(correctionPeriod.replace("/", "-"));

  if (closedKey && openKey && openKey <= closedKey) {
    issues.push({
      code: "CORRECTION_PERIOD_NOT_OPEN",
      message: "Düzeltme tarihi açık bir muhasebe döneminde olmalıdır.",
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    correctionPeriod,
    displayDate: formatDateTR(correctionDate),
  };
}
