import {
  IK_MINIMUM_WAGE_2026,
  IK_PAYROLL_RISK_TYPES,
  IK_PERSONEL_LEAVES_STORAGE_KEY,
  IK_PERSONEL_MOVEMENTS_STORAGE_KEY,
  IK_PERSONEL_PROFILES_STORAGE_KEY,
  IK_RISK_LEVEL,
  IK_SGK_CHECK_TYPES,
  KIDEM_IHBAR_PREFILL_STORAGE_KEY,
} from "@/src/config/ikPersonelDefaults";

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function profileKey(companyId, employeeId) {
  return `${companyId}:${employeeId}`;
}

export function emptyIkProfile(companyId = "", employeeId = "") {
  return {
    companyId,
    employeeId,
    sgkSicilNo: "",
    terminationDate: "",
    grossSalary: 0,
    netSalary: 0,
    workType: "Tam zamanlı",
    lastSalaryChangeDate: "",
    missingDays: 0,
    missingDayExplanation: "",
    terminationCode: "",
    severanceProvisionChecked: false,
    updatedAt: new Date().toISOString(),
  };
}

export function parseTrDateToIso(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function loadIkProfiles() {
  if (typeof window === "undefined") return {};
  return safeParseJson(localStorage.getItem(IK_PERSONEL_PROFILES_STORAGE_KEY) || "{}", {});
}

export function saveIkProfiles(profiles = {}) {
  if (typeof window === "undefined") return;
  localStorage.setItem(IK_PERSONEL_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

export function getIkProfile(companyId, employeeId) {
  const profiles = loadIkProfiles();
  return {
    ...emptyIkProfile(companyId, employeeId),
    ...profiles[profileKey(companyId, employeeId)],
    companyId,
    employeeId,
  };
}

export function saveIkProfile(companyId, employeeId, profile = {}) {
  const profiles = loadIkProfiles();
  const key = profileKey(companyId, employeeId);
  profiles[key] = {
    ...emptyIkProfile(companyId, employeeId),
    ...profile,
    companyId,
    employeeId,
    updatedAt: new Date().toISOString(),
  };
  saveIkProfiles(profiles);
  return profiles[key];
}

export function loadIkMovements() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(IK_PERSONEL_MOVEMENTS_STORAGE_KEY) || "[]", []);
}

export function saveIkMovements(movements = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(IK_PERSONEL_MOVEMENTS_STORAGE_KEY, JSON.stringify(movements));
}

export function loadIkLeaves() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(IK_PERSONEL_LEAVES_STORAGE_KEY) || "[]", []);
}

export function saveIkLeaves(leaves = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(IK_PERSONEL_LEAVES_STORAGE_KEY, JSON.stringify(leaves));
}

export function mergeEmployeeCard(company = {}, employee = {}, profile = null) {
  const ikProfile =
    profile || getIkProfile(company.id, employee.id);

  return {
    id: employee.id,
    companyId: company.id,
    companyName: company.companyName || "",
    fullName: employee.fullName || "",
    tcNo: employee.tcNo || "",
    sgkSicilNo: ikProfile.sgkSicilNo || "",
    hireDate: employee.hireDate || "",
    terminationDate: ikProfile.terminationDate || "",
    sgkCode: employee.sgkCode || "",
    department: employee.department || "",
    position: employee.position || "",
    grossSalary: ikProfile.grossSalary || 0,
    netSalary: ikProfile.netSalary || 0,
    workType: ikProfile.workType || "Tam zamanlı",
    isActive: employee.isActive ?? true,
    phone: employee.phone || "",
    email: employee.email || "",
    lastSalaryChangeDate: ikProfile.lastSalaryChangeDate || "",
    missingDays: ikProfile.missingDays || 0,
    missingDayExplanation: ikProfile.missingDayExplanation || "",
    terminationCode: ikProfile.terminationCode || "",
  };
}

export function collectEmployeeCards(companies = []) {
  const cards = [];
  companies.forEach((company) => {
    (company.employees || []).forEach((employee) => {
      cards.push(mergeEmployeeCard(company, employee));
    });
  });
  return cards;
}

export function validateIkPersonelImport(rows = [], existingCards = []) {
  const errors = [];
  const warnings = [];
  const seenTc = new Map();
  const existingTc = new Set(
    existingCards.map((card) => String(card.tcNo || "").trim()).filter(Boolean)
  );

  rows.forEach((row) => {
    const prefix = `Satır ${row.rowIndex}`;

    if (!row.fullName) errors.push(`${prefix}: Ad soyad zorunludur.`);
    if (!row.tcNo) errors.push(`${prefix}: T.C. kimlik no zorunludur.`);
    if (!row.hireDate) errors.push(`${prefix}: İşe giriş tarihi eksik.`);

    if (row.tcNo) {
      if (seenTc.has(row.tcNo)) {
        errors.push(`${prefix}: Mükerrer T.C. (${row.tcNo}).`);
      }
      seenTc.set(row.tcNo, row.rowIndex);
      if (existingTc.has(row.tcNo)) {
        warnings.push(`${prefix}: Mevcut personelde aynı T.C. bulundu (${row.tcNo}).`);
      }
    }

    if (row.grossSalary <= 0 && row.netSalary <= 0) {
      warnings.push(`${prefix}: Brüt veya net ücret girilmedi.`);
    }
    if (row.grossSalary > 0 && row.netSalary > 0 && row.netSalary > row.grossSalary) {
      errors.push(`${prefix}: Net ücret brüt ücretten büyük olamaz.`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    duplicateTcCount: errors.filter((item) => item.includes("Mükerrer")).length,
  };
}

export function importRowsToEmployeeRecords(rows = [], companyId = "") {
  const now = new Date().toISOString();
  return rows.map((row) => ({
    employee: {
      id: crypto.randomUUID(),
      fullName: row.fullName,
      tcNo: row.tcNo,
      phone: "",
      email: "",
      position: row.position,
      department: row.department,
      hireDate: row.hireDate,
      sgkCode: row.sgkCode,
      salaryAccountCode: "335",
      advanceAccountCode: "196",
      isActive: row.isActive,
    },
    profile: {
      companyId,
      employeeId: "",
      sgkSicilNo: row.sgkSicilNo,
      terminationDate: row.terminationDate,
      grossSalary: row.grossSalary,
      netSalary: row.netSalary,
      workType: row.workType,
      lastSalaryChangeDate: row.hireDate ? parseTrDateToIso(row.hireDate) : "",
      updatedAt: now,
    },
  }));
}

export function buildMovement(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id || `mv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    companyId: input.companyId || "",
    companyName: input.companyName || "",
    employeeId: input.employeeId || "",
    employeeName: input.employeeName || "",
    type: input.type || "İşe giriş",
    effectiveDate: input.effectiveDate || now.slice(0, 10),
    description: input.description || "",
    previousValue: input.previousValue || "",
    newValue: input.newValue || "",
    createdAt: now,
  };
}

export function buildLeaveRecord(input = {}) {
  const startDate = input.startDate || "";
  const endDate = input.endDate || startDate;
  const days =
    input.days ||
    (startDate && endDate
      ? Math.max(
          1,
          Math.ceil(
            (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
          ) + 1
        )
      : 0);

  return {
    id: input.id || `lv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    companyId: input.companyId || "",
    companyName: input.companyName || "",
    employeeId: input.employeeId || "",
    employeeName: input.employeeName || "",
    type: input.type || "Yıllık izin",
    startDate,
    endDate,
    days,
    entitledDays: input.entitledDays ?? 0,
    usedDays: input.usedDays ?? days,
    remainingDays: input.remainingDays ?? 0,
    createdAt: new Date().toISOString(),
  };
}

export function calculateAnnualLeaveEntitlement(hireDate = "", asOf = new Date()) {
  const iso = parseTrDateToIso(hireDate);
  if (!iso) return 0;
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return 0;

  const years =
    (asOf.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 1) return 0;
  if (years < 5) return 14;
  if (years < 15) return 20;
  return 26;
}

export function calculateLeaveBalance(card = {}, leaves = []) {
  const entitled = calculateAnnualLeaveEntitlement(card.hireDate);
  const used = leaves
    .filter(
      (leave) =>
        leave.employeeId === card.id &&
        leave.companyId === card.companyId &&
        leave.type === "Yıllık izin"
    )
    .reduce((sum, leave) => sum + Number(leave.usedDays || leave.days || 0), 0);

  return {
    entitledDays: entitled,
    usedDays: used,
    remainingDays: Math.max(entitled - used, 0),
  };
}

export function buildSgkChecks(cards = []) {
  const checks = [];

  cards.forEach((card) => {
    if (card.missingDays > 0 && !card.missingDayExplanation?.trim()) {
      checks.push({
        id: `sgk-missing-${card.id}`,
        companyId: card.companyId,
        companyName: card.companyName,
        employeeId: card.id,
        employeeName: card.fullName,
        type: IK_SGK_CHECK_TYPES.EKSIK_GUN,
        level: IK_RISK_LEVEL.HIGH,
        message: `${card.fullName}: ${card.missingDays} eksik gün açıklaması yok.`,
      });
    }

    if (!card.sgkCode || !/^\d{4}(\.\d{2})?$/.test(card.sgkCode)) {
      checks.push({
        id: `sgk-code-${card.id}`,
        companyId: card.companyId,
        companyName: card.companyName,
        employeeId: card.id,
        employeeName: card.fullName,
        type: IK_SGK_CHECK_TYPES.MESLEK_KODU,
        level: IK_RISK_LEVEL.MEDIUM,
        message: `${card.fullName}: Meslek kodu eksik veya riskli.`,
      });
    }

    const hireIso = parseTrDateToIso(card.hireDate);
    const termIso = parseTrDateToIso(card.terminationDate);
    if (hireIso && termIso && termIso < hireIso) {
      checks.push({
        id: `sgk-date-${card.id}`,
        companyId: card.companyId,
        companyName: card.companyName,
        employeeId: card.id,
        employeeName: card.fullName,
        type: IK_SGK_CHECK_TYPES.TARIH_UYUMU,
        level: IK_RISK_LEVEL.CRITICAL,
        message: `${card.fullName}: Çıkış tarihi girişten önce.`,
      });
    }

    if (!card.isActive && !termIso) {
      checks.push({
        id: `sgk-term-${card.id}`,
        companyId: card.companyId,
        companyName: card.companyName,
        employeeId: card.id,
        employeeName: card.fullName,
        type: IK_SGK_CHECK_TYPES.TARIH_UYUMU,
        level: IK_RISK_LEVEL.HIGH,
        message: `${card.fullName}: Pasif personelde çıkış tarihi yok.`,
      });
    }

    if (card.grossSalary > 0 && card.grossSalary < IK_MINIMUM_WAGE_2026 * 0.9) {
      checks.push({
        id: `sgk-wage-${card.id}`,
        companyId: card.companyId,
        companyName: card.companyName,
        employeeId: card.id,
        employeeName: card.fullName,
        type: IK_SGK_CHECK_TYPES.UCRET_PRIM,
        level: IK_RISK_LEVEL.HIGH,
        message: `${card.fullName}: Brüt ücret prime esas kazanç için düşük görünüyor.`,
      });
    }

    if (!card.sgkSicilNo) {
      checks.push({
        id: `sgk-sicil-${card.id}`,
        companyId: card.companyId,
        companyName: card.companyName,
        employeeId: card.id,
        employeeName: card.fullName,
        type: IK_SGK_CHECK_TYPES.LISTE_UYUMU,
        level: IK_RISK_LEVEL.MEDIUM,
        message: `${card.fullName}: SGK sicil no eksik.`,
      });
    }
  });

  const companyGroups = cards.reduce((map, card) => {
    if (!map[card.companyId]) map[card.companyId] = [];
    map[card.companyId].push(card);
    return map;
  }, {});

  Object.entries(companyGroups).forEach(([companyId, group]) => {
    const activeCount = group.filter((card) => card.isActive).length;
    if (activeCount === 0 && group.length > 0) {
      checks.push({
        id: `sgk-list-${companyId}`,
        companyId,
        companyName: group[0].companyName,
        employeeId: "",
        employeeName: "",
        type: IK_SGK_CHECK_TYPES.LISTE_UYUMU,
        level: IK_RISK_LEVEL.MEDIUM,
        message: `${group[0].companyName}: Aktif personel kaydı yok.`,
      });
    }
  });

  return checks;
}

export function buildPayrollRisks(cards = []) {
  const risks = [];
  const tcMap = new Map();
  const now = new Date();

  cards.forEach((card) => {
    if (card.tcNo) {
      if (tcMap.has(card.tcNo)) {
        risks.push({
          id: `risk-tc-${card.id}`,
          companyId: card.companyId,
          employeeId: card.id,
          employeeName: card.fullName,
          type: IK_PAYROLL_RISK_TYPES.MUKERRER_TC,
          level: IK_RISK_LEVEL.CRITICAL,
          message: `Mükerrer T.C.: ${card.fullName} (${card.tcNo})`,
        });
      }
      tcMap.set(card.tcNo, card.id);
    }

    if (card.grossSalary > 0 && card.grossSalary < IK_MINIMUM_WAGE_2026) {
      risks.push({
        id: `risk-min-${card.id}`,
        companyId: card.companyId,
        employeeId: card.id,
        employeeName: card.fullName,
        type: IK_PAYROLL_RISK_TYPES.ASGARI_UCRET,
        level: IK_RISK_LEVEL.HIGH,
        message: `${card.fullName}: Brüt ücret asgari ücretin altında.`,
      });
    }

    if (card.missingDays > 0 && !card.missingDayExplanation?.trim()) {
      risks.push({
        id: `risk-missing-${card.id}`,
        companyId: card.companyId,
        employeeId: card.id,
        employeeName: card.fullName,
        type: IK_PAYROLL_RISK_TYPES.EKSIK_GUN_ACIKLAMA,
        level: IK_RISK_LEVEL.MEDIUM,
        message: `${card.fullName}: Eksik gün açıklaması eksik.`,
      });
    }

    if (card.lastSalaryChangeDate) {
      const lastChange = new Date(card.lastSalaryChangeDate);
      const months =
        (now.getFullYear() - lastChange.getFullYear()) * 12 +
        (now.getMonth() - lastChange.getMonth());
      if (months >= 12 && card.isActive) {
        risks.push({
          id: `risk-salary-${card.id}`,
          companyId: card.companyId,
          employeeId: card.id,
          employeeName: card.fullName,
          type: IK_PAYROLL_RISK_TYPES.UCRET_DEGISIMI,
          level: IK_RISK_LEVEL.MEDIUM,
          message: `${card.fullName}: 12 aydan uzun süredir ücret değişmemiş.`,
        });
      }
    }

    if (!card.isActive && !card.terminationCode) {
      risks.push({
        id: `risk-exit-${card.id}`,
        companyId: card.companyId,
        employeeId: card.id,
        employeeName: card.fullName,
        type: IK_PAYROLL_RISK_TYPES.CIKIS_KODU,
        level: IK_RISK_LEVEL.MEDIUM,
        message: `${card.fullName}: İşten çıkış kodu girilmemiş.`,
      });
    }

    const serviceYears = calculateAnnualLeaveEntitlement(card.hireDate) > 20 ? 15 : 5;
    if (card.isActive && serviceYears >= 5 && card.grossSalary > 0) {
      risks.push({
        id: `risk-sev-${card.id}`,
        companyId: card.companyId,
        employeeId: card.id,
        employeeName: card.fullName,
        type: IK_PAYROLL_RISK_TYPES.KIDEM_KARSILIK,
        level: IK_RISK_LEVEL.LOW,
        message: `${card.fullName}: Kıdem/ihbar karşılığı kontrolü önerilir.`,
      });
    }
  });

  return risks;
}

export function buildIkDashboardStats(cards = [], leaves = [], sgkChecks = [], payrollRisks = []) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const activePersonnel = cards.filter((card) => card.isActive).length;
  const hiredThisMonth = cards.filter((card) => {
    const iso = parseTrDateToIso(card.hireDate);
    return iso && iso.startsWith(currentMonth);
  }).length;
  const terminatedThisMonth = cards.filter((card) => {
    const iso = parseTrDateToIso(card.terminationDate);
    return iso && iso.startsWith(currentMonth);
  }).length;
  const missingSgkInfo = sgkChecks.filter(
    (item) => item.type === IK_SGK_CHECK_TYPES.LISTE_UYUMU
  ).length;
  const payrollRiskCount = payrollRisks.length;

  const upcomingLeaves = leaves.filter((leave) => {
    if (!leave.startDate) return false;
    const start = new Date(leave.startDate);
    const diffDays = Math.ceil((start.getTime() - now.getTime()) / 86400000);
    return diffDays >= 0 && diffDays <= 30;
  }).length;

  return {
    activePersonnel,
    hiredThisMonth,
    terminatedThisMonth,
    missingSgkInfo,
    payrollRiskCount,
    upcomingLeaves,
  };
}

export function filterEmployeeCards(
  cards = [],
  { companyId = "", activeFilter = "Tümü", dateFrom = "", dateTo = "", department = "", riskFilter = "Tümü" } = {},
  payrollRisks = []
) {
  const riskyEmployeeIds = new Set(payrollRisks.map((risk) => risk.employeeId));

  return cards.filter((card) => {
    if (companyId && card.companyId !== companyId) return false;
    if (activeFilter === "Aktif" && !card.isActive) return false;
    if (activeFilter === "Pasif" && card.isActive) return false;
    if (department && department !== "Tümü" && card.department !== department) return false;

    const hireIso = parseTrDateToIso(card.hireDate);
    if (dateFrom && hireIso && hireIso < dateFrom) return false;
    if (dateTo && hireIso && hireIso > dateTo) return false;

    if (riskFilter === "Riskli" && !riskyEmployeeIds.has(card.id)) return false;
    if (riskFilter === "Temiz" && riskyEmployeeIds.has(card.id)) return false;

    return true;
  });
}

export function saveKidemIhbarPrefill(card = {}) {
  if (typeof window === "undefined") return;
  const payload = {
    startDate: parseTrDateToIso(card.hireDate),
    endDate: parseTrDateToIso(card.terminationDate) || new Date().toISOString().slice(0, 10),
    lastGrossSalary: card.grossSalary || 0,
    employeeName: card.fullName || "",
    companyName: card.companyName || "",
    savedAt: new Date().toISOString(),
  };
  sessionStorage.setItem(KIDEM_IHBAR_PREFILL_STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function readKidemIhbarPrefill() {
  if (typeof window === "undefined") return null;
  return safeParseJson(sessionStorage.getItem(KIDEM_IHBAR_PREFILL_STORAGE_KEY) || "null", null);
}

export function runIkPersonelScenario() {
  const companyId = "test-company";
  const rows = [
    {
      rowIndex: 2,
      fullName: "Test Personel",
      tcNo: "11111111111",
      sgkSicilNo: "",
      hireDate: "01.01.2020",
      terminationDate: "",
      sgkCode: "2411.01",
      department: "İK",
      position: "Uzman",
      grossSalary: 24000,
      netSalary: 19000,
      workType: "Tam zamanlı",
      isActive: true,
    },
    {
      rowIndex: 3,
      fullName: "Mükerrer Test",
      tcNo: "11111111111",
      sgkSicilNo: "999",
      hireDate: "01.02.2021",
      terminationDate: "",
      sgkCode: "2423",
      department: "İK",
      position: "Uzman",
      grossSalary: 30000,
      netSalary: 24000,
      workType: "Tam zamanlı",
      isActive: true,
    },
  ];

  const validation = validateIkPersonelImport(rows, []);
  const card = mergeEmployeeCard(
    { id: companyId, companyName: "Test A.Ş." },
    {
      id: "emp-1",
      fullName: rows[0].fullName,
      tcNo: rows[0].tcNo,
      hireDate: rows[0].hireDate,
      sgkCode: rows[0].sgkCode,
      department: rows[0].department,
      position: rows[0].position,
      isActive: true,
    },
    {
      ...emptyIkProfile(companyId, "emp-1"),
      grossSalary: rows[0].grossSalary,
      netSalary: rows[0].netSalary,
      missingDays: 2,
    }
  );

  const prefillPayload = {
    startDate: parseTrDateToIso(card.hireDate),
    endDate: parseTrDateToIso(card.terminationDate) || new Date().toISOString().slice(0, 10),
    lastGrossSalary: card.grossSalary || 0,
  };
  if (typeof window !== "undefined") {
    sessionStorage.setItem(
      KIDEM_IHBAR_PREFILL_STORAGE_KEY,
      JSON.stringify({ ...prefillPayload, savedAt: new Date().toISOString() })
    );
  }
  const leave = buildLeaveRecord({
    companyId,
    employeeId: card.id,
    employeeName: card.fullName,
    type: "Yıllık izin",
    startDate: "2026-08-01",
    endDate: "2026-08-05",
    days: 5,
  });
  const balance = calculateLeaveBalance(card, [leave]);
  const sgkChecks = buildSgkChecks([card]);
  const payrollRisks = buildPayrollRisks([card, { ...card, id: "emp-2", tcNo: "11111111111" }]);
  const stats = buildIkDashboardStats([card], [leave], sgkChecks, payrollRisks);

  return {
    excelImportReady: rows.length === 2,
    duplicateTcWarning: validation.duplicateTcCount > 0,
    kidemIhbarPrefill: Boolean(prefillPayload.startDate && prefillPayload.lastGrossSalary),
    annualLeaveBalance: balance.remainingDays >= 0,
    sgkMissingInfoWarning: sgkChecks.length > 0,
    payrollRiskGenerated: payrollRisks.length > 0,
    activePersonnel: stats.activePersonnel,
    payrollRiskCount: stats.payrollRiskCount,
    entitledDays: balance.entitledDays,
    usedDays: balance.usedDays,
  };
}
