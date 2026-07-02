import {
  EMPLOYEE_STATUS,
  getPayrollParameters,
  MONTHS_TR,
  SGK_DISCOUNT,
  WAGE_TYPE,
} from "@/src/config/payrollParameters";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getEmployerSgkRate(params, sgkDiscount, employeeStatus) {
  if (employeeStatus === EMPLOYEE_STATUS.RETIRED) {
    return params.sgdp.employerRate;
  }
  if (sgkDiscount === SGK_DISCOUNT.DISCOUNT_2) {
    return params.sgk.employerRateDiscount2;
  }
  if (sgkDiscount === SGK_DISCOUNT.DISCOUNT_5) {
    return params.sgk.employerRateDiscount5;
  }
  return params.sgk.employerRate;
}

function getEmployeeSgkRate(params, employeeStatus) {
  if (employeeStatus === EMPLOYEE_STATUS.RETIRED) {
    return params.sgdp.employeeRate;
  }
  return params.sgk.employeeRate;
}

function getUnemploymentEmployeeRate(params, employeeStatus) {
  if (employeeStatus === EMPLOYEE_STATUS.RETIRED) {
    return params.sgdp.unemploymentEmployeeRate;
  }
  return params.sgk.unemploymentEmployeeRate;
}

function getUnemploymentEmployerRate(params, employeeStatus) {
  if (employeeStatus === EMPLOYEE_STATUS.RETIRED) {
    return params.sgdp.unemploymentEmployerRate;
  }
  return params.sgk.unemploymentEmployerRate;
}

function calculateSgkMatrah(fullMonthGross, sgkDays, params) {
  const ratio = sgkDays / params.sgk.baseDays;
  const proratedGross = fullMonthGross * ratio;
  const minBase = params.minWage.gross * ratio;
  const maxBase = params.minWage.gross * params.sgk.ceilingMultiplier * ratio;
  return round2(clamp(proratedGross, minBase, maxBase));
}

function calculateCumulativeIncomeTax(cumulativeBase, brackets) {
  let tax = 0;
  let remaining = cumulativeBase;
  let previousLimit = 0;

  for (const bracket of brackets) {
    const limit = bracket.upTo === Infinity ? Number.POSITIVE_INFINITY : bracket.upTo;
    const bracketWidth =
      limit === Number.POSITIVE_INFINITY ? remaining : limit - previousLimit;
    const taxable = Math.min(Math.max(remaining, 0), bracketWidth);
    if (taxable <= 0) {
      previousLimit = limit;
      continue;
    }
    tax += taxable * bracket.rate;
    remaining -= taxable;
    previousLimit = limit;
    if (remaining <= 0) break;
  }

  return round2(tax);
}

function shouldApplyMinWageExemption(monthIndex, startMonth, usedExemptionMonths) {
  const monthOrder = monthIndex - startMonth + 1;
  if (monthOrder < 1) return false;
  return usedExemptionMonths + monthOrder <= 12;
}

/**
 * Tek ay bordro hesabı (brüt maaş biliniyor).
 */
export function calculateMonthlyPayrollFromGross({
  fullMonthGross,
  sgkDays,
  params,
  employeeStatus,
  sgkDiscount,
  cumulativeTaxBaseBefore,
  cumulativeTaxBefore,
  applyMinWageExemption,
  netRoadPayment = 0,
}) {
  const ratio = sgkDays / params.sgk.baseDays;
  const grossSalary = round2(fullMonthGross * ratio);
  const sgkMatrah = calculateSgkMatrah(fullMonthGross, sgkDays, params);

  const sgkEmployeeRate = getEmployeeSgkRate(params, employeeStatus);
  const unemploymentEmployeeRate = getUnemploymentEmployeeRate(params, employeeStatus);
  const sgkEmployerRate = getEmployerSgkRate(params, sgkDiscount, employeeStatus);
  const unemploymentEmployerRate = getUnemploymentEmployerRate(params, employeeStatus);

  const sgkEmployee = round2(sgkMatrah * sgkEmployeeRate);
  const unemploymentEmployee = round2(sgkMatrah * unemploymentEmployeeRate);
  const incomeTaxBase = round2(Math.max(grossSalary - sgkEmployee - unemploymentEmployee, 0));

  const cumulativeTaxBase = round2(cumulativeTaxBaseBefore + incomeTaxBase);
  const cumulativeTax = calculateCumulativeIncomeTax(
    cumulativeTaxBase,
    params.incomeTaxBrackets
  );
  let incomeTax = round2(Math.max(cumulativeTax - cumulativeTaxBefore, 0));

  let minWageIncomeTaxExemption = 0;
  if (applyMinWageExemption) {
    minWageIncomeTaxExemption = round2(params.exemptions.monthlyIncomeTax * ratio);
    incomeTax = round2(Math.max(incomeTax - minWageIncomeTaxExemption, 0));
  }

  const stampTax = round2(grossSalary * params.stampTaxRate);
  let minWageStampTaxExemption = 0;
  if (applyMinWageExemption) {
    minWageStampTaxExemption = round2(params.exemptions.monthlyStampTax * ratio);
  }
  const netStampTax = round2(Math.max(stampTax - minWageStampTaxExemption, 0));

  const netSalary = round2(
    grossSalary - sgkEmployee - unemploymentEmployee - incomeTax - netStampTax
  );

  const sgkEmployer = round2(sgkMatrah * sgkEmployerRate);
  const unemploymentEmployer = round2(sgkMatrah * unemploymentEmployerRate);
  const totalEmployerCost = round2(
    grossSalary + sgkEmployer + unemploymentEmployer
  );

  const employeeDeductions = round2(
    sgkEmployee + unemploymentEmployee + incomeTax + netStampTax
  );

  return {
    grossSalary,
    netSalary,
    sgkDays,
    sgkMatrah,
    sgkEmployee,
    unemploymentEmployee,
    incomeTaxBase,
    cumulativeTaxBase,
    incomeTax,
    minWageIncomeTaxExemption,
    stampTax,
    minWageStampTaxExemption,
    netStampTax,
    sgkEmployer,
    unemploymentEmployer,
    totalEmployerCost,
    employeeDeductions,
    cumulativeTax,
    netRoadPayment: round2(netRoadPayment),
    grossRoadPayment: 0,
    totalCostWithRoad: round2(totalEmployerCost + netRoadPayment),
  };
}

/**
 * Brüt maaştan net maaş (yol dahil).
 */
export function calculateFromGross(input) {
  const params = getPayrollParameters(input.year);
  const monthResult = calculateMonthlyPayrollFromGross({
    fullMonthGross: input.salaryAmount,
    sgkDays: input.sgkDays,
    params,
    employeeStatus: input.employeeStatus,
    sgkDiscount: input.sgkDiscount,
    cumulativeTaxBaseBefore: input.cumulativeTaxBaseBefore || 0,
    cumulativeTaxBefore: input.cumulativeTaxBefore || 0,
    applyMinWageExemption: input.applyMinWageExemption ?? true,
    netRoadPayment: 0,
  });

  let grossRoadPayment = 0;
  let netRoadPayment = round2(input.netRoadPayment || 0);

  if (netRoadPayment > 0) {
    const findGrossForNet = (targetNet) => {
      let low = targetNet;
      let high = targetNet * 2.5;
      for (let i = 0; i < 80; i += 1) {
        const mid = (low + high) / 2;
        const trial = calculateMonthlyPayrollFromGross({
          fullMonthGross: mid,
          sgkDays: input.sgkDays,
          params,
          employeeStatus: input.employeeStatus,
          sgkDiscount: input.sgkDiscount,
          cumulativeTaxBaseBefore: input.cumulativeTaxBaseBefore || 0,
          cumulativeTaxBefore: input.cumulativeTaxBefore || 0,
          applyMinWageExemption: input.applyMinWageExemption ?? true,
        });
        if (Math.abs(trial.netSalary - targetNet) <= 0.01) return mid;
        if (trial.netSalary < targetNet) low = mid;
        else high = mid;
      }
      return (low + high) / 2;
    };
    grossRoadPayment = round2(findGrossForNet(netRoadPayment));
  }

  const totalEmployerCost = round2(
    monthResult.totalEmployerCost + grossRoadPayment
  );

  return {
    ...monthResult,
    netRoadPayment,
    grossRoadPayment,
    totalCostWithRoad: round2(totalEmployerCost),
    netTotalPayment: round2(monthResult.netSalary + netRoadPayment),
  };
}

/**
 * Net maaştan brüt maaş — iteratif ters hesaplama.
 */
export function calculateFromNet(input) {
  const targetNet = input.salaryAmount;
  let low = targetNet;
  let high = targetNet * 2.5;

  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    const result = calculateFromGross({
      ...input,
      salaryAmount: mid,
      netRoadPayment: 0,
    });
    const diff = result.netSalary - targetNet;
    if (Math.abs(diff) <= 0.01) {
      return calculateFromGross({ ...input, salaryAmount: round2(mid) });
    }
    if (diff < 0) low = mid;
    else high = mid;
  }

  return calculateFromGross({
    ...input,
    salaryAmount: round2((low + high) / 2),
  });
}

/**
 * Yıl boyunca aylık projeksiyon tablosu.
 */
export function calculatePayrollProjection(formInput) {
  const params = getPayrollParameters(formInput.year);
  const startMonth = formInput.startMonth;
  const selectedMonth = formInput.selectedMonth;
  const wageType = formInput.wageType;
  const isNetInput = wageType === WAGE_TYPE.NET;

  let cumulativeTaxBase = round2(formInput.cumulativeTaxBaseBefore || 0);
  let cumulativeTax = calculateCumulativeIncomeTax(
    cumulativeTaxBase,
    params.incomeTaxBrackets
  );

  const monthlyRows = [];

  for (let month = startMonth; month <= 12; month += 1) {
    const applyExemption = shouldApplyMinWageExemption(
      month,
      startMonth,
      formInput.usedExemptionMonths || 0
    );

    const monthInput = {
      year: formInput.year,
      sgkDays: formInput.sgkDays,
      employeeStatus: formInput.employeeStatus,
      sgkDiscount: formInput.sgkDiscount,
      cumulativeTaxBaseBefore: cumulativeTaxBase,
      cumulativeTaxBefore: cumulativeTax,
      applyMinWageExemption: applyExemption,
      netRoadPayment: formInput.netRoadPayment || 0,
      salaryAmount: formInput.salaryAmount,
    };

    const monthResult = isNetInput
      ? calculateFromNet({ ...monthInput, salaryAmount: formInput.salaryAmount })
      : calculateFromGross(monthInput);

    cumulativeTaxBase = monthResult.cumulativeTaxBase;
    cumulativeTax = monthResult.cumulativeTax;

    monthlyRows.push({
      month,
      monthLabel: MONTHS_TR.find((m) => m.value === month)?.label || `${month}`,
      isSelected: month === selectedMonth,
      ...monthResult,
    });
  }

  const periodRows = monthlyRows;
  const firstRow = periodRows[0] || null;
  const count = periodRows.length || 1;

  const totals = periodRows.reduce(
    (acc, row) => ({
      grossSalary: acc.grossSalary + row.grossSalary,
      netSalary: acc.netSalary + row.netSalary,
      sgkEmployee: acc.sgkEmployee + row.sgkEmployee,
      unemploymentEmployee: acc.unemploymentEmployee + row.unemploymentEmployee,
      incomeTax: acc.incomeTax + row.incomeTax,
      netStampTax: acc.netStampTax + row.netStampTax,
      totalEmployerCost: acc.totalEmployerCost + row.totalEmployerCost,
      totalCostWithRoad: acc.totalCostWithRoad + row.totalCostWithRoad,
      employeeDeductions: acc.employeeDeductions + row.employeeDeductions,
    }),
    {
      grossSalary: 0,
      netSalary: 0,
      sgkEmployee: 0,
      unemploymentEmployee: 0,
      incomeTax: 0,
      netStampTax: 0,
      totalEmployerCost: 0,
      totalCostWithRoad: 0,
      employeeDeductions: 0,
    }
  );

  const selectedRow =
    periodRows.find((row) => row.month === selectedMonth) || firstRow;

  return {
    params,
    monthlyRows: periodRows,
    selectedRow,
    firstRow,
    totals: {
      grossSalary: round2(totals.grossSalary),
      netSalary: round2(totals.netSalary),
      totalEmployerCost: round2(totals.totalEmployerCost),
      totalCostWithRoad: round2(totals.totalCostWithRoad),
      employeeDeductions: round2(totals.employeeDeductions),
    },
    summary: {
      firstMonthNet: firstRow ? firstRow.netTotalPayment || firstRow.netSalary : 0,
      firstMonthGross: firstRow ? firstRow.grossSalary : 0,
      averageEmployerCost: round2(totals.totalEmployerCost / count),
      yearEndTotalGross: round2(totals.grossSalary),
      yearEndTotalNet: round2(totals.netSalary),
      periodTotalEmployerCost: round2(totals.totalEmployerCost),
      averageEmployeeDeduction: round2(totals.employeeDeductions / count),
    },
  };
}

export { round2 };
