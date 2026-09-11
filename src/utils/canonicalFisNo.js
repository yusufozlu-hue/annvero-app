/**
 * Canonical fiş numarası anahtarı — yalnız karşılaştırma / filtre / gruplama.
 * Görünen (display) değeri değiştirmez; sıfırları yeniden üretmez.
 *
 * Sözleşme:
 * - Yalnız ASCII rakam: baştaki sıfırlar düşer ("00001" → "1"); hepsi sıfır → "0"
 * - Alfanümerik: trim + tr-TR lower; sıfırlar korunur ("001A" ≠ "1A")
 * - Boş / whitespace → "" (çağıran fail-safe ile birleştirmez)
 * - Number/parseInt yok (uzun numaralarda precision kaybı olmasın)
 */

/** @param {unknown} value */
export function displayFisNo(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value);
}

/**
 * Semantik karşılaştırma anahtarı.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalFisNoKey(value = "") {
  const trimmed = displayFisNo(value);
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) {
    const stripped = trimmed.replace(/^0+/, "");
    return stripped === "" ? "0" : stripped;
  }
  return trimmed.toLocaleLowerCase("tr-TR");
}

/** Filtre / UI predicate için alias — mevcut normalizeFisNoForFilter sözleşmesi. */
export function normalizeFisNoForFilter(value = "") {
  return canonicalFisNoKey(value);
}

/**
 * İki fiş no semantik olarak aynı mı?
 * Boş anahtarlar eşit sayılmaz (sahte tek fiş birleşmesi yok).
 */
export function fisNosCanonicallyEqual(left, right) {
  const a = canonicalFisNoKey(left);
  const b = canonicalFisNoKey(right);
  if (!a || !b) return false;
  return a === b;
}

export function matchesVoucherNumberFilter(voucherNo, query = "") {
  const needle = canonicalFisNoKey(query);
  if (!needle) return true;
  const haystack = canonicalFisNoKey(voucherNo);
  if (!haystack) return false;
  return haystack === needle;
}

/**
 * Digit-only canonical keys için Number kullanmadan sıralama.
 * @param {string} left
 * @param {string} right
 */
export function compareCanonicalFisNoKeys(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  const aDigits = /^\d+$/.test(a);
  const bDigits = /^\d+$/.test(b);
  if (aDigits && bDigits) {
    if (a.length !== b.length) return a.length - b.length;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  return a.localeCompare(b, "tr");
}
