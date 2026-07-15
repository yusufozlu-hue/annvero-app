/**
 * Ödeme senaryoları A–E.
 * Tutar farkından otomatik 602 / ceza tahmini YOK.
 */
import { roundMoney } from "./normalize.js";
import {
  ACCOUNTING_ROLE,
  MATCH_STATUS,
  PAYMENT_SCENARIO,
} from "./types.js";
import { resolveSgkMappedAccount } from "./sgkRules.js";

const TOL = 0.02;

/**
 * @param {object} input
 * @param {number} input.bankAmount — bankadan çıkan tutar
 * @param {object} input.accrual — normalize tahakkuk
 * @param {number} [input.verifiedSupportAmount] — ödeme anı destek (doğrulanmış)
 * @param {number} [input.verifiedIncentiveCancellationAmount] — teşvik iptali
 * @param {number} [input.verifiedLateFeeAmount]
 * @param {boolean} [input.assumePartial]
 * @param {boolean} [input.suspectMahsup]
 * @param {object} [input.taxSgkAccountMappings]
 */
export function classifyPaymentScenario(input = {}) {
  const bank = roundMoney(input.bankAmount);
  const payable = roundMoney(input.accrual?.total_payable ?? 0);
  const verifiedSupport = roundMoney(input.verifiedSupportAmount || 0);
  const verifiedCancel = roundMoney(
    input.verifiedIncentiveCancellationAmount || 0
  );
  const verifiedLate = roundMoney(input.verifiedLateFeeAmount || 0);
  const gap = roundMoney(bank - payable);

  // A) NORMAL
  if (Math.abs(gap) <= TOL) {
    return {
      scenario: PAYMENT_SCENARIO.NORMAL,
      status: MATCH_STATUS.FULL_MATCH,
      bankAmount: bank,
      accrualPayable: payable,
      gap: 0,
      incentive_income_amount: 0,
      incentive_cancellation_amount: 0,
      late_fee_amount: 0,
      unmatched_amount: 0,
      autoApplyIncentiveIncome: false,
      notes: [],
    };
  }

  // E) MAHSUP şüphesi
  if (input.suspectMahsup) {
    return {
      scenario: PAYMENT_SCENARIO.MAHSUP_OR_REALLOCATION,
      status: MATCH_STATUS.MANUAL_REVIEW,
      bankAmount: bank,
      accrualPayable: payable,
      gap,
      incentive_income_amount: 0,
      incentive_cancellation_amount: 0,
      late_fee_amount: 0,
      unmatched_amount: Math.abs(gap),
      autoApplyIncentiveIncome: false,
      notes: ["Mahsup / başka borca dağıtım — mutabakat kuyruğu"],
    };
  }

  // B) Banka > tahakkuk — teşvik iptali / gecikme; kör gecikme sayma
  if (gap > TOL) {
    if (verifiedCancel > 0 || verifiedLate > 0) {
      const explained = roundMoney(verifiedCancel + verifiedLate);
      const leftover = roundMoney(gap - explained);
      return {
        scenario: PAYMENT_SCENARIO.LATE_INCENTIVE_CANCEL,
        status:
          Math.abs(leftover) <= TOL
            ? MATCH_STATUS.FULL_MATCH
            : MATCH_STATUS.LATE_INCENTIVE_SUSPECT,
        bankAmount: bank,
        accrualPayable: payable,
        gap,
        incentive_income_amount: 0,
        incentive_cancellation_amount: verifiedCancel,
        late_fee_amount: verifiedLate,
        unmatched_amount: Math.max(0, leftover),
        autoApplyIncentiveIncome: false,
        notes: [
          "Teşvik iptali ile gecikme ayrıştırıldı (doğrulanmış tutarlar).",
          "Teşvik iptali 602’ye yazılmaz.",
        ],
      };
    }
    return {
      scenario: PAYMENT_SCENARIO.LATE_INCENTIVE_CANCEL,
      status: MATCH_STATUS.LATE_INCENTIVE_SUSPECT,
      bankAmount: bank,
      accrualPayable: payable,
      gap,
      incentive_income_amount: 0,
      incentive_cancellation_amount: 0,
      late_fee_amount: 0,
      unmatched_amount: gap,
      autoApplyIncentiveIncome: false,
      notes: [
        "Banka çıkışı tahakkuktan yüksek — otomatik gecikme/teşvik ayrımı yok.",
        "Farkın tamamını gecikme zammı sayma.",
      ],
    };
  }

  // C / D) Banka < tahakkuk
  const shortfall = roundMoney(payable - bank);

  // C) Doğrulanmış destek → 602 (firma eşlemesi zorunlu)
  if (verifiedSupport > 0) {
    const supportApply = Math.min(verifiedSupport, shortfall);
    const rest = roundMoney(shortfall - supportApply);
    const incentiveMap = resolveSgkMappedAccount({
      accountingRole: ACCOUNTING_ROLE.SGK_INCENTIVE_INCOME,
      taxSgkAccountMappings: input.taxSgkAccountMappings || {},
      companyPlans: input.companyPlans || [],
    });

    if (!incentiveMap.mapped_account_code) {
      return {
        scenario: PAYMENT_SCENARIO.PAYMENT_SUPPORT,
        status: MATCH_STATUS.SUPPORT_VERIFY_PENDING,
        bankAmount: bank,
        accrualPayable: payable,
        gap: -shortfall,
        incentive_income_amount: supportApply,
        incentive_cancellation_amount: 0,
        late_fee_amount: 0,
        unmatched_amount: rest,
        autoApplyIncentiveIncome: false,
        incentiveAccountCode: "",
        notes: [
          "Destek doğrulandı ancak sgkIncentiveIncomeAccount tanımlı değil — manuel seçim.",
        ],
      };
    }

    return {
      scenario: PAYMENT_SCENARIO.PAYMENT_SUPPORT,
      status:
        rest > TOL ? MATCH_STATUS.PARTIAL_PAYMENT : MATCH_STATUS.FULL_MATCH,
      bankAmount: bank,
      accrualPayable: payable,
      gap: -shortfall,
      incentive_income_amount: supportApply,
      incentive_cancellation_amount: 0,
      late_fee_amount: 0,
      unmatched_amount: rest,
      autoApplyIncentiveIncome: true,
      incentiveAccountCode: incentiveMap.mapped_account_code,
      notes: ["Doğrulanmış ödeme anı destek → firma 602 eşlemesi."],
    };
  }

  // Destek doğrulanmadı — 602 otomatik YOK (kullanıcı kuralı)
  if (input.assumePartial || shortfall > TOL) {
    // Kısa fark tek başına teşvik kabul edilmez
    return {
      scenario: PAYMENT_SCENARIO.PARTIAL,
      status: input.assumePartial
        ? MATCH_STATUS.PARTIAL_PAYMENT
        : MATCH_STATUS.UNRESOLVED_DIFFERENCE,
      bankAmount: bank,
      accrualPayable: payable,
      gap: -shortfall,
      incentive_income_amount: 0,
      incentive_cancellation_amount: 0,
      late_fee_amount: 0,
      unmatched_amount: shortfall,
      autoApplyIncentiveIncome: false,
      notes: [
        "Banka çıkışı tahakkuktan düşük; destek doğrulanmadı → 602 otomatik yok.",
        "Açık borç olarak takip / mutabakat.",
      ],
    };
  }

  return {
    scenario: PAYMENT_SCENARIO.MAHSUP_OR_REALLOCATION,
    status: MATCH_STATUS.MANUAL_REVIEW,
    bankAmount: bank,
    accrualPayable: payable,
    gap: -shortfall,
    incentive_income_amount: 0,
    incentive_cancellation_amount: 0,
    late_fee_amount: 0,
    unmatched_amount: shortfall,
    autoApplyIncentiveIncome: false,
    notes: ["Matematiksel fark teşvik kabul edilmedi."],
  };
}

/**
 * payment_match taslağı (DB’ye yazılmaz — saf obje).
 */
export function buildPaymentMatchDraft({
  accrual,
  movementId = "",
  scenarioResult,
  matchType = "MANUAL",
  approvedBy = "",
} = {}) {
  const s = scenarioResult || {};
  return {
    accrual_id: accrual?.id || "",
    movement_id: movementId,
    matched_amount: roundMoney(s.bankAmount || 0),
    principal_amount: roundMoney(accrual?.total_principal || 0),
    incentive_income_amount: roundMoney(s.incentive_income_amount || 0),
    incentive_cancellation_amount: roundMoney(
      s.incentive_cancellation_amount || 0
    ),
    penalty_amount: roundMoney(accrual?.total_penalty || 0),
    late_fee_amount: roundMoney(s.late_fee_amount || 0),
    unmatched_amount: roundMoney(s.unmatched_amount || 0),
    match_type: matchType,
    match_status: s.status || MATCH_STATUS.MANUAL_REVIEW,
    confidence: s.autoApplyIncentiveIncome || s.scenario === PAYMENT_SCENARIO.NORMAL ? 90 : 40,
    approved_by: approvedBy || "",
    approved_at: approvedBy ? new Date().toISOString() : "",
    scenario: s.scenario,
    incentive_account_code: s.incentiveAccountCode || "",
  };
}
