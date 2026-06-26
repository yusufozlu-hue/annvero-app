import { normalizeParserText } from "@/src/utils/bankMovementMapper";

export function normalizeSearchText(value) {
  return normalizeParserText(value);
}

export function matchesSearchQuery(parts, query) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) return true;

  const haystack = parts
    .flatMap((part) => {
      if (part == null) return [];
      return [String(part)];
    })
    .map((part) => normalizeSearchText(part))
    .filter(Boolean)
    .join(" ");

  return haystack.includes(normalizedQuery);
}

export function getBankMovementSearchParts(row, formatDate, formatAmount) {
  const isIncoming = row.direction === "GIRIS";
  const borcHesap = isIncoming ? row.accountCode : row.counterAccountCode;
  const alacakHesap = isIncoming ? row.counterAccountCode : row.accountCode;

  return [
    formatDate ? formatDate(row.date) : row.date,
    row.description,
    row.matchedRule?.islemTipi,
    row.matchedRule?.islem,
    row.matchedRule?.anahtar,
    borcHesap,
    alacakHesap,
    row.accountCode,
    row.counterAccountCode,
    row.documentType,
    row.lucaDescription,
    row.warning,
    row.amount,
    formatAmount ? formatAmount(row.amount) : "",
    row.direction,
    row.direction === "GIRIS" ? "Giris" : "Cikis",
    ...(row.accountSuggestions || []).map((item) => item.label),
  ];
}

export function getBankMovementWarningText(row) {
  return normalizeSearchText(row.warning || "");
}

export function hasBankMovementError(row) {
  const warning = String(row.warning || "").trim();
  if (!warning) return false;

  const nonErrorParts = new Set([
    normalizeSearchText("Öğrenen hafızadan eşleşti"),
    normalizeSearchText("Önerilen hesap uygulandı"),
  ]);

  const parts = warning
    .split("|")
    .map((part) => normalizeSearchText(part.trim()))
    .filter(Boolean);

  if (parts.length === 0) return false;

  return parts.some((part) => !nonErrorParts.has(part));
}

export function matchesBankMovementQuickFilter(row, filterId) {
  const warningText = getBankMovementWarningText(row);
  const descriptionText = normalizeSearchText(
    [row.description, row.lucaDescription, row.matchedRule?.islem].join(" ")
  );

  switch (filterId) {
    case "all":
      return true;
    case "errors":
      return hasBankMovementError(row);
    case "accountNotFound":
      return (
        warningText.includes("HESAP PLANINDA BULUNAMADI") ||
        warningText.includes("CARI HESAP BULUNAMADI")
      );
    case "ruleNotFound":
      return warningText.includes("KURAL BULUNAMADI");
    case "learningMemory":
      return (
        Boolean(row.matchedMemoryId) ||
        row.matchedRule?.source === "learningMemory" ||
        warningText.includes("OGRENEN HAFIZADAN ESLESTI")
      );
    case "creditCard":
      return (
        row.matchedRule?.source === "creditCard" ||
        normalizeSearchText(row.matchedRule?.islem || "").includes("KREDI KART")
      );
    case "taxSgk":
      return (
        descriptionText.includes("SGK") ||
        descriptionText.includes("VERGI") ||
        warningText.includes("SGK") ||
        warningText.includes("VERGI")
      );
    default:
      return true;
  }
}

export function filterBankMovementRows(rows, query, quickFilter, formatDate, formatAmount) {
  return rows.filter((row) => {
    if (!matchesBankMovementQuickFilter(row, quickFilter)) return false;

    return matchesSearchQuery(
      getBankMovementSearchParts(row, formatDate, formatAmount),
      query
    );
  });
}

export function isMissingLucaAccountCode(code) {
  const text = normalizeSearchText(code);

  return (
    !text ||
    text.includes("BULUNAMADI") ||
    text.includes("HESAP PLANINDAN") ||
    text.includes("ESLESTIRME")
  );
}

export function parseSearchNumber(value) {
  if (typeof value === "number") return value;

  const cleaned = String(value || "")
    .replaceAll("TL", "")
    .replaceAll(".", "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const number = Number(cleaned);
  return Number.isNaN(number) ? 0 : number;
}

export function isUnbalancedLucaFis(fis) {
  const totalBorc = (fis.satirlar || []).reduce(
    (sum, satir) => sum + parseSearchNumber(satir.borc),
    0
  );
  const totalAlacak = (fis.satirlar || []).reduce(
    (sum, satir) => sum + parseSearchNumber(satir.alacak),
    0
  );

  return Math.abs(totalBorc - totalAlacak) > 0.009;
}

export function getLucaFisSearchParts(fis) {
  const parts = [
    fis.fisNo,
    fis.belgeTuru,
    fis.uyari,
    fis.aciklama,
    fis.tarih,
  ];

  for (const satir of fis.satirlar || []) {
    parts.push(
      satir.hesapKodu,
      satir.aciklama,
      satir.borc,
      satir.alacak,
      satir.uyari
    );
  }

  for (const suggestion of fis.accountSuggestions || []) {
    parts.push(suggestion.label);
  }

  return parts;
}

export function matchesLucaFisQuickFilter(fis, filterId) {
  const uyariText = normalizeSearchText(
    [fis.uyari, ...(fis.satirlar || []).map((satir) => satir.uyari)]
      .filter(Boolean)
      .join(" ")
  );

  switch (filterId) {
    case "all":
      return true;
    case "errors":
      return (
        Boolean(String(fis.uyari || "").trim()) ||
        (fis.satirlar || []).some((satir) =>
          Boolean(String(satir.uyari || "").trim())
        ) ||
        (fis.satirlar || []).some((satir) =>
          isMissingLucaAccountCode(satir.hesapKodu)
        )
      );
    case "missingAccount":
      return (fis.satirlar || []).some((satir) =>
        isMissingLucaAccountCode(satir.hesapKodu)
      );
    case "unbalanced":
      return isUnbalancedLucaFis(fis);
    case "overFifty":
      return Number(fis.fisNo || 0) > 50;
    case "learningMemory":
      return uyariText.includes("OGRENEN HAFIZADAN ESLESTI");
    default:
      return true;
  }
}

export function filterLucaFisRows(rows, query, quickFilter) {
  return rows.filter((fis) => {
    if (!matchesLucaFisQuickFilter(fis, quickFilter)) return false;
    return matchesSearchQuery(getLucaFisSearchParts(fis), query);
  });
}
