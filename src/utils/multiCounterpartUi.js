/**
 * Çoklu karşıt hesap ayrıntısı — UI state helpers (salt okunur modal).
 * Inline grup genişletmesi yok; teknik satırlar yalnız modal içinde.
 */
import { buildMultiCounterpartVoucherDetail } from "@/src/utils/multiCounterpartDetail";

/** Sözleşme: ana tabloda MULTI grup alt satırı asla açılmaz. */
export function shouldRenderInlineMultiGroupDetails() {
  return false;
}

export function createMultiCounterpartUiState(group = null) {
  return { multiDetailGroup: group || null };
}

/**
 * Modal açılışında multiDetail eksikse ledgerRows ile doldurur.
 * Motor/sayaç değiştirmez.
 */
export function ensureGroupHasMultiDetail(group = null, ledgerRows = []) {
  if (!group || group.kind !== "group") return null;
  if (Array.isArray(group.multiDetail?.lines) && group.multiDetail.lines.length > 0) {
    return group;
  }
  return {
    ...group,
    multiDetail: buildMultiCounterpartVoucherDetail({
      fisNo: group.fisNo,
      tarih: group.tarih,
      ledgerRows,
      multiFindingItems: group.details || [],
    }),
  };
}

export function openMultiCounterpartGroup(state = {}, group = null, ledgerRows = []) {
  const prepared = ensureGroupHasMultiDetail(group, ledgerRows);
  return {
    ...state,
    multiDetailGroup: prepared,
  };
}

export function closeMultiCounterpartGroup(state = {}) {
  return {
    ...state,
    multiDetailGroup: null,
  };
}

export function isMultiCounterpartModalOpen(state = {}) {
  return Boolean(state?.multiDetailGroup);
}
