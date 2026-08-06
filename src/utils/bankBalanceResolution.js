/**
 * Bakiye Uyuşmazlığı Çözüm Merkezi — saf ve tenant-bağımsız hesaplama.
 * Ham açıklama/kimlik/payload üretmez; UI yalnız maskeli satırları gösterir.
 */

import {
  BALANCE_MATCHED,
  reconcileStatementBalances,
} from "@/src/utils/bankBalanceReconcile.js";
import {
  buildSafeMovementPreviewRows,
} from "@/src/utils/bankBalanceMismatchReview.js";

export const BALANCE_RESOLUTION_REASON = Object.freeze({
  OPENING_OVERRIDE: "opening_override",
  CLOSING_OVERRIDE: "closing_override",
  MOVEMENT_EXCLUDED: "movement_excluded",
  DIRECTION_CORRECTED: "direction_corrected",
});

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeKey(row = {}, index = 0) {
  const page = finiteOrNull(row.sourcePage ?? row.page) ?? 0;
  const line =
    finiteOrNull(
      row.sourceRow ??
        row.sourceLine ??
        row.excelRowNumber ??
        row.line
    ) ?? index + 1;
  return `p${page}:l${line}:i${index + 1}`;
}

function readSignedAmount(row = {}) {
  const direct = finiteOrNull(row.amount ?? row.tutar);
  if (direct != null) return direct;
  const debit = Math.abs(finiteOrNull(row.debit_amount ?? row.borc) ?? 0);
  const credit = Math.abs(finiteOrNull(row.credit_amount ?? row.alacak) ?? 0);
  const direction = String(row.direction || row.yon || "").toUpperCase();
  if (direction === "CIKIS" || direction === "OUT" || direction === "DEBIT") {
    return -Math.abs(debit || credit);
  }
  if (direction === "GIRIS" || direction === "IN" || direction === "CREDIT") {
    return Math.abs(debit || credit);
  }
  if (debit > 0 && credit <= 0) return debit;
  if (credit > 0) return -credit;
  return 0;
}

function readDirection(row = {}) {
  return readSignedAmount(row) < 0 ? "debit" : "credit";
}

function withDirection(row = {}, direction = "") {
  const nextDirection = direction === "debit" ? "debit" : "credit";
  const amount = Math.abs(readSignedAmount(row));
  const isOut = nextDirection === "debit";
  return {
    ...row,
    amount: isOut ? -amount : amount,
    tutar: isOut ? -amount : amount,
    direction: isOut ? "CIKIS" : "GIRIS",
    yon: isOut ? "CIKIS" : "GIRIS",
    // ANNVERO kanonik/legacy modeli: borç alanı giriş, alacak alanı çıkış.
    debit_amount: isOut ? 0 : amount,
    credit_amount: isOut ? amount : 0,
    borc: isOut ? 0 : amount,
    alacak: isOut ? amount : 0,
  };
}

export function buildBalanceResolutionRows(movements = []) {
  const list = Array.isArray(movements) ? movements : [];
  return buildSafeMovementPreviewRows(list, list.length).map((safe, index) => ({
    ...safe,
    key: safeKey(list[index], index),
    included: true,
    direction: readDirection(list[index]),
    confidence:
      finiteOrNull(
        list[index]?.ocrConfidence ??
          list[index]?.confidence
      ) ?? (list[index]?.lowOcrConfidence ? 0.5 : 0.95),
    learningEligible: Boolean(
      list[index]?.safeGeneralizableBalanceRule === true
    ),
  }));
}

export function buildInitialBalanceResolutionDraft({
  balance = {},
  movements = [],
} = {}) {
  return {
    openingBalance: finiteOrNull(balance.openingBalance),
    closingBalance: finiteOrNull(balance.closingBalance),
    rows: buildBalanceResolutionRows(movements),
    userConfirmed: false,
    learnForCompany: buildBalanceResolutionRows(movements).some(
      (row) => row.learningEligible
    ),
  };
}

export function countBalanceResolutionChanges({
  draft = {},
  originalBalance = {},
  originalRows = [],
} = {}) {
  let count = 0;
  if (
    finiteOrNull(draft.openingBalance) !==
    finiteOrNull(originalBalance.openingBalance)
  ) {
    count += 1;
  }
  if (
    finiteOrNull(draft.closingBalance) !==
    finiteOrNull(originalBalance.closingBalance)
  ) {
    count += 1;
  }
  const originalByKey = new Map(
    (originalRows || []).map((row) => [row.key, row])
  );
  for (const row of draft.rows || []) {
    const original = originalByKey.get(row.key);
    if (!original) continue;
    if (Boolean(row.included) !== Boolean(original.included)) count += 1;
    if (String(row.direction) !== String(original.direction)) count += 1;
  }
  return count;
}

export function canApplyBalanceResolution({
  draft = {},
  originalBalance = {},
  originalRows = [],
} = {}) {
  const changeCount = countBalanceResolutionChanges({
    draft,
    originalBalance,
    originalRows,
  });
  const opening = finiteOrNull(draft.openingBalance);
  const closing = finiteOrNull(draft.closingBalance);
  return {
    allowed:
      changeCount > 0 &&
      Boolean(draft.userConfirmed) &&
      opening != null &&
      closing != null &&
      (draft.rows || []).some((row) => row.included),
    changeCount,
    openingValid: opening != null,
    closingValid: closing != null,
  };
}

export function applyBalanceResolution({
  movements = [],
  draft = {},
  originalBalance = {},
} = {}) {
  const originalRows = buildBalanceResolutionRows(movements);
  const permission = canApplyBalanceResolution({
    draft,
    originalBalance,
    originalRows,
  });
  if (!permission.allowed) {
    const error = new Error(
      "Geçerli bir değişiklik seçilip kullanıcı tarafından onaylanmalıdır."
    );
    error.code = "BALANCE_RESOLUTION_CONFIRMATION_REQUIRED";
    throw error;
  }

  const draftByKey = new Map((draft.rows || []).map((row) => [row.key, row]));
  const correctedMovements = [];
  const changes = [];
  for (let index = 0; index < movements.length; index += 1) {
    const source = movements[index];
    const original = originalRows[index];
    const rowDraft = draftByKey.get(original.key) || original;
    if (!rowDraft.included) {
      changes.push({
        reason: BALANCE_RESOLUTION_REASON.MOVEMENT_EXCLUDED,
        sourcePage: original.sourcePage,
        sourceLine: original.sourceLine,
      });
      continue;
    }
    let next = { ...source };
    if (rowDraft.direction !== original.direction) {
      next = withDirection(next, rowDraft.direction);
      changes.push({
        reason: BALANCE_RESOLUTION_REASON.DIRECTION_CORRECTED,
        sourcePage: original.sourcePage,
        sourceLine: original.sourceLine,
      });
    } else {
      next.amount = readSignedAmount(next);
    }
    correctedMovements.push(next);
  }

  const opening = finiteOrNull(draft.openingBalance);
  const closing = finiteOrNull(draft.closingBalance);
  if (opening !== finiteOrNull(originalBalance.openingBalance)) {
    changes.push({ reason: BALANCE_RESOLUTION_REASON.OPENING_OVERRIDE });
  }
  if (closing !== finiteOrNull(originalBalance.closingBalance)) {
    changes.push({ reason: BALANCE_RESOLUTION_REASON.CLOSING_OVERRIDE });
  }

  const balance = reconcileStatementBalances(correctedMovements, {
    openingBalance: opening,
    closingBalance: closing,
    source: "user_confirmed_resolution",
    openingEvidence: {
      source: "user_confirmed_resolution",
      sourcePage: originalBalance.openingEvidence?.sourcePage ?? null,
      sourceLine: originalBalance.openingEvidence?.sourceLine ?? null,
      confidence: 1,
    },
    closingEvidence: {
      source: "user_confirmed_resolution",
      sourcePage: originalBalance.closingEvidence?.sourcePage ?? null,
      sourceLine: originalBalance.closingEvidence?.sourceLine ?? null,
      confidence: 1,
    },
  });

  return {
    correctedMovements,
    balance,
    changes,
    changeCount: changes.length,
    matched: balance.code === BALANCE_MATCHED,
    learnForCompany:
      Boolean(draft.learnForCompany) &&
      (draft.rows || []).some(
        (row) => row.learningEligible && row.direction !==
          originalRows.find((original) => original.key === row.key)?.direction
      ),
  };
}

