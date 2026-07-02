export const MEVZUAT_MODULE_KEYS = {
  PAYROLL: "payroll",
  SEVERANCE_NOTICE: "severance_notice",
  CASH_CAPITAL_INCREASE: "cash_capital_increase",
  ADAT_INTEREST: "adat_interest",
  TAX_STAMP: "tax_stamp",
};

export const MEVZUAT_MODULE_TABS = [
  {
    key: MEVZUAT_MODULE_KEYS.PAYROLL,
    label: "Maaş / SGK Parametreleri",
  },
  {
    key: MEVZUAT_MODULE_KEYS.SEVERANCE_NOTICE,
    label: "Kıdem / İhbar Parametreleri",
  },
  {
    key: MEVZUAT_MODULE_KEYS.CASH_CAPITAL_INCREASE,
    label: "Nakdi Sermaye Artışı Parametreleri",
  },
  {
    key: MEVZUAT_MODULE_KEYS.ADAT_INTEREST,
    label: "Adat Faiz Parametreleri",
  },
  {
    key: MEVZUAT_MODULE_KEYS.TAX_STAMP,
    label: "Vergi / Damga Vergisi Parametreleri",
  },
];

/**
 * @typedef {object} MevzuatParameterRecord
 * @property {string} id
 * @property {string} module_key
 * @property {string} parameter_key
 * @property {string} parameter_name
 * @property {number} year
 * @property {string} period
 * @property {string} value
 * @property {string} description
 * @property {string|null} valid_from
 * @property {string|null} valid_to
 * @property {boolean} is_active
 */

/**
 * @param {Partial<MevzuatParameterRecord>} row
 * @returns {MevzuatParameterRecord}
 */
export function createSeedParameter(row) {
  const rawValue = row.value;
  const value =
    rawValue === null || rawValue === undefined ? "" : String(rawValue);

  return {
    id: row.id,
    module_key: row.module_key,
    parameter_key: row.parameter_key,
    parameter_name: row.parameter_name,
    year: row.year,
    period: row.period || "Yıllık",
    value,
    description: row.description || "",
    valid_from: row.valid_from || null,
    valid_to: row.valid_to || null,
    is_active: row.is_active !== false,
  };
}

/** Admin panelinde boş/null değerler için görünen metin */
export function formatParameterDisplayValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "Güncellenecek";
  }
  return String(value);
}
