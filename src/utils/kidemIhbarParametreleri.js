import {
  DEFAULT_SEVERANCE_YEAR,
  getSeveranceNoticeParameters,
} from "@/src/config/severanceNoticeParameters";
import { getSeedParametersByModule } from "@/src/config/mevzuatParameterSeedData";
import { MEVZUAT_MODULE_KEYS } from "@/src/config/mevzuatParameterSeeds";

import { parseMoneyTR } from "@/src/utils/parseMoneyTR";

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;

  if (text.includes(",") || (text.includes(".") && text.split(".").pop()?.length !== 3)) {
    return parseMoneyTR(text);
  }

  const parsed = Number(text.replace(/\./g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRate(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function mapNoticeWeeks(records) {
  const find = (key) => parseNumber(records.find((row) => row.parameter_key === key)?.value);

  return {
    under6Months: find("notice_period_0_6_months"),
    from6To18Months: find("notice_period_6_18_months"),
    from18To36Months: find("notice_period_18_36_months"),
    from36Months: find("notice_period_36_plus_months"),
  };
}

export function buildSeveranceParamsFromMevzuatRecords(
  records = [],
  year = DEFAULT_SEVERANCE_YEAR
) {
  const base = getSeveranceNoticeParameters(year);
  const activeRows = records.filter(
    (row) => Number(row.year) === Number(year) && row.is_active !== false
  );

  const noticePeriodWeeks = mapNoticeWeeks(activeRows);
  const severancePayCeilingRaw = activeRows.find(
    (row) => row.parameter_key === "severance_pay_ceiling"
  )?.value;
  const severancePayCeiling = parseNumber(severancePayCeilingRaw);
  const daysPerYear = parseNumber(
    activeRows.find((row) => row.parameter_key === "severance_pay_days_per_year")?.value
  );
  const stampTaxRate = parseRate(
    activeRows.find((row) => row.parameter_key === "stamp_tax_rate")?.value
  );

  return {
    ...base,
    severancePayCeiling:
      severancePayCeilingRaw === null || severancePayCeilingRaw === ""
        ? base.severancePayCeiling
        : severancePayCeiling,
    daysPerYear: daysPerYear ?? base.daysPerYear,
    stampTaxRate: stampTaxRate ?? base.stampTaxRate,
    noticePeriodWeeks: {
      under6Months: noticePeriodWeeks.under6Months ?? base.noticePeriodWeeks.under6Months,
      from6To18Months:
        noticePeriodWeeks.from6To18Months ?? base.noticePeriodWeeks.from6To18Months,
      from18To36Months:
        noticePeriodWeeks.from18To36Months ?? base.noticePeriodWeeks.from18To36Months,
      from36Months: noticePeriodWeeks.from36Months ?? base.noticePeriodWeeks.from36Months,
    },
  };
}

export function getDefaultSeveranceParamsFromSeed(year = DEFAULT_SEVERANCE_YEAR) {
  return buildSeveranceParamsFromMevzuatRecords(
    getSeedParametersByModule(MEVZUAT_MODULE_KEYS.SEVERANCE_NOTICE),
    year
  );
}

export async function loadSeveranceParamsForBulk(year = DEFAULT_SEVERANCE_YEAR) {
  const seedParams = getDefaultSeveranceParamsFromSeed(year);

  try {
    const response = await fetch(
      `/api/admin/mevzuat-parametreleri?module_key=${MEVZUAT_MODULE_KEYS.SEVERANCE_NOTICE}`
    );

    if (!response.ok) {
      return { params: seedParams, source: "seed" };
    }

    const payload = await response.json();
    return {
      params: buildSeveranceParamsFromMevzuatRecords(payload.rows || [], year),
      source: payload.meta?.source || "supabase",
    };
  } catch {
    return { params: seedParams, source: "seed" };
  }
}
