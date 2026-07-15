/**
 * Banka hareketi ↔ tahakkuk eşleştirme (saf).
 * Otomatik uygulama yalnızca tek güçlü adayda.
 */
import { roundMoney } from "./normalize.js";
import { MATCH_STATUS, MATCH_TYPE } from "./types.js";

function normalizeText(value = "") {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C")
    .replace(/\s+/g, " ")
    .trim();
}

function amountClose(a, b, tol = 0.02) {
  return Math.abs(roundMoney(a) - roundMoney(b)) <= tol;
}

/**
 * Ödeme sinyalleri skorla.
 * Sıra: firma → tür → tahakkuk no → dönem → vade → ana tutar → ödenecek → tarih → açık durum → yakın tutar
 */
export function scoreAccrualCandidate(accrual = {}, payment = {}) {
  let score = 0;
  const reasons = [];

  if (
    payment.companyId &&
    accrual.company_id &&
    payment.companyId === accrual.company_id
  ) {
    score += 25;
    reasons.push("company");
  } else if (payment.companyId && accrual.company_id) {
    return { score: 0, reasons: ["company_mismatch"], hardReject: true };
  }

  const payType = String(payment.obligationType || "").toUpperCase();
  const accrType = String(accrual.obligation_type || "").toUpperCase();
  if (payType && accrType && payType === accrType) {
    score += 20;
    reasons.push("obligation_type");
  } else if (payType && accrType && payType !== accrType) {
    // SGK vs SGDP soft
    if (
      !(
        (payType === "SGK" && accrType === "SGDP") ||
        (payType === "SGDP" && accrType === "SGK")
      )
    ) {
      score -= 30;
      reasons.push("type_mismatch");
    }
  }

  const ref = String(payment.accrualNumber || payment.reference || "").trim();
  if (ref && accrual.accrual_number && ref === accrual.accrual_number) {
    score += 40;
    reasons.push("accrual_number");
  } else if (ref && accrual.document_reference && ref === accrual.document_reference) {
    score += 35;
    reasons.push("document_reference");
  }

  const period = String(payment.periodKey || "").trim();
  if (period && accrual.period_key && period === accrual.period_key) {
    score += 18;
    reasons.push("period");
  }

  if (payment.dueDate && accrual.due_date && payment.dueDate === accrual.due_date) {
    score += 10;
    reasons.push("due_date");
  }

  const payAmount = roundMoney(payment.amount);
  if (payAmount > 0) {
    if (amountClose(payAmount, accrual.total_payable)) {
      score += 22;
      reasons.push("total_payable");
    } else if (amountClose(payAmount, accrual.total_principal)) {
      score += 14;
      reasons.push("principal");
    } else if (
      Math.abs(payAmount - roundMoney(accrual.total_payable)) /
        Math.max(roundMoney(accrual.total_payable), 1) <
      0.05
    ) {
      score += 8;
      reasons.push("near_amount");
    }
  }

  if (accrual.status === "OPEN" || accrual.status === "PARTIALLY_PAID") {
    score += 6;
    reasons.push("open_status");
  } else if (accrual.status === "PAID") {
    score -= 15;
    reasons.push("already_paid");
  }

  const desc = normalizeText(payment.description || "");
  if (desc && accrual.accrual_number && desc.includes(accrual.accrual_number)) {
    score += 12;
    reasons.push("desc_accrual_no");
  }
  if (desc && period && desc.includes(period.replace("-", "/"))) {
    score += 6;
    reasons.push("desc_period");
  }

  return { score, reasons, hardReject: false };
}

export function findAccrualCandidates(accruals = [], payment = {}, { limit = 8 } = {}) {
  const ranked = [];
  for (const accrual of accruals || []) {
    const scored = scoreAccrualCandidate(accrual, payment);
    if (scored.hardReject) continue;
    if (scored.score < 20) continue;
    ranked.push({
      accrual,
      score: scored.score,
      reasons: scored.reasons,
      confidence: Math.min(98, scored.score),
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.accrual.id.localeCompare(b.accrual.id));
  return ranked.slice(0, Math.max(1, Number(limit) || 8));
}

/**
 * Tek güçlü aday: accrual_number hit VEYA score≥70 ve ikinci adaydan ≥15 fark
 */
export function decideAccrualMatch(accruals = [], payment = {}) {
  const candidates = findAccrualCandidates(accruals, payment);
  if (!candidates.length) {
    return {
      status: MATCH_STATUS.ACCRUAL_PENDING,
      matchType: null,
      selected: null,
      candidates: [],
      autoApply: false,
      confidence: 0,
    };
  }

  const top = candidates[0];
  const second = candidates[1];
  const hasNumber =
    top.reasons.includes("accrual_number") ||
    top.reasons.includes("document_reference");
  const strongAlone =
    hasNumber ||
    (top.score >= 70 && (!second || top.score - second.score >= 15));

  if (candidates.length > 1 && !strongAlone) {
    return {
      status: MATCH_STATUS.MULTIPLE_CANDIDATES,
      matchType: null,
      selected: null,
      candidates,
      autoApply: false,
      confidence: top.confidence,
    };
  }

  if (strongAlone) {
    return {
      status: MATCH_STATUS.FULL_MATCH,
      matchType: MATCH_TYPE.AUTO_STRONG,
      selected: top.accrual,
      candidates,
      autoApply: true,
      confidence: top.confidence,
    };
  }

  return {
    status: MATCH_STATUS.MANUAL_REVIEW,
    matchType: null,
    selected: null,
    candidates,
    autoApply: false,
    confidence: top.confidence,
  };
}

/**
 * Bir ödemenin birden fazla tahakkuku kapatması (tutar dağıtımı önerisi).
 * Otomatik onay yok — sadece plan.
 */
export function proposeMultiAccrualAllocation(accruals = [], paymentAmount = 0) {
  let remaining = roundMoney(paymentAmount);
  const allocations = [];
  const open = [...(accruals || [])].sort(
    (a, b) => roundMoney(a.total_payable) - roundMoney(b.total_payable)
  );
  for (const accrual of open) {
    if (remaining <= 0) break;
    const need = roundMoney(accrual.total_payable);
    const take = Math.min(need, remaining);
    allocations.push({
      accrual_id: accrual.id,
      matched_amount: take,
      remaining_on_accrual: roundMoney(need - take),
    });
    remaining = roundMoney(remaining - take);
  }
  return {
    allocations,
    unmatched_amount: remaining,
    matchType: MATCH_TYPE.MULTI_ACCRUAL,
  };
}

/**
 * Bir tahakkukun birden fazla ödemeyle kapanması.
 */
export function proposeMultiPaymentCoverage(accrual = {}, payments = []) {
  const need = roundMoney(accrual.total_payable);
  let covered = 0;
  const links = [];
  for (const p of payments || []) {
    if (covered >= need) break;
    const amt = roundMoney(p.amount);
    const take = Math.min(amt, roundMoney(need - covered));
    links.push({
      movement_id: p.movementId || p.id,
      matched_amount: take,
    });
    covered = roundMoney(covered + take);
  }
  return {
    accrual_id: accrual.id,
    covered_amount: covered,
    remaining_amount: roundMoney(Math.max(0, need - covered)),
    links,
    matchType: MATCH_TYPE.MULTI_PAYMENT,
    fullyCovered: covered + 0.009 >= need,
  };
}
