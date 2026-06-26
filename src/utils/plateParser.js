import { normalizeParserText } from "@/src/utils/bankMovementMapper";

function normalizePlateLetters(value) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C")
    .replace(/[^A-Z]/g, "");
}

function isValidPlateParts(province, letters, digits) {
  const provinceNumber = Number(province);

  if (provinceNumber < 1 || provinceNumber > 81) return false;
  if (letters.length < 1 || letters.length > 3) return false;
  if (digits.length < 2 || digits.length > 4) return false;

  return true;
}

function buildPlateResult(province, letters, digits) {
  const cleanLetters = normalizePlateLetters(letters);
  const cleanDigits = String(digits || "").replace(/\D/g, "");

  if (!isValidPlateParts(province, cleanLetters, cleanDigits)) {
    return null;
  }

  return {
    province,
    letters: cleanLetters,
    digits: cleanDigits,
    display: `${province} ${cleanLetters} ${cleanDigits}`,
    normalized: `${province}${cleanLetters}${cleanDigits}`,
  };
}

export function extractPlateFromText(text) {
  const raw = String(text || "");
  const normalized = normalizeParserText(raw);

  const patterns = [
    /\b(\d{2})\s+([A-Z]{1,3})\s+(\d{2,4})\b/g,
    /\b(\d{2})([A-Z]{2,3})(\d{2,4})\b/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(normalized);

    if (!match) continue;

    const result = buildPlateResult(match[1], match[2], match[3]);
    if (result) return result;
  }

  return null;
}

export function enhanceHgsOgsLucaDescription(description, lucaDescription) {
  const text = normalizeParserText(description);
  const isHgs = text.includes("HGS");
  const isOgs = text.includes("OGS");

  if (!isHgs && !isOgs) {
    return {
      lucaDescription,
      normalizedPlate: null,
      displayPlate: null,
    };
  }

  const plate = extractPlateFromText(description);

  if (!plate) {
    return {
      lucaDescription,
      normalizedPlate: null,
      displayPlate: null,
    };
  }

  const prefix = isHgs ? "HGS" : "OGS";

  return {
    lucaDescription: `${prefix} GEÇİŞ/YÜKLEME BEDELİ - ${plate.display}`,
    normalizedPlate: plate.normalized,
    displayPlate: plate.display,
  };
}
