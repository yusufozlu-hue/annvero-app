/**
 * Oturum içi ekstre dedup — dosya hash'ten bağımsız hareket kimliği.
 */

import {
  dedupeCanonicalTransactions,
  legacyBankRowsToCanonical,
  buildSourceFileHash,
} from "@/src/utils/bankCanonicalTransaction";

export const DUPLICATE_STATEMENT_UI_MESSAGE =
  "Mükerrer ekstre — yeniden işlenmedi.";

/**
 * @param {object[]} legacyOrCanonicalRows
 * @param {Set<string>|string[]} existingKeys
 * @param {{ companyId?: string, selectedBank?: string, sourceFileHash?: string, sourceType?: string }} context
 */
export function applySessionMovementDedup(
  rows = [],
  existingKeys = new Set(),
  context = {}
) {
  const prior =
    existingKeys instanceof Set ? existingKeys : new Set(existingKeys || []);
  const looksCanonical = rows.some(
    (r) => r && (r.transactionId || r.sourceType || r.direction)
  );
  const canonical = looksCanonical
    ? rows
    : legacyBankRowsToCanonical(rows, context);

  const { unique, duplicates, seenKeys } = dedupeCanonicalTransactions(
    canonical,
    prior
  );

  const allDuplicate =
    canonical.length > 0 && unique.length === 0 && duplicates.length === canonical.length;
  const suppressedMovements = duplicates.length;
  // Luca çift satır varsayımı: hareket başına 2 fiş satırı
  const suppressedLucaRows = suppressedMovements * 2;

  return {
    unique,
    duplicates,
    seenKeys,
    inputCount: canonical.length,
    uniqueCount: unique.length,
    suppressedMovements,
    suppressedLucaRows,
    allDuplicate,
    uiMessage: allDuplicate ? DUPLICATE_STATEMENT_UI_MESSAGE : null,
    sourceFileHash: context.sourceFileHash || null,
  };
}

export function registerProcessedKeys(storeSet, keys) {
  const target = storeSet instanceof Set ? storeSet : new Set(storeSet || []);
  for (const key of keys || []) {
    if (key) target.add(key);
  }
  return target;
}

export function keysFromCanonical(transactions = []) {
  return (transactions || [])
    .map((tx) => tx?.transactionId)
    .filter(Boolean);
}

export { buildSourceFileHash };
