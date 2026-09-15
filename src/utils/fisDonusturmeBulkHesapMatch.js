/**
 * Fiş Dönüştürme — HESAP_EKSIK satırlarında kaynakHesapKodu bazlı toplu eşleme.
 * kaynakHesapKodu immutable; mükerrer kararları bu katmanda tutulmaz.
 */

import { finalizeStandardLucaRow } from "@/src/utils/standardLucaRow";

function normalizeKaynakCode(row) {
  return String(row?.kaynakHesapKodu || "").trim();
}

function isHesapEksikRow(row) {
  return String(row?.riskDurumu || "").trim() === "HESAP_EKSIK";
}

/**
 * HESAP_EKSIK satırlarından benzersiz kaynak kod grupları.
 * @returns {Array<{ kaynakHesapKodu: string, rowCount: number, rowIds: string[] }>}
 */
export function collectHesapEksikKaynakGroups(rows = []) {
  const map = new Map();

  for (const row of rows || []) {
    if (!isHesapEksikRow(row)) continue;
    const kod = normalizeKaynakCode(row);
    if (!kod) continue;
    const current = map.get(kod) || { kaynakHesapKodu: kod, rowCount: 0, rowIds: [] };
    current.rowCount += 1;
    if (row?.id != null && String(row.id).trim() !== "") {
      current.rowIds.push(String(row.id));
    }
    map.set(kod, current);
  }

  return [...map.values()].sort((left, right) =>
    left.kaynakHesapKodu.localeCompare(right.kaynakHesapKodu, "tr", {
      numeric: true,
    })
  );
}

/**
 * Aynı kaynakHesapKodu + HESAP_EKSIK olan satırlara hedef hesapKodu uygular.
 * Diğer kaynak kodlar ve mükerrer state'e dokunmaz.
 *
 * @param {object[]} rows
 * @param {string} kaynakHesapKodu
 * @param {string} targetHesapKodu
 * @returns {{ rows: object[], appliedCount: number, ok: boolean, message: string }}
 */
export function applyBulkHesapKoduByKaynak(
  rows = [],
  kaynakHesapKodu,
  targetHesapKodu
) {
  const kaynak = String(kaynakHesapKodu || "").trim();
  const target = String(targetHesapKodu || "").trim();

  if (!kaynak) {
    return {
      ok: false,
      appliedCount: 0,
      rows: rows || [],
      message: "Kaynak hesap kodu zorunlu.",
    };
  }
  if (!target) {
    return {
      ok: false,
      appliedCount: 0,
      rows: rows || [],
      message: "Hedef hesap kodu seçmelisin.",
    };
  }

  let appliedCount = 0;
  const next = (rows || []).map((row) => {
    if (!isHesapEksikRow(row)) return row;
    if (normalizeKaynakCode(row) !== kaynak) return row;

    const preservedKaynak = normalizeKaynakCode(row) || kaynak;
    appliedCount += 1;

    return finalizeStandardLucaRow({
      ...row,
      hesapKodu: target,
      kaynakHesapKodu: preservedKaynak,
      riskDurumu: "",
      manuallyEdited: true,
    });
  });

  return {
    ok: true,
    appliedCount,
    rows: next,
    message:
      appliedCount > 0
        ? `${appliedCount} satıra ${target} uygulandı.`
        : "Uygulanacak HESAP_EKSIK satırı bulunamadı.",
  };
}

/**
 * Export UI: HESAP_EKSIK kaldığı sürece kapalı.
 */
export function hasUnresolvedHesapEksik(rows = []) {
  return (rows || []).some(isHesapEksikRow);
}
