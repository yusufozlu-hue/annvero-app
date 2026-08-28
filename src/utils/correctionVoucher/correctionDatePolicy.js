/**
 * Düzeltme fişi tarih/dönem politikası — analiz dönemi ≠ kapalı e-Defter dönemi.
 * Kapalı dönem güvenilir değilse otomatik tarih üretilmez (fail-closed).
 */
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { normalizePeriodKey } from "@/src/utils/eDefterSecurity";

export const CORRECTION_DATE_SOURCE = {
  AUTO_DEFAULT: "AUTO_DEFAULT",
  USER_SELECTED: "USER_SELECTED",
};

/** "YYYY/AA" veya "YYYY-MM" → canonical "YYYY/AA" */
export function formatLedgerPeriodKey(period = "") {
  const key = normalizePeriodKey(period);
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return "";
  const [year, month] = key.split("-");
  return `${year}/${month}`;
}

/** ISO date → "YYYY/AA" muhasebe dönemi */
export function ledgerPeriodFromIsoDate(isoDate = "") {
  const date = parseDateTR(isoDate);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}/${month}`;
}

/** Son gün (Date) — dönem "YYYY/AA" veya "YYYY-MM" */
export function ledgerPeriodEndDate(period = "") {
  const key = normalizePeriodKey(period);
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return null;
  const [yearText, monthText] = key.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!year || !month) return null;
  return new Date(year, month, 0);
}

/** Kapalı dönemi takip eden ilk açık gün — ISO "YYYY-MM-DD" */
export function firstOpenDateAfterClosedPeriod(lastClosedLedgerPeriod = "") {
  const end = ledgerPeriodEndDate(lastClosedLedgerPeriod);
  if (!end) return "";
  const next = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, "0");
  const d = String(next.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoToComparable(isoDate = "") {
  const date = parseDateTR(isoDate);
  if (!date) return null;
  return date.getTime();
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

  const correctionTs = isoToComparable(correctionDate);
  const closedEnd = ledgerPeriodEndDate(lastClosedLedgerPeriod);
  const closedEndTs = closedEnd ? closedEnd.getTime() : null;

  if (correctionTs == null) {
    issues.push({
      code: "CORRECTION_DATE_INVALID",
      message: "Geçersiz düzeltme tarihi.",
    });
    return { ok: false, issues };
  }

  if (closedEndTs != null && correctionTs <= closedEndTs) {
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
