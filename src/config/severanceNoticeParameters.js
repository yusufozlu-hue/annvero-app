/**
 * Kıdem ve ihbar tazminatı mevzuat parametreleri.
 * Admin paneli / mevzuat seed verileri ile uyumlu; tek güncelleme kaynağı.
 */

import { PAYROLL_YEARS, DEFAULT_PAYROLL_YEAR } from "./payrollParameters";

export const SEVERANCE_NOTICE_CONFIG_VERSION = "2026.1";

export const DEFAULT_SEVERANCE_YEAR = DEFAULT_PAYROLL_YEAR;

/** @type {Record<number, object>} */
export const SEVERANCE_NOTICE_YEARS = {
  2026: {
    year: 2026,
    label: "2026",
    /** Aylık kıdem tazminatı tavanı (TL). null ise form alanından girilmelidir. */
    severancePayCeiling: null,
    /** Kıdem hesabında yıl gün sayısı */
    daysPerYear: 365,
    /** Kıdem için asgari hizmet (gün) */
    minServiceDaysForSeverance: 365,
    /** İhbar günlük ücret böleni (aylık / 30) */
    noticeDailyWageDivisor: 30,
    /** Damga vergisi oranı */
    stampTaxRate: 0.00759,
    noticePeriodWeeks: {
      /** 0 ≤ hizmet < 6 ay */
      under6Months: 2,
      /** 6 ≤ hizmet < 18 ay */
      from6To18Months: 4,
      /** 18 ≤ hizmet < 36 ay */
      from18To36Months: 6,
      /** 36 ay ve üzeri */
      from36Months: 8,
    },
    /** Gelir vergisi dilimleri — bordro parametreleri ile aynı */
    incomeTaxBrackets: PAYROLL_YEARS[2026].incomeTaxBrackets,
  },
};

export const CALCULATION_SCOPE = {
  BOTH: "both",
  SEVERANCE_ONLY: "severance_only",
  NOTICE_ONLY: "notice_only",
};

export const CALCULATION_SCOPE_OPTIONS = [
  { value: CALCULATION_SCOPE.BOTH, label: "Kıdem ve ihbar tazminatı" },
  { value: CALCULATION_SCOPE.SEVERANCE_ONLY, label: "Sadece kıdem tazminatı" },
  { value: CALCULATION_SCOPE.NOTICE_ONLY, label: "Sadece ihbar tazminatı" },
];

export function getSeveranceNoticeParameters(year = DEFAULT_SEVERANCE_YEAR) {
  const config = SEVERANCE_NOTICE_YEARS[year];
  if (!config) {
    throw new Error(`Kıdem/ihbar parametreleri bulunamadı: ${year}`);
  }
  return config;
}

export function getAvailableSeveranceYears() {
  return Object.values(SEVERANCE_NOTICE_YEARS)
    .filter((item) => item.isActive !== false)
    .map((item) => ({ value: item.year, label: item.label }));
}
