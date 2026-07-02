import { PAYROLL_YEARS, DEFAULT_PAYROLL_YEAR } from "@/src/config/payrollParameters";
import {
  createSeedParameter,
  MEVZUAT_MODULE_KEYS,
} from "@/src/config/mevzuatParameterSeeds";

const ACTIVE_YEAR = DEFAULT_PAYROLL_YEAR;
const YEAR_END = `${ACTIVE_YEAR}-12-31`;

function addSeed(rows, row) {
  rows.push(
    createSeedParameter({
      year: ACTIVE_YEAR,
      valid_from: `${ACTIVE_YEAR}-01-01`,
      valid_to: YEAR_END,
      is_active: true,
      ...row,
    })
  );
}

function buildPayrollSeedRows() {
  const yearConfig = PAYROLL_YEARS[ACTIVE_YEAR];
  const rows = [];

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-min_wage.gross`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "min_wage.gross",
    parameter_name: "Brüt Asgari Ücret",
    value: "33030.00",
    period: "Aylık",
    description: "Aylık brüt asgari ücret",
  });

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-min_wage.net`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "min_wage.net",
    parameter_name: "Net Asgari Ücret",
    value: "28075.50",
    period: "Aylık",
    description: "Aylık net asgari ücret",
  });

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-sgk.employee_rate`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "sgk.employee_rate",
    parameter_name: "SGK İşçi Primi Oranı",
    value: String(yearConfig.sgk.employeeRate),
    description: "Normal çalışan SGK işçi payı",
  });

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-sgk.unemployment_employee_rate`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "sgk.unemployment_employee_rate",
    parameter_name: "İşsizlik İşçi Primi Oranı",
    value: String(yearConfig.sgk.unemploymentEmployeeRate),
    description: "İşsizlik sigortası işçi payı",
  });

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-sgk.employer_rate`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "sgk.employer_rate",
    parameter_name: "SGK İşveren Primi (Teşviksiz)",
    value: String(yearConfig.sgk.employerRate),
    description: "Teşviksiz SGK işveren payı",
  });

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-sgk.employer_rate_discount_2`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "sgk.employer_rate_discount_2",
    parameter_name: "SGK İşveren Primi (2 Puan İndirimli)",
    value: String(yearConfig.sgk.employerRateDiscount2),
    description: "2 puan SGK indirimi sonrası işveren payı",
  });

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-sgk.employer_rate_discount_5`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "sgk.employer_rate_discount_5",
    parameter_name: "SGK İşveren Primi (5 Puan İndirimli)",
    value: String(yearConfig.sgk.employerRateDiscount5),
    description: "5 puan SGK indirimi sonrası işveren payı",
  });

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-sgk.unemployment_employer_rate`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "sgk.unemployment_employer_rate",
    parameter_name: "İşsizlik İşveren Primi Oranı",
    value: String(yearConfig.sgk.unemploymentEmployerRate),
    description: "İşsizlik sigortası işveren payı",
  });

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-sgk.ceiling_multiplier`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "sgk.ceiling_multiplier",
    parameter_name: "SGK Tavan Çarpanı",
    value: String(yearConfig.sgk.ceilingMultiplier),
    description: "Asgari ücret ile SGK tavanı çarpanı",
  });

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-sgk.base_days`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "sgk.base_days",
    parameter_name: "SGK Prim Gün Sayısı",
    value: String(yearConfig.sgk.baseDays),
    period: "Aylık",
    description: "Aylık SGK prim gün sayısı tabanı",
  });

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-sgdp.employee_rate`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "sgdp.employee_rate",
    parameter_name: "SGDP İşçi Primi Oranı",
    value: String(yearConfig.sgdp.employeeRate),
    description: "Emekli çalışan SGDP işçi payı",
  });

  addSeed(rows, {
    id: `seed-payroll-${ACTIVE_YEAR}-sgdp.employer_rate`,
    module_key: MEVZUAT_MODULE_KEYS.PAYROLL,
    parameter_key: "sgdp.employer_rate",
    parameter_name: "SGDP İşveren Primi Oranı",
    value: String(yearConfig.sgdp.employerRate),
    description: "Emekli çalışan SGDP işveren payı",
  });

  return rows;
}

function buildSeveranceNoticeSeedRows() {
  const rows = [];

  addSeed(rows, {
    id: `seed-severance-${ACTIVE_YEAR}-severance_pay_ceiling`,
    module_key: MEVZUAT_MODULE_KEYS.SEVERANCE_NOTICE,
    parameter_key: "severance_pay_ceiling",
    parameter_name: "Kıdem Tazminatı Tavanı",
    value: null,
    period: "Aylık",
    description: "Güncellenecek",
  });

  addSeed(rows, {
    id: `seed-severance-${ACTIVE_YEAR}-severance_pay_days_per_year`,
    module_key: MEVZUAT_MODULE_KEYS.SEVERANCE_NOTICE,
    parameter_key: "severance_pay_days_per_year",
    parameter_name: "Kıdem Tazminatı Yılı",
    value: "30",
    period: "Yıllık",
    description: "Her hizmet yılı için 30 gün",
  });

  addSeed(rows, {
    id: `seed-severance-${ACTIVE_YEAR}-stamp_tax_rate`,
    module_key: MEVZUAT_MODULE_KEYS.SEVERANCE_NOTICE,
    parameter_key: "stamp_tax_rate",
    parameter_name: "Damga Vergisi Oranı",
    value: "0.00759",
    description: "Kıdem/ihbar hesaplarında damga vergisi oranı",
  });

  addSeed(rows, {
    id: `seed-notice-${ACTIVE_YEAR}-notice_0_6_months`,
    module_key: MEVZUAT_MODULE_KEYS.SEVERANCE_NOTICE,
    parameter_key: "notice_period_0_6_months",
    parameter_name: "İhbar Süresi (0-6 Ay)",
    value: "2",
    period: "Hafta",
    description: "0-6 ay arası hizmet süresi için ihbar süresi (hafta)",
  });

  addSeed(rows, {
    id: `seed-notice-${ACTIVE_YEAR}-notice_6_18_months`,
    module_key: MEVZUAT_MODULE_KEYS.SEVERANCE_NOTICE,
    parameter_key: "notice_period_6_18_months",
    parameter_name: "İhbar Süresi (6-18 Ay)",
    value: "4",
    period: "Hafta",
    description: "6-18 ay arası hizmet süresi için ihbar süresi (hafta)",
  });

  addSeed(rows, {
    id: `seed-notice-${ACTIVE_YEAR}-notice_18_36_months`,
    module_key: MEVZUAT_MODULE_KEYS.SEVERANCE_NOTICE,
    parameter_key: "notice_period_18_36_months",
    parameter_name: "İhbar Süresi (18-36 Ay)",
    value: "6",
    period: "Hafta",
    description: "18-36 ay arası hizmet süresi için ihbar süresi (hafta)",
  });

  addSeed(rows, {
    id: `seed-notice-${ACTIVE_YEAR}-notice_36_plus_months`,
    module_key: MEVZUAT_MODULE_KEYS.SEVERANCE_NOTICE,
    parameter_key: "notice_period_36_plus_months",
    parameter_name: "İhbar Süresi (36 Ay Üzeri)",
    value: "8",
    period: "Hafta",
    description: "36 ay ve üzeri hizmet süresi için ihbar süresi (hafta)",
  });

  return rows;
}

function buildCashCapitalIncreaseSeedRows() {
  const pendingDescription = "Admin tarafından güncellenecek";
  const pendingParams = [
    {
      key: "tcmb_commercial_credit_rate",
      name: "TCMB Ticari Kredi Faiz Oranı",
    },
    { key: "discount_rate", name: "İndirim Oranı" },
    { key: "general_discount_rate", name: "Genel İndirim Oranı" },
    {
      key: "public_company_discount_rate",
      name: "Halka Açık Şirket İndirim Oranı",
    },
    {
      key: "investment_incentive_discount_rate",
      name: "Yatırım Teşvik Belgeli Yatırım İndirim Oranı",
    },
  ];

  return pendingParams.map((param) =>
    createSeedParameter({
      id: `seed-cash-capital-${ACTIVE_YEAR}-${param.key}`,
      module_key: MEVZUAT_MODULE_KEYS.CASH_CAPITAL_INCREASE,
      parameter_key: param.key,
      parameter_name: param.name,
      year: ACTIVE_YEAR,
      period: "Yıllık",
      value: null,
      description: pendingDescription,
      valid_from: `${ACTIVE_YEAR}-01-01`,
      valid_to: YEAR_END,
      is_active: true,
    })
  );
}

function buildAdatInterestSeedRows() {
  const adatValidFrom = "2025-12-20";
  const adatDescription = "20.12.2025 tarihinden itibaren uygulanacak oran";

  return [
    createSeedParameter({
      id: `seed-adat-${ACTIVE_YEAR}-discount_rate`,
      module_key: MEVZUAT_MODULE_KEYS.ADAT_INTEREST,
      parameter_key: "discount_rate",
      parameter_name: "Reeskont Faiz Oranı",
      year: ACTIVE_YEAR,
      period: "Yıllık",
      value: "0.3875",
      description: adatDescription,
      valid_from: adatValidFrom,
      valid_to: YEAR_END,
      is_active: true,
    }),
    createSeedParameter({
      id: `seed-adat-${ACTIVE_YEAR}-advance_rate`,
      module_key: MEVZUAT_MODULE_KEYS.ADAT_INTEREST,
      parameter_key: "advance_rate",
      parameter_name: "Avans Faiz Oranı",
      year: ACTIVE_YEAR,
      period: "Yıllık",
      value: "0.3975",
      description: adatDescription,
      valid_from: adatValidFrom,
      valid_to: YEAR_END,
      is_active: true,
    }),
  ];
}

function buildTaxStampSeedRows() {
  const yearConfig = PAYROLL_YEARS[ACTIVE_YEAR];
  const rows = [];

  addSeed(rows, {
    id: `seed-tax-stamp-${ACTIVE_YEAR}-stamp_tax_rate`,
    module_key: MEVZUAT_MODULE_KEYS.TAX_STAMP,
    parameter_key: "stamp_tax_rate",
    parameter_name: "Damga Vergisi Oranı",
    value: String(yearConfig.stampTaxRate),
    description: "Genel damga vergisi oranı",
  });

  yearConfig.incomeTaxBrackets.forEach((bracket, index) => {
    addSeed(rows, {
      id: `seed-tax-stamp-${ACTIVE_YEAR}-income_tax_bracket_${index + 1}.rate`,
      module_key: MEVZUAT_MODULE_KEYS.TAX_STAMP,
      parameter_key: `income_tax_bracket_${index + 1}.rate`,
      parameter_name: `Gelir Vergisi ${index + 1}. Dilim Oranı`,
      value: String(bracket.rate),
      description: `${index + 1}. dilim gelir vergisi oranı`,
    });
  });

  addSeed(rows, {
    id: `seed-tax-stamp-${ACTIVE_YEAR}-min_wage_income_tax_exemption`,
    module_key: MEVZUAT_MODULE_KEYS.TAX_STAMP,
    parameter_key: "min_wage_income_tax_exemption",
    parameter_name: "Asgari Ücret Gelir Vergisi İstisnası",
    value: String(yearConfig.exemptions.monthlyIncomeTax),
    period: "Aylık",
    description: "Aylık asgari ücret gelir vergisi istisnası tutarı",
  });

  addSeed(rows, {
    id: `seed-tax-stamp-${ACTIVE_YEAR}-min_wage_stamp_exemption`,
    module_key: MEVZUAT_MODULE_KEYS.TAX_STAMP,
    parameter_key: "min_wage_stamp_exemption",
    parameter_name: "Asgari Ücret Damga Vergisi İstisnası",
    value: String(yearConfig.exemptions.monthlyStampTax),
    period: "Aylık",
    description: "Aylık asgari ücret damga vergisi istisnası tutarı",
  });

  return rows;
}

/** @type {import("@/src/config/mevzuatParameterSeeds").MevzuatParameterRecord[]} */
export const MEVZUAT_PARAMETER_SEEDS = [
  ...buildPayrollSeedRows(),
  ...buildSeveranceNoticeSeedRows(),
  ...buildCashCapitalIncreaseSeedRows(),
  ...buildAdatInterestSeedRows(),
  ...buildTaxStampSeedRows(),
];

export function getSeedParametersByModule(moduleKey) {
  return MEVZUAT_PARAMETER_SEEDS.filter(
    (row) => row.module_key === moduleKey && row.is_active !== false
  );
}

export function getSeedParameterById(id) {
  return MEVZUAT_PARAMETER_SEEDS.find((row) => row.id === id) || null;
}
