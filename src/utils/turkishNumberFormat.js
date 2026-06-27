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

export function formatTurkishMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
