export function parseTurkishAmount(value) {
  const raw = String(value || "")
    .trim()
    .replace(/\s/g, "");

  if (!raw) return 0;

  if (raw.includes(",")) {
    const normalized = raw.replace(/\./g, "").replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  const parts = raw.split(".");

  if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
    const number = Number(`${parts[0]}.${parts[1]}`);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  const normalized = raw.replace(/\./g, "");
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

/** Display-only TR money (2 decimals). No currency symbol. Invalid → "—". */
export function formatTurkishMoney(value) {
  if (value === null || value === undefined) return "—";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
