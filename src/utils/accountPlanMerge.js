/**
 * İstemci + sunucu hesap planı satırlarını kod üzerinden birleştirir.
 * API/camelCase (accountCode) ve snake_code alanlarını birlikte kabul eder.
 */
export function mergeAccountPlanRows(primary = [], secondary = []) {
  const byCode = new Map();
  for (const row of [...(primary || []), ...(secondary || [])]) {
    const code = String(
      row?.accountCode ||
        row?.account_code ||
        row?.hesapKodu ||
        row?.kod ||
        row?.code ||
        ""
    ).trim();
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, row);
  }
  return [...byCode.values()];
}
