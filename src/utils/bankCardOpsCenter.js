/**
 * Banka & Kart Operasyon Merkezi — dashboard özetleri ve oturum deposu.
 * UI güzelleştirme yok; salt veri / metrik katmanı.
 */

import {
  RECOGNITION_STATUS,
  RECOGNITION_STATUS_LABELS,
  summarizeRecognitionStatuses,
  toPersistedFinancialTransaction,
} from "@/src/models/normalizedFinancialTransaction";
import {
  filterReadyForVoucherTransactions,
  filterUnknownTransactions,
} from "@/src/utils/financialRecognitionPipeline";

export const BANK_CARD_OPS_SESSION_KEY = "annvero_bank_card_ops_session_v1";

export function buildBankCardOpsDashboard(transactions = [], extras = {}) {
  const summary = summarizeRecognitionStatuses(transactions);
  const ready = filterReadyForVoucherTransactions(transactions);
  const unknown = filterUnknownTransactions(transactions);

  return {
    title: "Banka & Kart Operasyon Merkezi",
    generated_at: new Date().toISOString(),
    company_id: extras.companyId || "",
    bank_name: extras.bankName || "",
    source_file_name: extras.sourceFileName || "",
    metrics: {
      total: summary.total,
      recognized: summary.recognized,
      unknown: summary.unknown,
      suggested: summary.suggested,
      risky: summary.risky,
      duplicate: summary.duplicate,
      ready_for_voucher: summary.ready_for_voucher,
      ready_for_luca: ready.length,
      unknown_queue: unknown.length,
    },
    labels: {
      total: "Toplam hareket",
      recognized: "Tanınan işlem",
      unknown: "Tanınmayan işlem",
      suggested: "Önerilen işlem",
      risky: "Riskli işlem",
      duplicate: "Mükerrer şüpheli işlem",
      ready_for_voucher: "Luca fişine hazır işlem",
    },
    status_labels: RECOGNITION_STATUS_LABELS,
    ready_for_voucher_ids: ready.map((tx) => tx.id),
    unknown_ids: unknown.map((tx) => tx.id),
  };
}

export function saveBankCardOpsSession(payload = {}) {
  if (typeof window === "undefined") return false;
  try {
    const transactions = (payload.transactions || []).map(toPersistedFinancialTransaction);
    const session = {
      saved_at: new Date().toISOString(),
      company_id: payload.company_id || "",
      bank_name: payload.bank_name || "",
      source_file_name: payload.source_file_name || "",
      dashboard: payload.dashboard || buildBankCardOpsDashboard(transactions, {
        companyId: payload.company_id,
        bankName: payload.bank_name,
        sourceFileName: payload.source_file_name,
      }),
      transactions,
      declarationSummary: payload.declarationSummary || null,
    };
    localStorage.setItem(BANK_CARD_OPS_SESSION_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function loadBankCardOpsSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BANK_CARD_OPS_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearBankCardOpsSession() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(BANK_CARD_OPS_SESSION_KEY);
  } catch {
    // ignore
  }
}

export function markTransactionsReadyForLuca(transactions = [], ids = null) {
  const idSet = ids ? new Set(ids) : null;
  return transactions.map((tx) => {
    if (idSet && !idSet.has(tx.id)) return tx;
    if (
      tx.suggested_account_code &&
      tx.suggested_counter_account_code &&
      !(tx.risk_flags || []).includes("duplicate")
    ) {
      return {
        ...tx,
        recognition_status: RECOGNITION_STATUS.READY_FOR_VOUCHER,
        updated_at: new Date().toISOString(),
      };
    }
    return tx;
  });
}
