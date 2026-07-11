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
    .replace(new RegExp("[.,/()\\-_*:;]", "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveAnalysisDirection(direction = "") {
  const value = String(direction || "").trim().toUpperCase();
  return value === "CIKIS" || value === "ÇIKIŞ" || value === "OUT" ? "CIKIS" : "GIRIS";
}

/**
 * Yalnızca muhasebe analizi grouping/cache anahtarı.
 * Görünen açıklamayı veya muhasebe kurallarını değiştirmez.
 */
export function normalizeBankAnalysisKey(description, direction = "") {
  // Apostrof yalnızca analysis key için boşluğa (no'lu → NO LU)
  let text = normalizeParserText(String(description || "").replace(/'/g, " "));
  if (!text) {
    return `|${resolveAnalysisDirection(direction)}`;
  }

  // Etiketli kimlik: "1849228780 sorgu no'lu" ve "sorgu no 1849228780"
  // NO LU / NOLU, NO'dan önce gelmeli (yoksa NO eşleşir, LU kalır)
  text = text.replace(
    /\b\d{4,}\s+(SORGU|REFERANS|REF|ISLEM|DEKONT|BATCH|PROVIZYON|SIRA|HAREKET|FIS)\s*(NO LU|NOLU|NUMARASI|NUMARA|NO)?\b/g,
    " "
  );
  text = text.replace(
    /\b(SORGU|REFERANS|REF|ISLEM|DEKONT|BATCH|PROVIZYON|SIRA|HAREKET|FIS)\s*(NO LU|NOLU|NUMARASI|NUMARA|NO)?\s*\d{4,}\b/g,
    " "
  );

  text = text.replace(/\bTARIHLI\b/g, " ");

  // Tarih: gg aa yyyy | yyyy aa gg
  text = text.replace(/\b\d{1,2}\s+\d{1,2}\s+\d{4}\b/g, " ");
  text = text.replace(/\b\d{4}\s+\d{1,2}\s+\d{1,2}\b/g, " ");

  // Saat
  text = text.replace(/\b\d{1,2}\s+\d{2}\s+\d{2}\b/g, " ");
  text = text.replace(/\bSAAT\s+\d{1,2}(\s+\d{2}){0,2}\b/g, " ");

  // IBAN değişken kısmı
  text = text.replace(/\bTR\s?\d{2}[\d\s]{10,30}\b/g, " IBAN ");
  text = text.replace(/\bTR\d{24}\b/g, " IBAN ");

  // 6+ haneli sayısal kimlikler (4 hane vergi türü / kart / yıl korunur)
  text = text.replace(/\b\d{6,}\b/g, " ");

  // Artık anlamsız kalan etiket artıkları (ISLEM hariç — ISLEMLERI bozulmasın)
  text = text.replace(
    /\b(SORGU|REFERANS|REF|DEKONT|BATCH|PROVIZYON|SIRA)\s*(NO LU|NOLU|NUMARASI|NUMARA|NO)?\b/g,
    " "
  );

  text = text.replace(/\s+/g, " ").trim();

  return `${text}|${resolveAnalysisDirection(direction)}`;
}

/** Eski unique anahtar — karşılaştırma / telemetri için */
export function buildLegacyAnalysisMemoKey(description, direction = "") {
  return `${normalizeParserText(description)}|${resolveAnalysisDirection(direction)}`;
}
