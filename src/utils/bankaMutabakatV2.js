import {
  MUTABAKAT_DURUM,
  MUTABAKAT_GRUP,
} from "@/src/utils/bankaMutabakat";

export const V2_BADGE = {
  MATCHED: "Eşleşti",
  SUGGESTION: "Öneri",
  MANUAL: "Manuel kontrol",
  UNMATCHED: "Eşleşmedi",
  AMOUNT_DIFF: "Tutar farkı",
  DATE_DIFF: "Tarih farkı",
  DUPLICATE: "Mükerrer olabilir",
};

export const V2_FILTER = {
  ALL: "all",
  MATCHED: "matched",
  UNMATCHED: "unmatched",
  SUSPICIOUS: "suspicious",
  AMOUNT_DIFF: "amount_diff",
  DATE_DIFF: "date_diff",
  BANK_ONLY: "bank_only",
  LEDGER_ONLY: "ledger_only",
};

export function resolveV2Badge(row = {}) {
  if (row.manualApproved || (row.isMatched && (row.guvenSkoru || 0) >= 90)) {
    return V2_BADGE.MATCHED;
  }

  if (row.durum === MUTABAKAT_DURUM.MUKERRER) {
    return V2_BADGE.DUPLICATE;
  }

  if (
    [MUTABAKAT_DURUM.TUTAR_FARKI, MUTABAKAT_DURUM.ACIKLAMA_BENZER_TUTAR_FARKLI].includes(
      row.durum
    )
  ) {
    return V2_BADGE.AMOUNT_DIFF;
  }

  if (row.durum === MUTABAKAT_DURUM.TARIH_FARKI) {
    return V2_BADGE.DATE_DIFF;
  }

  if (row.needsManualApproval && (row.guvenSkoru || 0) >= 85) {
    return V2_BADGE.SUGGESTION;
  }

  if (
    row.needsManualApproval ||
    ((row.guvenSkoru || 0) >= 60 && (row.guvenSkoru || 0) < 85)
  ) {
    return V2_BADGE.MANUAL;
  }

  if ((row.guvenSkoru || 0) >= 85) {
    return V2_BADGE.SUGGESTION;
  }

  if (!row.isMatched) {
    return V2_BADGE.UNMATCHED;
  }

  return V2_BADGE.MANUAL;
}

export function resolveScoreLabel(score = 0) {
  if (score >= 100) return "Tam eşleşme";
  if (score >= 85) return "Güçlü öneri";
  if (score >= 60) return "Manuel kontrol";
  return "Zayıf / eşleşmedi";
}

export function buildV2Kpis(summary = {}, rows = []) {
  const matchedRows = rows.filter((row) => row.isMatched);
  const unmatchedBank = rows.filter((row) => row.bankRow && !row.muavinRow).length;
  const unmatchedLedger = rows.filter((row) => row.muavinRow && !row.bankRow).length;
  const totalDifference = rows.reduce((sum, row) => sum + Math.abs(Number(row.fark || 0)), 0);
  const suspiciousCount =
    (summary.olasiEslesenCount || 0) +
    rows.filter((row) => row.needsManualApproval && !row.isMatched).length;
  const matchedCount = matchedRows.length;
  const bankCount = summary.bankCount || 0;
  const matchRate = bankCount > 0 ? Math.round((matchedCount / bankCount) * 100) : 0;

  return {
    totalBankMovements: bankCount,
    totalLedgerRecords: summary.muavinCount || 0,
    matchedRecords: matchedCount,
    unmatchedBankMovements: unmatchedBank,
    unmatchedLedgerRecords: unmatchedLedger,
    totalDifference,
    suspiciousRecords: suspiciousCount,
    matchRate,
  };
}

function findResultRowForSide(rows = [], side, transactionId) {
  return rows.find((row) =>
    side === "bank"
      ? row.bankRow?.id === transactionId
      : row.muavinRow?.id === transactionId
  );
}

export function buildDualPanelRows(rows = []) {
  const bankMap = new Map();
  const ledgerMap = new Map();

  rows.forEach((row) => {
    if (row.bankRow?.id && !bankMap.has(row.bankRow.id)) {
      bankMap.set(row.bankRow.id, {
        id: row.bankRow.id,
        side: "bank",
        tarih: row.bankaTarihi || row.bankRow.tarih,
        aciklama: row.bankaAciklama || row.bankRow.aciklama,
        tutar: row.bankaTutari,
        referans: row.bankRow.dekontNo || row.bankRow.evrakNo || "",
        badge: resolveV2Badge(row),
        score: row.guvenSkoru || 0,
        scoreLabel: resolveScoreLabel(row.guvenSkoru || 0),
        resultRowId: row.id,
        matchedLedgerId: row.muavinRow?.id || "",
        rawRow: row.bankRow,
        resultRow: row,
      });
    }

    if (row.muavinRow?.id && !ledgerMap.has(row.muavinRow.id)) {
      ledgerMap.set(row.muavinRow.id, {
        id: row.muavinRow.id,
        side: "ledger",
        tarih: row.muavinTarihi || row.muavinRow.tarih,
        aciklama: row.muavinAciklama || row.muavinRow.aciklama,
        tutar: row.muavinTutari,
        referans: row.muavinRow.evrakNo || row.muavinRow.fisNo || "",
        hesapKodu: row.muavinRow.hesapKodu || "",
        badge: resolveV2Badge(row),
        score: row.guvenSkoru || 0,
        scoreLabel: resolveScoreLabel(row.guvenSkoru || 0),
        resultRowId: row.id,
        matchedBankId: row.bankRow?.id || "",
        rawRow: row.muavinRow,
        resultRow: row,
      });
    }
  });

  return {
    bankRows: [...bankMap.values()],
    ledgerRows: [...ledgerMap.values()],
  };
}

export function filterV2PanelItem(item, filter = V2_FILTER.ALL) {
  if (filter === V2_FILTER.ALL) return true;

  const row = item.resultRow || {};
  const badge = item.badge;

  if (filter === V2_FILTER.MATCHED) {
    return row.isMatched || badge === V2_BADGE.MATCHED;
  }

  if (filter === V2_FILTER.UNMATCHED) {
    return !row.isMatched || badge === V2_BADGE.UNMATCHED;
  }

  if (filter === V2_FILTER.SUSPICIOUS) {
    return (
      badge === V2_BADGE.SUGGESTION ||
      badge === V2_BADGE.MANUAL ||
      badge === V2_BADGE.DUPLICATE ||
      row.needsManualApproval
    );
  }

  if (filter === V2_FILTER.AMOUNT_DIFF) {
    return badge === V2_BADGE.AMOUNT_DIFF;
  }

  if (filter === V2_FILTER.DATE_DIFF) {
    return badge === V2_BADGE.DATE_DIFF;
  }

  if (filter === V2_FILTER.BANK_ONLY) {
    return item.side === "bank" && !item.matchedLedgerId;
  }

  if (filter === V2_FILTER.LEDGER_ONLY) {
    return item.side === "ledger" && !item.matchedBankId;
  }

  return true;
}

export function findResultRowByTransactionId(rows = [], bankId, ledgerId) {
  return rows.find(
    (row) => row.bankRow?.id === bankId && row.muavinRow?.id === ledgerId
  );
}

export async function persistReconciliationMatch(payload) {
  try {
    const response = await fetch("/api/reconciliation-matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return null;
    const result = await response.json();
    return result.data;
  } catch {
    return null;
  }
}

export async function persistLearnedBankRule(payload = {}) {
  try {
    const body = {
      company_id: payload.company_id || payload.companyId,
      bank_id: payload.bank_id || payload.bankId || null,
      bank_description_pattern:
        payload.bank_description_pattern || payload.bankDescriptionPattern,
      ledger_account_code: payload.ledger_account_code || payload.ledgerAccountCode || null,
      ledger_account_name: payload.ledger_account_name || payload.ledgerAccountName || null,
      transaction_type: payload.transaction_type || payload.transactionType || null,
      document_type: payload.document_type || payload.documentType || null,
    };

    if (!body.company_id || !body.bank_description_pattern) return null;

    const response = await fetch("/api/learned-bank-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) return null;
    const result = await response.json();
    return result.data;
  } catch {
    return null;
  }
}

export function badgeClassName(badge) {
  if (badge === V2_BADGE.MATCHED) return "bg-emerald-900/60 text-emerald-100";
  if (badge === V2_BADGE.SUGGESTION) return "bg-sky-900/60 text-sky-100";
  if (badge === V2_BADGE.MANUAL) return "bg-amber-900/60 text-amber-100";
  if (badge === V2_BADGE.AMOUNT_DIFF || badge === V2_BADGE.DATE_DIFF) {
    return "bg-orange-900/60 text-orange-100";
  }
  if (badge === V2_BADGE.DUPLICATE) return "bg-purple-900/60 text-purple-100";
  return "bg-red-900/60 text-red-100";
}

export { findResultRowForSide, MUTABAKAT_GRUP };
