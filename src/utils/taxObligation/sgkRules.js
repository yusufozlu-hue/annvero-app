/**
 * SGK kanun / teşvik → muhasebe rolü ve firma eşlemesi.
 * Sabit 361/602 kodu üretmez.
 */
import { ACCOUNTING_ROLE, MAPPING_STATUS } from "./types.js";

const NORMAL_LAW_CODES = new Set(["5510", "6661", "14857"]);

export function normalizeLawCode(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return String(value || "").trim().toUpperCase();
  return digits;
}

export function isSgdpLawOrLabel({ lawCode = "", description = "" } = {}) {
  const law = normalizeLawCode(lawCode);
  const text = String(description || "").toUpperCase();
  if (law === "SGDP" || /SGDP/.test(law)) return true;
  if (/\bSGDP\b/.test(text) || /DESTEK\s*PRIM/.test(text) || /EMEKLI/.test(text) && /PRIM/.test(text)) {
    return /\bSGDP\b/.test(text) || /SOSYAL\s*GUVENLIK\s*DESTEK/.test(text);
  }
  return false;
}

/**
 * 5510 / 6661 / 14857 / diğer normal çalışan → SGK_NORMAL
 * Yalnız SGDP → SGDP
 */
export function resolveSgkAccountingRole({
  lawCode = "",
  description = "",
  forcedRole = "",
} = {}) {
  if (forcedRole) return forcedRole;
  if (isSgdpLawOrLabel({ lawCode, description })) {
    return ACCOUNTING_ROLE.SGDP;
  }
  const law = normalizeLawCode(lawCode);
  if (!law || NORMAL_LAW_CODES.has(law) || /^\d{4,5}$/.test(law)) {
    // Normal / teşvikli çalışan kanunları hepsi 361 SGK grubuna
    if (/\bISSIZLIK\b/i.test(description)) return ACCOUNTING_ROLE.ISSIZLIK;
    return ACCOUNTING_ROLE.SGK_NORMAL;
  }
  if (/\bISSIZLIK\b/i.test(description)) return ACCOUNTING_ROLE.ISSIZLIK;
  return ACCOUNTING_ROLE.SGK_NORMAL;
}

/**
 * Firma taxSgkAccountMappings / plan adayından hesap çöz.
 * Yoksa MANUAL — rastgele kod üretme.
 */
export function resolveSgkMappedAccount({
  accountingRole = ACCOUNTING_ROLE.SGK_NORMAL,
  taxSgkAccountMappings = {},
  companyPlans = [],
  preferPlanHints = true,
} = {}) {
  const maps = taxSgkAccountMappings || {};
  let code = "";
  let source = "";

  if (accountingRole === ACCOUNTING_ROLE.SGDP) {
    code = String(maps.sgdpAccount || "").trim();
    source = code ? "taxSgkAccountMappings.sgdpAccount" : "";
  } else if (accountingRole === ACCOUNTING_ROLE.ISSIZLIK) {
    code = String(maps.unemploymentAccount || "").trim();
    source = code ? "taxSgkAccountMappings.unemploymentAccount" : "";
  } else if (accountingRole === ACCOUNTING_ROLE.SGK_INCENTIVE_INCOME) {
    code = String(maps.sgkIncentiveIncomeAccount || "").trim();
    source = code ? "taxSgkAccountMappings.sgkIncentiveIncomeAccount" : "";
  } else {
    code = String(maps.sgkMainAccount || "").trim();
    source = code ? "taxSgkAccountMappings.sgkMainAccount" : "";
  }

  if (!code && preferPlanHints && Array.isArray(companyPlans) && companyPlans.length) {
    const hint = findPlanHintForRole(companyPlans, accountingRole);
    if (hint) {
      code = hint.code;
      source = "plan_name_hint";
    }
  }

  if (!code) {
    return {
      mapped_account_code: "",
      mapping_status: MAPPING_STATUS.MANUAL,
      source: "",
      accounting_role: accountingRole,
    };
  }

  return {
    mapped_account_code: code,
    mapping_status: MAPPING_STATUS.MAPPED,
    source,
    accounting_role: accountingRole,
  };
}

function findPlanHintForRole(plans, role) {
  const needles =
    role === ACCOUNTING_ROLE.SGDP
      ? ["SGDP", "DESTEK PRIM"]
      : role === ACCOUNTING_ROLE.ISSIZLIK
        ? ["ISSIZLIK"]
        : role === ACCOUNTING_ROLE.SGK_INCENTIVE_INCOME
          ? ["TESVIK", "602"]
          : ["SGK PRIM", "361.01"];

  for (const row of plans) {
    if (row?.isActive === false) continue;
    const code = String(row.accountCode || row.hesapKodu || "").trim();
    const name = String(row.accountName || row.hesapAdi || "").toUpperCase();
    if (!code) continue;
    if (role === ACCOUNTING_ROLE.SGK_INCENTIVE_INCOME) {
      if (!code.startsWith("602")) continue;
    } else if (!(code === "361" || code.startsWith("361."))) {
      continue;
    }
    if (needles.some((n) => name.includes(n) || code.includes(n.replace(/\s/g, "")))) {
      return { code, name };
    }
  }
  return null;
}

/**
 * Tahakkuk satırına SGK rolü + eşleme uygula (immutable return).
 */
export function applySgkLineMapping(line = {}, context = {}) {
  const role = resolveSgkAccountingRole({
    lawCode: line.law_code,
    description: line.description,
    forcedRole: line.accounting_role,
  });
  const mapped = resolveSgkMappedAccount({
    accountingRole: role,
    taxSgkAccountMappings: context.taxSgkAccountMappings,
    companyPlans: context.companyPlans,
  });
  return {
    ...line,
    accounting_role: role,
    mapped_account_code: mapped.mapped_account_code,
    mapping_status: mapped.mapping_status,
  };
}
