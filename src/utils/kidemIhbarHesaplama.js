import {
  CALCULATION_SCOPE,
  getSeveranceNoticeParameters,
} from "@/src/config/severanceNoticeParameters";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseInputDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function calculateServiceDuration(startDate, endDateInclusive) {
  const endExclusive = addDays(endDateInclusive, 1);
  let years = endExclusive.getFullYear() - startDate.getFullYear();
  let months = endExclusive.getMonth() - startDate.getMonth();
  let days = endExclusive.getDate() - startDate.getDate();

  if (days < 0) {
    months -= 1;
    const previousMonthDays = new Date(
      endExclusive.getFullYear(),
      endExclusive.getMonth(),
      0
    ).getDate();
    days += previousMonthDays;
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const serviceDays = Math.round((endExclusive - startDate) / MS_PER_DAY);

  return {
    years,
    months,
    days,
    serviceDays,
    totalMonths: years * 12 + months + (days > 0 ? 1 : 0),
  };
}

function getNoticeWeeks(totalMonths, noticePeriodWeeks) {
  if (totalMonths < 6) return noticePeriodWeeks.under6Months;
  if (totalMonths < 18) return noticePeriodWeeks.from6To18Months;
  if (totalMonths < 36) return noticePeriodWeeks.from18To36Months;
  return noticePeriodWeeks.from36Months;
}

function validateInput(input) {
  const errors = [];

  const startDate = parseInputDate(input.startDate);
  const endDate = parseInputDate(input.endDate);

  if (!startDate) errors.push("İşe giriş tarihi geçerli bir tarih olmalıdır.");
  if (!endDate) errors.push("İşten çıkış tarihi geçerli bir tarih olmalıdır.");

  if (startDate && endDate && endDate < startDate) {
    errors.push("İşten çıkış tarihi, işe giriş tarihinden önce olamaz.");
  }

  if (input.lastGrossSalary < 0) errors.push("Son aylık brüt ücret negatif olamaz.");
  if (input.monthlyTravelMeal < 0) {
    errors.push("Aylık yol + yemek yardımı negatif olamaz.");
  }
  if (input.monthlyOtherBenefits < 0) {
    errors.push("Aylık diğer menfaatler negatif olamaz.");
  }
  if (input.annualBonus < 0) errors.push("Yıllık ikramiye negatif olamaz.");
  if (input.cumulativeTaxBaseBefore < 0) {
    errors.push("Kümülatif gelir vergisi matrahı negatif olamaz.");
  }

  const scope = input.scope || CALCULATION_SCOPE.BOTH;
  const needsSeverance =
    scope === CALCULATION_SCOPE.BOTH || scope === CALCULATION_SCOPE.SEVERANCE_ONLY;

  if (needsSeverance && !(input.severanceCeiling > 0)) {
    errors.push("Kıdem tazminatı tavanı girilmelidir (pozitif tutar).");
  }

  if (!startDate || !endDate || endDate < startDate) {
    return { errors, startDate, endDate };
  }

  if (!(input.lastGrossSalary > 0)) {
    errors.push("Son aylık brüt ücret girilmelidir.");
  }

  return { errors, startDate, endDate };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function calculateSeveranceNotice(input) {
  const params = input.paramsOverride || getSeveranceNoticeParameters(input.year);
  const { errors, startDate, endDate } = validateInput(input);

  if (errors.length > 0 || !startDate || !endDate) {
    return { ok: false, errors };
  }

  const scope = input.scope || CALCULATION_SCOPE.BOTH;
  const includeSeverance =
    scope === CALCULATION_SCOPE.BOTH || scope === CALCULATION_SCOPE.SEVERANCE_ONLY;
  const includeNotice =
    scope === CALCULATION_SCOPE.BOTH || scope === CALCULATION_SCOPE.NOTICE_ONLY;

  const lastGrossSalary = round2(input.lastGrossSalary);
  const monthlyTravelMeal = round2(input.monthlyTravelMeal);
  const monthlyOtherBenefits = round2(input.monthlyOtherBenefits);
  const annualBonus = round2(input.annualBonus);
  const monthlyBonus = round2(annualBonus / 12);
  const severanceCeiling = round2(input.severanceCeiling);
  const cumulativeTaxBaseBefore = round2(input.cumulativeTaxBaseBefore);

  const dressedGrossSalary = round2(
    lastGrossSalary + monthlyTravelMeal + monthlyOtherBenefits + monthlyBonus
  );

  const service = calculateServiceDuration(startDate, endDate);
  const eligibleForSeverance = service.serviceDays >= params.minServiceDaysForSeverance;

  const severanceBaseMonthly = round2(
    Math.min(dressedGrossSalary, severanceCeiling > 0 ? severanceCeiling : dressedGrossSalary)
  );

  let grossSeverance = 0;
  let severanceStampTax = 0;
  let netSeverance = 0;

  if (includeSeverance && eligibleForSeverance) {
    grossSeverance = round2(
      (severanceBaseMonthly / params.daysPerYear) * service.serviceDays
    );
    severanceStampTax = round2(grossSeverance * params.stampTaxRate);
    netSeverance = round2(grossSeverance - severanceStampTax);
  }

  const noticeWeeks = getNoticeWeeks(service.totalMonths, params.noticePeriodWeeks);
  const noticeDays = noticeWeeks * 7;
  const noticeDailyGross = round2(dressedGrossSalary / params.noticeDailyWageDivisor);

  let grossNotice = 0;
  let noticeIncomeTax = 0;
  let noticeStampTax = 0;
  let netNotice = 0;

  if (includeNotice) {
    grossNotice = round2(noticeDailyGross * noticeDays);

    const noticeTaxBase = grossNotice;
    const cumulativeTaxBaseAfter = round2(cumulativeTaxBaseBefore + noticeTaxBase);
    const cumulativeTaxBefore = calculateCumulativeIncomeTax(
      cumulativeTaxBaseBefore,
      params.incomeTaxBrackets
    );
    const cumulativeTaxAfter = calculateCumulativeIncomeTax(
      cumulativeTaxBaseAfter,
      params.incomeTaxBrackets
    );
    noticeIncomeTax = round2(Math.max(cumulativeTaxAfter - cumulativeTaxBefore, 0));
    noticeStampTax = round2(grossNotice * params.stampTaxRate);
    netNotice = round2(grossNotice - noticeIncomeTax - noticeStampTax);
  }

  const totalGross = round2(grossSeverance + grossNotice);
  const totalNet = round2(netSeverance + netNotice);
  const totalStampTax = round2(severanceStampTax + noticeStampTax);

  const warnings = [];
  if (includeSeverance && !eligibleForSeverance) {
    warnings.push("Kıdem tazminatı için en az 1 yıl hizmet şartı sağlanmamaktadır.");
  }

  return {
    ok: true,
    errors: [],
    warnings,
    scope,
    params: {
      stampTaxRate: params.stampTaxRate,
      daysPerYear: params.daysPerYear,
      noticeDailyWageDivisor: params.noticeDailyWageDivisor,
    },
    input: {
      startDate: input.startDate,
      endDate: input.endDate,
      lastGrossSalary,
      monthlyTravelMeal,
      monthlyOtherBenefits,
      annualBonus,
      severanceCeiling,
      cumulativeTaxBaseBefore,
    },
    wage: {
      bareGrossSalary: lastGrossSalary,
      monthlyBonus,
      dressedGrossSalary,
      severanceBaseMonthly,
      noticeDailyGross,
    },
    service: {
      ...service,
      label: `${service.years} yıl ${service.months} ay ${service.days} gün`,
      eligibleForSeverance,
    },
    severance: {
      included: includeSeverance,
      eligible: eligibleForSeverance,
      gross: grossSeverance,
      stampTax: severanceStampTax,
      net: netSeverance,
      formula: eligibleForSeverance
        ? `(${severanceBaseMonthly} / ${params.daysPerYear}) × ${service.serviceDays}`
        : null,
    },
    notice: {
      included: includeNotice,
      weeks: noticeWeeks,
      days: noticeDays,
      gross: grossNotice,
      incomeTax: noticeIncomeTax,
      stampTax: noticeStampTax,
      net: netNotice,
      formula: includeNotice
        ? `${noticeDailyGross} × ${noticeDays} gün (${noticeWeeks} hafta)`
        : null,
    },
    taxes: {
      severanceStampTax,
      noticeIncomeTax,
      noticeStampTax,
      totalStampTax,
      totalIncomeTax: noticeIncomeTax,
    },
    totals: {
      gross: totalGross,
      net: totalNet,
    },
    details: {
      wageComponents: [
        { label: "Son aylık brüt ücret", value: lastGrossSalary },
        { label: "Aylık yol + yemek yardımı", value: monthlyTravelMeal },
        { label: "Aylık diğer düzenli menfaatler", value: monthlyOtherBenefits },
        { label: "Aylık ikramiye (yıllık / 12)", value: monthlyBonus },
        { label: "Giydirilmiş brüt ücret", value: dressedGrossSalary, highlight: true },
      ],
      serviceSteps: [
        { label: "İşe giriş", value: input.startDate },
        { label: "İşten çıkış (dahil)", value: input.endDate },
        { label: "Toplam hizmet günü", value: String(service.serviceDays) },
        { label: "Hizmet süresi", value: service.label },
        {
          label: "Kıdem şartı (min. 1 yıl)",
          value: eligibleForSeverance ? "Sağlandı" : "Sağlanmadı",
        },
      ],
      severanceSteps: includeSeverance
        ? [
            { label: "Giydirilmiş brüt ücret", value: dressedGrossSalary },
            { label: "Kıdem tavanı (aylık)", value: severanceCeiling },
            { label: "Kıdeme esas aylık ücret", value: severanceBaseMonthly },
            { label: "Kıdeme esas gün", value: service.serviceDays },
            { label: "Brüt kıdem tazminatı", value: grossSeverance, highlight: true },
          ]
        : [],
      noticeSteps: includeNotice
        ? [
            { label: "Toplam hizmet (ay)", value: service.totalMonths },
            { label: "İhbar süresi (hafta)", value: noticeWeeks },
            { label: "İhbar günü", value: noticeDays },
            { label: "Giydirilmiş günlük brüt", value: noticeDailyGross },
            { label: "Brüt ihbar tazminatı", value: grossNotice, highlight: true },
          ]
        : [],
      taxSteps: [
        ...(includeSeverance && grossSeverance > 0
          ? [
              {
                label: "Kıdem damga vergisi",
                value: severanceStampTax,
                note: `%${(params.stampTaxRate * 100).toFixed(3).replace(".", ",")}`,
              },
            ]
          : []),
        ...(includeNotice && grossNotice > 0
          ? [
              {
                label: "İhbar gelir vergisi",
                value: noticeIncomeTax,
                note: `Kümülatif matrah: ${cumulativeTaxBaseBefore} + ${grossNotice}`,
              },
              {
                label: "İhbar damga vergisi",
                value: noticeStampTax,
                note: `%${(params.stampTaxRate * 100).toFixed(3).replace(".", ",")}`,
              },
            ]
          : []),
      ],
      totalSteps: [
        { label: "Toplam brüt tazminat", value: totalGross, highlight: true },
        { label: "Toplam net tazminat", value: totalNet, highlight: true },
      ],
    },
  };
}
