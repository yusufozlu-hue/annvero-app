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
export const BALANCE_EMPTY = "BALANCE_EMPTY";

const TOLERANCE = 0.05;

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function signedAmount(tx = {}) {
  if (tx.amount != null && tx.amount !== "" && Number.isFinite(Number(tx.amount))) {
    return Number(tx.amount);
  }
  const debit = Math.abs(Number(tx.debit_amount ?? tx.borc) || 0);
  const credit = Math.abs(Number(tx.credit_amount ?? tx.alacak) || 0);
  const dir = String(tx.direction || tx.yon || "").toUpperCase();
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
  if (!txs.length) return { openingBalance: null, closingBalance: null, source: null };

  const withBal = txs.filter((tx) => {
    const b = tx.balance ?? tx.bakiye;
    return b !== "" && b != null && Number.isFinite(Number(b));
  });
  if (withBal.length < 1) {
    return { openingBalance: null, closingBalance: null, source: null };
  }

  const first = withBal[0];
  const last = withBal[withBal.length - 1];
  const firstBal = Number(first.balance ?? first.bakiye);
  const lastBal = Number(last.balance ?? last.bakiye);
  const opening = Number((firstBal - signedAmount(first)).toFixed(2));
  const closing = Number(lastBal.toFixed(2));
  if (!Number.isFinite(opening) || !Number.isFinite(closing)) {
    return { openingBalance: null, closingBalance: null, source: null };
  }
  return {
    openingBalance: opening,
    closingBalance: closing,
    source: "running_balance",
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

  if (opening == null || closing == null) {
    const derived = deriveBalanceHintsFromTransactions(txs);
    if (opening == null) opening = derived.openingBalance;
    if (closing == null) closing = derived.closingBalance;
    if (derived.source) evidenceSource = derived.source;
  }

  if (opening == null || closing == null) {
    return {
      ok: true,
      code: BALANCE_EVIDENCE_MISSING,
      delta: null,
      reviewRequired: false,
      matched: false,
      message:
        "Açılış/kapanış bakiyesi kanıtı bulunamadı. Mutabakat doğrulanmadı; sahte eşleşme üretilmedi.",
      signModel: "opening + credits - debits = closing",
      openingBalance: opening,
      closingBalance: closing,
      evidenceSource: null,
    };
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
  const expected = Number((opening + credits - debits).toFixed(2));
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
  };
}
