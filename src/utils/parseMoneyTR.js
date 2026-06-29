/**
 * Türkçe / karışık locale para metinlerini sayıya çevirir.
 * Boş/null/undefined => 0
 */
export function parseMoneyTR(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.abs(value) : 0;
  }

  let text = String(value).trim();
  if (!text) {
    return 0;
  }

  text = text
    .replace(/\s+/g, "")
    .replace(/TL/gi, "")
    .replace(/₺/g, "");

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    text = text.replace(",", ".");
  } else if (lastDot !== -1) {
    const dotCount = (text.match(/\./g) || []).length;

    if (dotCount > 1) {
      text = text.replace(/\./g, "");
    } else {
      const [, fraction = ""] = text.split(".");
      if (fraction.length === 3) {
        text = text.replace(".", "");
      }
    }
  }

  text = text.replace(/[^\d.]/g, "");
  const number = Number(text);

  if (Number.isNaN(number)) {
    return 0;
  }

  return Math.abs(number);
}
