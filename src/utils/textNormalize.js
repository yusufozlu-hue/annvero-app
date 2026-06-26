export function normalizeParserText(value) {
  return String(value || "")
    .replaceAll("ı", "i")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C")
    .replace(/[.,/()\-_*:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
