/**
 * Bordro mevzuat parametreleri — yıllara göre yapılandırılmış.
 * Admin panelinden güncellenebilir yapı için tek kaynak.
 */

export const PAYROLL_CONFIG_VERSION = "2026.2";

export const DEFAULT_PAYROLL_YEAR = 2026;

export const MONTHS_TR = [
  { value: 1, label: "Ocak" },
  { value: 2, label: "Şubat" },
  { value: 3, label: "Mart" },
  { value: 4, label: "Nisan" },
  { value: 5, label: "Mayıs" },
  { value: 6, label: "Haziran" },
  { value: 7, label: "Temmuz" },
  { value: 8, label: "Ağustos" },
  { value: 9, label: "Eylül" },
  { value: 10, label: "Ekim" },
  { value: 11, label: "Kasım" },
  { value: 12, label: "Aralık" },
];

/** @type {Record<number, object>} */
export const PAYROLL_YEARS = {
  2026: {
    year: 2026,
    label: "2026",
    effectiveFrom: "2026-01-01",
    isActive: true,
    minWage: {
      gross: 33030.0,
      net: 28075.5,
      incomeTaxBase: 24144.93,
    },
    sgk: {
      baseDays: 30,
      ceilingMultiplier: 7.5,
      employeeRate: 0.14,
      employerRate: 0.2175,
      employerRateDiscount2: 0.1975,
      employerRateDiscount5: 0.1675,
      unemploymentEmployeeRate: 0.01,
      unemploymentEmployerRate: 0.02,
    },
    sgdp: {
      employeeRate: 0.075,
      employerRate: 0.2475,
      unemploymentEmployeeRate: 0,
      unemploymentEmployerRate: 0,
    },
    stampTaxRate: 0.00759,
    incomeTaxBrackets: [
      { upTo: 190000, rate: 0.15 },
      { upTo: 400000, rate: 0.2 },
      { upTo: 1000000, rate: 0.27 },
      { upTo: 5300000, rate: 0.35 },
      { upTo: Infinity, rate: 0.4 },
    ],
    exemptions: {
      monthlyIncomeTax: 4211.33,
      monthlyStampTax: 213.09,
    },
  },
};

export const EMPLOYEE_STATUS = {
  NORMAL: "normal",
  RETIRED: "retired",
};

export const SGK_DISCOUNT = {
  NONE: "none",
  DISCOUNT_2: "discount2",
  DISCOUNT_5: "discount5",
};

export const WAGE_TYPE = {
  GROSS: "gross",
  NET: "net",
};

export const ANNUAL_LEAVE_DAYS = [14, 20, 26];

export function getPayrollParameters(year = DEFAULT_PAYROLL_YEAR) {
  return PAYROLL_YEARS[year] || PAYROLL_YEARS[DEFAULT_PAYROLL_YEAR];
}

export function getAvailablePayrollYears() {
  return Object.values(PAYROLL_YEARS)
    .filter((config) => config.isActive !== false)
    .map((config) => config.year)
    .sort((a, b) => b - a);
}
