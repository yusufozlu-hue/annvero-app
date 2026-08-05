/**
 * Bakiye uyuşmazlığı — parse-OK review_required sonucu (teknik hata değil).
 * Güvenli UI özeti: IBAN / VKN / ham açıklama / PDF metni yok.
 */

import { BALANCE_MISMATCH } from "@/src/utils/bankBalanceReconcile";
import { V1_JOB_STATE } from "@/src/utils/annveroV1Orchestration";

export const BALANCE_MISMATCH_UI_MESSAGE =
  "Bakiye uyuşmazlığı — otomatik fiş üretilmedi, inceleme gerekli";

export const DUPLICATE_CONTENT = "DUPLICATE_CONTENT";

/** @param {unknown} value */
function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Açıklamayı maskele — IBAN / uzun sayı / fazla metin yok.
 * @param {unknown} raw
 */
export function maskBankMovementDescription(raw) {
  let text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "—";
  text = text
    .replace(/\bTR\d{2}[\d\s]{10,}\b/gi, "TR**")
    .replace(/\b\d{10,}\b/g, (m) => `${m.slice(0, 2)}****${m.slice(-2)}`);
  if (text.length > 42) text = `${text.slice(0, 40)}…`;
  return text || "—";
}

function movementDirection(row = {}) {
  const dir = String(row.direction || row.yon || "").toUpperCase();
  if (dir === "CIKIS" || dir === "OUT" || dir === "DEBIT") return "debit";
  if (dir === "GIRIS" || dir === "IN" || dir === "CREDIT") return "credit";
  const debit = Math.abs(Number(row.debit_amount ?? row.borc) || 0);
  const credit = Math.abs(Number(row.credit_amount ?? row.alacak) || 0);
  if (debit > 0 && credit <= 0) return "debit";
  if (credit > 0 && debit <= 0) return "credit";
  const amount = Number(row.amount);
  if (Number.isFinite(amount) && amount < 0) return "debit";
  if (Number.isFinite(amount) && amount > 0) return "credit";
  return "";
}

function movementAmount(row = {}) {
  const debit = Math.abs(Number(row.debit_amount ?? row.borc) || 0);
  const credit = Math.abs(Number(row.credit_amount ?? row.alacak) || 0);
  if (debit > 0) return debit;
  if (credit > 0) return credit;
  const amount = Number(row.amount);
  return Number.isFinite(amount) ? Math.abs(amount) : null;
}

/**
 * @param {object[]} movements
 * @param {number} [limit]
 */
export function buildSafeMovementPreviewRows(movements = [], limit = 5) {
  const list = Array.isArray(movements) ? movements : [];
  const capped = list.slice(0, Math.max(0, Number(limit) || 5));
  return capped.map((row, index) => {
    const page =
      row.page ??
      row.sourcePage ??
      row._sourcePage ??
      row.source?.page ??
      null;
    const line =
      row.line ??
      row.sourceLine ??
      row._sourceLine ??
      row.source?.line ??
      index + 1;
    return {
      index: index + 1,
      date: String(row.date || row.transactionDate || row.islemTarihi || "—").slice(
        0,
        16
      ),
      description: maskBankMovementDescription(
        row.description || row.aciklama || row.narration || ""
      ),
      direction: movementDirection(row),
      amount: movementAmount(row),
      balance: toFiniteNumber(row.balance ?? row.bakiye),
      sourcePage: page != null && Number.isFinite(Number(page)) ? Number(page) : null,
      sourceLine: line != null && Number.isFinite(Number(line)) ? Number(line) : null,
    };
  });
}

/**
 * Sonuç kartı / persist için güvenli bakiye-uyuşmazlığı özeti.
 * @param {{ balance?: object, movements?: object[], contentHash?: string }} opts
 */
export function buildBalanceMismatchReviewPayload({
  balance = null,
  movements = [],
  contentHash = "",
} = {}) {
  const list = Array.isArray(movements) ? movements : [];
  const preview = buildSafeMovementPreviewRows(list, 5);
  return {
    code: BALANCE_MISMATCH,
    balanceMismatch: true,
    reviewRequired: true,
    canAutoApprove: false,
    terminalStatus: V1_JOB_STATE.REVIEW_REQUIRED,
    message: BALANCE_MISMATCH_UI_MESSAGE,
    movementCount: list.length,
    openingBalance: toFiniteNumber(balance?.openingBalance),
    totalDebit: toFiniteNumber(balance?.debits),
    totalCredit: toFiniteNumber(balance?.credits),
    computedClosingBalance: toFiniteNumber(balance?.expectedClosing),
    statementClosingBalance: toFiniteNumber(balance?.closingBalance),
    reconciliationDelta: toFiniteNumber(balance?.delta),
    movementPreview: preview,
    hasMoreMovements: list.length > preview.length,
    contentHashPresent: Boolean(String(contentHash || "").trim()),
  };
}

/**
 * Persist edilmiş job geçmişinde aynı companyId+contentHash var mı?
 * BALANCE_MISMATCH / review_required kayıtları da mükerrer kapsamındadır.
 */
export function findPriorJobByContentHash(runs = [], { companyId, contentHash, idempotencyKey } = {}) {
  const key = String(idempotencyKey || "").trim();
  const hash = String(contentHash || "").trim();
  const company = String(companyId || "").trim();
  if (!key && !hash) return null;
  const list = Array.isArray(runs) ? runs : [];
  return (
    list.find((row) => {
      const meta = row?.metadata || {};
      const rowCompany = String(row?.companyId || row?.company_id || "").trim();
      if (company && rowCompany && rowCompany !== company) return false;
      if (key && String(meta.idempotency_key || "") === key) return true;
      if (hash && String(meta.content_hash || meta.source_file_hash || "") === hash) {
        return true;
      }
      return false;
    }) || null
  );
}
