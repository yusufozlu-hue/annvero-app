/**
 * Banka ekstresi açılış/kapanış bakiyesi mutabakatı.
 *
 * İşaret modeli (ekstre satır tutarları):
 * - GIRIS / alacak → hesaba giriş (+), alacaklar toplamına eklenir
 * - CIKIS / borç   → hesaptan çıkış (−), borçlar toplamına eklenir
 * Denklem: açılış + alacaklar − borçlar = kapanış
 *        ≡ açılış + Σ(signed amount) = kapanış
 */

export const BALANCE_MATCHED = "BALANCE_MATCHED";
export const BALANCE_MISMATCH = "BALANCE_MISMATCH";
export const BALANCE_EVIDENCE_MISSING = "BALANCE_EVIDENCE_MISSING";
export const MISSING_OPENING_BALANCE = "MISSING_OPENING_BALANCE";
export const MISSING_CLOSING_BALANCE = "MISSING_CLOSING_BALANCE";
export const BALANCE_EMPTY = "BALANCE_EMPTY";

const TOLERANCE = 0.05;

function toNum(value) {
  // Number(null) === 0 — must not treat missing hints as statement open/close 0,00
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function signedAmount(tx = {}) {
  if (tx.amount != null && tx.amount !== "" && Number.isFinite(Number(tx.amount))) {
    return Number(tx.amount);
  }
  const debitRaw = toNum(tx.debit_amount ?? tx.borc);
  const creditRaw = toNum(tx.credit_amount ?? tx.alacak);
  const debit = Math.abs(debitRaw ?? 0);
  const credit = Math.abs(creditRaw ?? 0);
  const dir = String(tx.direction || tx.yon || "").toUpperCase();
  // Ownership-unresolved receipt movements must not invent statement math.
  if (dir === "UNKNOWN" || dir === "BILINMIYOR" || dir === "UNRESOLVED") return 0;
  if (dir === "CIKIS" || dir === "OUT" || dir === "DEBIT") return -Math.abs(debit || credit);
  if (dir === "GIRIS" || dir === "IN" || dir === "CREDIT") return Math.abs(debit || credit);
  if (credit > 0 && debit <= 0) return -credit;
  if (debit > 0) return debit;
  return 0;
}

/**
 * Çalışan bakiyeden açılış/kapanış türet (satır bakiyesi işlem SONRASI kabul edilir).
 */
export function deriveBalanceHintsFromTransactions(transactions = []) {
  const txs = (transactions || []).filter(Boolean);
  if (!txs.length) {
    return {
      openingBalance: null,
      closingBalance: null,
      source: null,
      openingEvidence: null,
      closingEvidence: null,
    };
  }

  const withBal = txs.filter((tx) => {
    const b = tx.balance ?? tx.bakiye;
    return b !== "" && b != null && Number.isFinite(Number(b));
  });
  if (withBal.length < 1) {
    return {
      openingBalance: null,
      closingBalance: null,
      source: null,
      openingEvidence: null,
      closingEvidence: null,
    };
  }

  const first = withBal[0];
  const last = withBal[withBal.length - 1];
  const firstBal = Number(first.balance ?? first.bakiye);
  const lastBal = Number(last.balance ?? last.bakiye);
  const opening = Number((firstBal - signedAmount(first)).toFixed(2));
  const closing = Number(lastBal.toFixed(2));
  if (!Number.isFinite(opening) || !Number.isFinite(closing)) {
    return {
      openingBalance: null,
      closingBalance: null,
      source: null,
      openingEvidence: null,
      closingEvidence: null,
    };
  }
  const sourceOf = (tx, confidence) => ({
    source: "running_balance",
    sourcePage: toNum(tx.sourcePage ?? tx.page),
    sourceLine: toNum(tx.sourceRow ?? tx.sourceLine ?? tx.line),
    confidence,
  });
  return {
    openingBalance: opening,
    closingBalance: closing,
    source: "running_balance",
    openingEvidence: sourceOf(first, 0.9),
    // Son geçerli hareket bakiyesi ekstre kapanışına en güçlü satır kanıtıdır.
    closingEvidence: sourceOf(last, 0.95),
  };
}

/**
 * @param {object[]} transactions
 * @param {{ openingBalance?: number|null, closingBalance?: number|null }} hints
 */
export function reconcileStatementBalances(transactions = [], hints = {}) {
  const txs = [...(transactions || [])];
  if (!txs.length) {
    return {
      ok: true,
      code: BALANCE_EMPTY,
      delta: 0,
      reviewRequired: false,
      matched: false,
      signModel: "opening + credits - debits = closing",
      openingBalance: null,
      closingBalance: null,
      credits: 0,
      debits: 0,
    };
  }

  let opening = toNum(hints.openingBalance);
  let closing = toNum(hints.closingBalance);
  let evidenceSource = hints.source || (opening != null && closing != null ? "hints" : null);
  let openingEvidence = hints.openingEvidence || null;
  let closingEvidence = hints.closingEvidence || null;

  if (opening == null || closing == null) {
    const derived = deriveBalanceHintsFromTransactions(txs);
    if (opening == null) {
      opening = derived.openingBalance;
      openingEvidence = derived.openingEvidence;
    }
    if (closing == null) {
      closing = derived.closingBalance;
      closingEvidence = derived.closingEvidence;
    }
    if (derived.source) evidenceSource = derived.source;
  }

  let credits = 0;
  let debits = 0;
  for (const tx of txs) {
    const signed = signedAmount(tx);
    if (signed >= 0) credits += signed;
    else debits += Math.abs(signed);
  }
  credits = Number(credits.toFixed(2));
  debits = Number(debits.toFixed(2));
  const expected =
    opening == null ? null : Number((opening + credits - debits).toFixed(2));

  if (opening == null || closing == null) {
    const code =
      opening == null && closing == null
        ? BALANCE_EVIDENCE_MISSING
        : closing == null
          ? MISSING_CLOSING_BALANCE
          : MISSING_OPENING_BALANCE;
    return {
      ok: false,
      code,
      delta: null,
      reviewRequired: true,
      matched: false,
      message:
        code === MISSING_CLOSING_BALANCE
          ? "Ekstre kapanış bakiyesi bulunamadı (MISSING_CLOSING_BALANCE). Mutabakat doğrulanmadı; 0,00 değeri uydurulmadı."
          : code === MISSING_OPENING_BALANCE
            ? "Ekstre açılış bakiyesi bulunamadı (MISSING_OPENING_BALANCE). Mutabakat doğrulanmadı; 0,00 değeri uydurulmadı."
            : "Açılış/kapanış bakiyesi kanıtı bulunamadı. Mutabakat doğrulanmadı; sahte eşleşme üretilmedi.",
      signModel: "opening + credits - debits = closing",
      openingBalance: opening,
      closingBalance: closing,
      credits,
      debits,
      expectedClosing: expected,
      evidenceSource,
      openingEvidence,
      closingEvidence,
    };
  }
  const delta = Number((expected - closing).toFixed(2));

  if (Math.abs(delta) > TOLERANCE) {
    return {
      ok: false,
      code: BALANCE_MISMATCH,
      delta,
      reviewRequired: true,
      matched: false,
      message:
        "Açılış/kapanış bakiyesi hareket toplamı ile uyuşmuyor. Otomatik fiş üretilmedi; inceleme gerekli.",
      signModel: "opening + credits - debits = closing",
      openingBalance: opening,
      closingBalance: closing,
      credits,
      debits,
      expectedClosing: expected,
      evidenceSource,
      openingEvidence,
      closingEvidence,
    };
  }

  return {
    ok: true,
    code: BALANCE_MATCHED,
    delta: 0,
    reviewRequired: false,
    matched: true,
    signModel: "opening + credits - debits = closing",
    openingBalance: opening,
    closingBalance: closing,
    credits,
    debits,
    expectedClosing: expected,
    evidenceSource,
    openingEvidence,
    closingEvidence,
  };
}

const BALANCE_FAILURE_CODES = new Set([
  BALANCE_MISMATCH,
  BALANCE_EVIDENCE_MISSING,
  MISSING_OPENING_BALANCE,
  MISSING_CLOSING_BALANCE,
  BALANCE_EMPTY,
]);

/**
 * Output gate için kanonik bakiye sonucu.
 * - BALANCE_MATCHED kodu → başarı (PDF reconcile güvenilir)
 * - boş kod + matched=true yalnız açılış/kapanış + delta≈0 ile yükseltilir
 * - unknown / evidence yok → başarı sayılmaz
 */
export function normalizeBankBalanceForOutputGate(input = {}) {
  const codeRaw = String(input.balanceCode || input.code || "").trim();
  const matchedFlag =
    input.balanceMatched === true || input.matched === true;
  const opening = toNum(
    input.openingBalance ?? input.opening ?? input.statementOpeningBalance
  );
  const closing = toNum(
    input.closingBalance ?? input.closing ?? input.statementClosingBalance
  );
  const deltaRaw = input.delta;
  const deltaNum =
    deltaRaw == null || deltaRaw === ""
      ? null
      : Number.isFinite(Number(deltaRaw))
        ? Number(deltaRaw)
        : null;
  const deltaOk =
    deltaNum != null && Number.isFinite(deltaNum) && Math.abs(deltaNum) <= TOLERANCE;
  const hasOpenClose = opening != null && closing != null;

  if (BALANCE_FAILURE_CODES.has(codeRaw)) {
    return {
      balanceCode: codeRaw,
      balanceMatched: false,
      balanceMismatch: codeRaw === BALANCE_MISMATCH,
      delta: deltaNum,
      openingBalance: opening,
      closingBalance: closing,
      normalizedFrom: "explicit_failure",
    };
  }

  if (codeRaw === BALANCE_MATCHED) {
    if (deltaNum != null && !deltaOk) {
      return {
        balanceCode: BALANCE_MISMATCH,
        balanceMatched: false,
        balanceMismatch: true,
        delta: deltaNum,
        openingBalance: opening,
        closingBalance: closing,
        normalizedFrom: "matched_code_nonzero_delta",
      };
    }
    return {
      balanceCode: BALANCE_MATCHED,
      balanceMatched: true,
      balanceMismatch: false,
      delta: deltaNum == null ? 0 : deltaNum,
      openingBalance: opening,
      closingBalance: closing,
      normalizedFrom: "canonical_matched_code",
    };
  }

  // Boş/bilinmeyen kod: yalnız açık matched + sayısal fark 0 + açılış/kapanış
  if (matchedFlag && deltaOk && hasOpenClose) {
    return {
      balanceCode: BALANCE_MATCHED,
      balanceMatched: true,
      balanceMismatch: false,
      delta: deltaNum,
      openingBalance: opening,
      closingBalance: closing,
      normalizedFrom: "matched_flag_with_evidence",
    };
  }

  if (matchedFlag && !codeRaw) {
    return {
      balanceCode: BALANCE_EVIDENCE_MISSING,
      balanceMatched: false,
      balanceMismatch: false,
      delta: deltaNum,
      openingBalance: opening,
      closingBalance: closing,
      normalizedFrom: "matched_without_evidence",
    };
  }

  if (deltaNum != null && !deltaOk && hasOpenClose) {
    return {
      balanceCode: BALANCE_MISMATCH,
      balanceMatched: false,
      balanceMismatch: true,
      delta: deltaNum,
      openingBalance: opening,
      closingBalance: closing,
      normalizedFrom: "nonzero_delta",
    };
  }

  return {
    balanceCode: codeRaw || BALANCE_EVIDENCE_MISSING,
    balanceMatched: false,
    balanceMismatch: false,
    delta: deltaNum,
    openingBalance: opening,
    closingBalance: closing,
    normalizedFrom: "unknown_or_incomplete",
  };
}

/**
 * Parse stage / balanceResult → gate girdisi (tek giriş noktası).
 */
export function resolveBalanceInputForOutputGate({
  balanceResult = null,
  parsingStage = null,
} = {}) {
  return normalizeBankBalanceForOutputGate({
    balanceCode:
      balanceResult?.code ||
      balanceResult?.balanceCode ||
      parsingStage?.balanceCode ||
      "",
    balanceMatched:
      balanceResult?.matched === true ||
      balanceResult?.balanceMatched === true ||
      parsingStage?.balanceMatched === true,
    delta:
      balanceResult?.delta ??
      parsingStage?.balanceDelta ??
      parsingStage?.delta,
    openingBalance:
      balanceResult?.openingBalance ?? parsingStage?.openingBalance,
    closingBalance:
      balanceResult?.closingBalance ?? parsingStage?.closingBalance,
  });
}
