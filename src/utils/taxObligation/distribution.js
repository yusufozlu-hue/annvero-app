/**
 * Tahakkuk satırlarından Luca bacak önerisi (saf).
 * Hesap kodu yoksa boş bırakır — rastgele 360/361/602 üretmez.
 */
import { roundMoney } from "./normalize.js";
import { ACCOUNTING_ROLE, MAPPING_STATUS, OBLIGATION_TYPE } from "./types.js";
import { applySgkLineMapping } from "./sgkRules.js";

const ROLE_HINTS_MUHSGK = [
  { re: /UCRET|GELIR\s*VERGISI|GV\b/i, role: ACCOUNTING_ROLE.UCRET_STOPAJ },
  { re: /KIRA/i, role: ACCOUNTING_ROLE.KIRA_STOPAJ },
  { re: /SERBEST|SMM|SM\b/i, role: ACCOUNTING_ROLE.SERBEST_MESLEK_STOPAJ },
  { re: /DAMGA/i, role: ACCOUNTING_ROLE.DAMGA_VERGISI },
  { re: /SGDP/i, role: ACCOUNTING_ROLE.SGDP },
  { re: /ISSIZLIK/i, role: ACCOUNTING_ROLE.ISSIZLIK },
  { re: /SGK|PRIM/i, role: ACCOUNTING_ROLE.SGK_NORMAL },
  { re: /STOPAJ|GV/i, role: ACCOUNTING_ROLE.GELIR_VERGISI_STOPAJ },
];

function inferMuhsgkRole(description = "") {
  for (const h of ROLE_HINTS_MUHSGK) {
    if (h.re.test(description)) return h.role;
  }
  return ACCOUNTING_ROLE.OTHER_360;
}

function mapFromCompanyExtras(role, mappings = {}) {
  const extras = mappings.extraMappings || [];
  const hit = extras.find(
    (e) =>
      String(e.label || "").toUpperCase().includes(role.replace(/_/g, " ")) ||
      String(e.id || "") === role
  );
  return hit?.lucaAccountCode ? String(hit.lucaAccountCode).trim() : "";
}

/**
 * Satır → borç bacağı önerisi (+ isteğe bağlı 602 alacak).
 */
export function buildDistributionLegs({
  accrual,
  bankAmount,
  bankAccountCode = "",
  taxSgkAccountMappings = {},
  companyAccountMap = {},
  companyPlans = [],
  scenarioResult = null,
} = {}) {
  if (!accrual) {
    return {
      legs: [],
      ready: false,
      warnings: ["Tahakkuk yok"],
    };
  }

  const warnings = [];
  const legs = [];
  let lines = [...(accrual.lines || [])];

  // SGK satır eşlemesi
  if (
    accrual.obligation_type === OBLIGATION_TYPE.SGK ||
    accrual.obligation_type === OBLIGATION_TYPE.SGDP ||
    accrual.obligation_type === "SGK"
  ) {
    lines = lines.map((line) =>
      applySgkLineMapping(line, { taxSgkAccountMappings, companyPlans })
    );
  }

  // MUHSGK / KDV2 rol çıkarımı
  if (
    accrual.obligation_type === OBLIGATION_TYPE.MUHSGK ||
    accrual.obligation_type === OBLIGATION_TYPE.KDV2
  ) {
    lines = lines.map((line) => {
      if (line.accounting_role) return line;
      const role =
        accrual.obligation_type === OBLIGATION_TYPE.KDV2
          ? ACCOUNTING_ROLE.KDV2_TEVKIFAT
          : inferMuhsgkRole(line.description || line.source_text);
      return { ...line, accounting_role: role };
    });
  }

  for (const line of lines) {
    const amount = roundMoney(line.payable_amount);
    if (amount <= 0) continue;

    let code = String(line.mapped_account_code || "").trim();
    if (!code && line.accounting_role) {
      code =
        String(companyAccountMap[line.accounting_role] || "").trim() ||
        mapFromCompanyExtras(line.accounting_role, taxSgkAccountMappings);
    }
    if (
      !code &&
      (line.accounting_role === ACCOUNTING_ROLE.SGK_NORMAL ||
        line.accounting_role === ACCOUNTING_ROLE.SGDP ||
        line.accounting_role === ACCOUNTING_ROLE.ISSIZLIK)
    ) {
      const mapped = applySgkLineMapping(
        { ...line, accounting_role: line.accounting_role },
        { taxSgkAccountMappings, companyPlans }
      );
      code = mapped.mapped_account_code;
      line.mapping_status = mapped.mapping_status;
    }

    if (!code) {
      warnings.push(
        `Hesap eşlemesi eksik: ${line.description || line.accounting_role || line.line_type}`
      );
    }

    legs.push({
      side: "BORC",
      accountCode: code,
      amount,
      description: line.description || accrual.obligation_type,
      accounting_role: line.accounting_role,
      mapping_status: code ? MAPPING_STATUS.MAPPED : MAPPING_STATUS.MANUAL,
      line_id: line.id,
    });
  }

  // Doğrulanmış teşvik geliri alacak bacağı
  if (
    scenarioResult?.autoApplyIncentiveIncome &&
    scenarioResult.incentive_income_amount > 0 &&
    scenarioResult.incentiveAccountCode
  ) {
    legs.push({
      side: "ALACAK",
      accountCode: scenarioResult.incentiveAccountCode,
      amount: roundMoney(scenarioResult.incentive_income_amount),
      description: "SGK teşvik geliri (doğrulanmış)",
      accounting_role: ACCOUNTING_ROLE.SGK_INCENTIVE_INCOME,
      mapping_status: MAPPING_STATUS.MAPPED,
    });
  } else if (
    scenarioResult?.incentive_income_amount > 0 &&
    !scenarioResult.autoApplyIncentiveIncome
  ) {
    warnings.push("602 teşvik geliri için hesap seçimi / doğrulama gerekli.");
  }

  const bankCode = String(bankAccountCode || "").trim();
  const bankAmt = roundMoney(bankAmount ?? accrual.total_payable);
  if (bankCode && bankAmt > 0) {
    legs.push({
      side: "ALACAK",
      accountCode: bankCode,
      amount: bankAmt,
      description: "Banka ödemesi",
      accounting_role: "BANK",
      mapping_status: MAPPING_STATUS.MAPPED,
    });
  } else if (!bankCode) {
    warnings.push("Banka hesap kodu yok.");
  }

  const debit = roundMoney(
    legs.filter((l) => l.side === "BORC").reduce((s, l) => s + l.amount, 0)
  );
  const credit = roundMoney(
    legs.filter((l) => l.side === "ALACAK").reduce((s, l) => s + l.amount, 0)
  );
  const balanced = Math.abs(debit - credit) <= 0.02;
  if (!balanced) {
    warnings.push(`Borç/alacak dengesiz: borç ${debit} / alacak ${credit}`);
  }

  const allMapped = legs
    .filter((l) => l.accounting_role !== "BANK")
    .every((l) => l.accountCode);

  return {
    legs,
    debit,
    credit,
    balanced,
    ready: Boolean(allMapped && balanced && warnings.length === 0),
    warnings,
  };
}
