const NORMALIZE_MEMO_MAX = 20000;

/** Analiz boyu memo — begin/end ile bağlanır; global kalıcı cache değildir. */
let activeNormalizeMemo = null;

export function beginNormalizeMemo(map = new Map()) {
  activeNormalizeMemo = map instanceof Map ? map : new Map();
  return activeNormalizeMemo;
}

export function endNormalizeMemo() {
  activeNormalizeMemo = null;
}

export function getActiveNormalizeMemoSize() {
  return activeNormalizeMemo?.size || 0;
}

function computeNormalizeParserText(value) {
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

export function normalizeParserText(value) {
  const profile = globalThis.__ANNVERO_ANALYSIS_PROFILE__;
  const started = profile?.enabled ? performance.now() : 0;
  const key = String(value ?? "");

  if (activeNormalizeMemo?.has(key)) {
    if (profile?.enabled) {
      profile.normalizeCallCount += 1;
      profile.normalizeMemoHitCount = (profile.normalizeMemoHitCount || 0) + 1;
      profile.normalizeTotalMs += performance.now() - started;
    }
    return activeNormalizeMemo.get(key);
  }

  const result = computeNormalizeParserText(value);
  if (activeNormalizeMemo && activeNormalizeMemo.size < NORMALIZE_MEMO_MAX) {
    activeNormalizeMemo.set(key, result);
  }

  if (profile?.enabled) {
    const elapsed = performance.now() - started;
    profile.normalizeCallCount += 1;
    profile.normalizeTotalMs += elapsed;
  }
  return result;
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
  const profile = globalThis.__ANNVERO_ANALYSIS_PROFILE__;
  const started = profile?.enabled ? performance.now() : 0;
  // Apostrof yalnızca analysis key için boşluğa (no'lu → NO LU)
  let text = normalizeParserText(String(description || "").replace(/'/g, " "));
  if (!text) {
    const emptyKey = `|${resolveAnalysisDirection(direction)}`;
    if (profile?.enabled) {
      const elapsed = performance.now() - started;
      profile.normalizeBankKeyCallCount += 1;
      profile.normalizeBankKeyTotalMs += elapsed;
    }
    return emptyKey;
  }

  // Etiketli kimlik: "1849228780 sorgu no'lu" ve "sorgu no 1849228780"
  // NO LU / NOLU / NUMARALI, NO'dan önce gelmeli (yoksa NO eşleşir, LU kalır)
  text = text.replace(
    /\b\d{4,}\s+(SORGU|REFERANS|REF|ISLEM|DEKONT|BATCH|PROVIZYON|SIRA|HAREKET|FIS)\s*(NO LU|NOLU|NUMARALI|NUMARASI|NUMARA|NO)?\b/g,
    " "
  );
  text = text.replace(
    /\b(SORGU|REFERANS|REF|ISLEM|DEKONT|BATCH|PROVIZYON|SIRA|HAREKET|FIS)\s*(NO LU|NOLU|NUMARALI|NUMARASI|NUMARA|NO)?\s*\d{4,}\b/g,
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
    /\b(SORGU|REFERANS|REF|DEKONT|BATCH|PROVIZYON|SIRA)\s*(NO LU|NOLU|NUMARALI|NUMARASI|NUMARA|NO)?\b/g,
    " "
  );
  text = text.replace(/\b(NO LU|NOLU|NUMARALI)\b/g, " ");

  text = text.replace(/\s+/g, " ").trim();

  const key = `${text}|${resolveAnalysisDirection(direction)}`;
  if (profile?.enabled) {
    const elapsed = performance.now() - started;
    profile.normalizeBankKeyCallCount += 1;
    profile.normalizeBankKeyTotalMs += elapsed;
  }
  return key;
}

/** Eski unique anahtar — karşılaştırma / telemetri için */
export function buildLegacyAnalysisMemoKey(description, direction = "") {
  return `${normalizeParserText(description)}|${resolveAnalysisDirection(direction)}`;
}

/** GIRIS/CIKIS dışında boş — borc/alacak türetmez */
export function normalizeBankDirection(value = "") {
  const text = String(value || "")
    .trim()
    .toUpperCase();
  if (text === "CIKIS" || text === "ÇIKIŞ" || text === "OUT") return "CIKIS";
  if (text === "GIRIS" || text === "GİRİŞ" || text === "IN") return "GIRIS";
  return "";
}

/** analysisKey son bileşeni: `metin|GIRIS` */
export function extractDirectionFromAnalysisKey(analysisKey = "") {
  const parts = String(analysisKey || "").split("|");
  const last = String(parts[parts.length - 1] || "")
    .trim()
    .toUpperCase();
  return last === "GIRIS" || last === "CIKIS" ? last : "";
}

/**
 * Luca satırı / öneri kartı için gerçek banka hareket yönü.
 * borc/alacak kullanılmaz (karşı bacak etiketi ters düşer).
 *
 * Öncelik:
 * 1) kaynak movement.direction (sourceMovementId / _movementId)
 * 2) row.direction / row.yon
 * 3) analysisKey içindeki yön
 * 4) boş
 */
export function resolveLucaRowBankDirection(row = {}, context = {}) {
  const movementId = row.sourceMovementId || row._movementId || "";
  let movement = context.movement || null;

  if (!movement && movementId) {
    if (context.movementById?.get) {
      movement = context.movementById.get(movementId) || null;
    } else if (Array.isArray(context.movements)) {
      movement = context.movements.find((item) => item?.id === movementId) || null;
    }
  }

  if (movement) {
    const fromMovement = normalizeBankDirection(
      movement.direction || movement.yon || ""
    );
    if (fromMovement) return fromMovement;
  }

  const fromRow = normalizeBankDirection(row.direction || row.yon || "");
  if (fromRow) return fromRow;

  return extractDirectionFromAnalysisKey(row.analysisKey || "");
}
