/**
 * Kanonik banka kimliği + alias normalizasyonu.
 *
 * Dış/kanonik: VAKIFBANK | GARANTI | TEB | ZIRAAT | KUVEYTTURK
 * Parser hot-path iç kimliği: KUVEYTTURK → KUVEYT (mevcut UI/parser id)
 */

export const CANONICAL_BANK_IDS = Object.freeze([
  "VAKIFBANK",
  "GARANTI",
  "TEB",
  "ZIRAAT",
  "KUVEYTTURK",
]);

/** Hot-path parseRowsForBank / bankParserOptions id’leri */
export const PARSER_BANK_IDS = Object.freeze([
  "VAKIFBANK",
  "GARANTI",
  "TEB",
  "ZIRAAT",
  "KUVEYT",
]);

const ALIAS_TO_CANONICAL = Object.freeze({
  VAKIFBANK: "VAKIFBANK",
  VAKIF: "VAKIFBANK",
  VAKIFBANASI: "VAKIFBANK",
  GARANTI: "GARANTI",
  GARANTIBBVA: "GARANTI",
  BBVA: "GARANTI",
  TEB: "TEB",
  TURKIYEEKONOMIBANKASI: "TEB",
  TURKIYEEKONOMI: "TEB",
  ZIRAAT: "ZIRAAT",
  ZIRAATBANKASI: "ZIRAAT",
  TCZIRAAT: "ZIRAAT",
  TCZIRAATBANKASI: "ZIRAAT",
  KUVEYTTURK: "KUVEYTTURK",
  KUVEYTTURKKATILIM: "KUVEYTTURK",
  KUVEYT: "KUVEYTTURK",
  KUVEYTTURKATILIM: "KUVEYTTURK",
});

export function compactBankToken(value = "") {
  return String(value || "")
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I")
    .replace(/I/g, "I")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "");
}

/**
 * Her türlü alias / Türkçe karakter / boşluk → kanonik id.
 * Bilinmeyen → "".
 */
export function canonicalizeBankId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toLocaleUpperCase("tr-TR");
  const compact = compactBankToken(raw);

  if (ALIAS_TO_CANONICAL[upper]) return ALIAS_TO_CANONICAL[upper];
  if (ALIAS_TO_CANONICAL[compact]) return ALIAS_TO_CANONICAL[compact];

  // Kısmi alias (içerik hücreleri / dosya adı)
  if (/KUVEYT/.test(compact)) return "KUVEYTTURK";
  if (/VAKIF/.test(compact)) return "VAKIFBANK";
  if (/GARANTI|BBVA/.test(compact)) return "GARANTI";
  if (/\bTEB\b/.test(upper) || compact === "TEB" || /TURKIYEEKONOMI/.test(compact)) {
    return "TEB";
  }
  if (/ZIRAAT/.test(compact)) return "ZIRAAT";

  return "";
}

/** Kanonik → hot-path parser id (KUVEYTTURK → KUVEYT). */
export function toParserBankId(canonicalOrAlias = "") {
  const canonical = canonicalizeBankId(canonicalOrAlias);
  if (!canonical) return "";
  if (canonical === "KUVEYTTURK") return "KUVEYT";
  return canonical;
}

/** Parser/UI id → kanonik (KUVEYT → KUVEYTTURK). */
export function toCanonicalBankId(parserOrAlias = "") {
  return canonicalizeBankId(parserOrAlias);
}

export function isKnownCanonicalBank(value = "") {
  const id = canonicalizeBankId(value);
  return CANONICAL_BANK_IDS.includes(id);
}

export function bankIdsEqual(a = "", b = "") {
  const ca = canonicalizeBankId(a);
  const cb = canonicalizeBankId(b);
  if (!ca || !cb) return false;
  return ca === cb;
}
