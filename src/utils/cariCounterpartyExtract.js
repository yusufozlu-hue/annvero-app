/**
 * Banka açıklamasından karşı taraf çıkarma + leaf cari yardımcıları.
 * Aktif firmanın kendi unvan/IBAN kimliği karşı taraf sayılmaz.
 */

import { normalizeParserText } from "@/src/utils/textNormalize.js";
import { getCompanyDisplayName } from "@/src/utils/companies.js";

const COMPANY_SUFFIX_TOKENS = new Set([
  "AS",
  "A",
  "S",
  "ANONIM",
  "SIRKETI",
  "SIRKET",
  "LTD",
  "STI",
  "LIMITED",
  "TICARET",
  "TIC",
  "SAN",
  "VE",
  "TAS",
  "TAO",
  "T",
  "O",
]);

const MONTH_TOKENS = new Set([
  "OCAK",
  "SUBAT",
  "MART",
  "NISAN",
  "MAYIS",
  "HAZIRAN",
  "TEMMUZ",
  "AGUSTOS",
  "EYLUL",
  "EKIM",
  "KASIM",
  "ARALIK",
]);

const NOISE_PHRASES = [
  /\bKONAKLAMA\s+(ON\s+ODEME|BEDELI|BEDEL|ODEMESI|ODEME)\b/g,
  /\bON\s+ODEME\b/g,
  /\bKONAKLAMA\b/g,
  /\bHESABINDAN\b/g,
  /\bHESABINA\b/g,
  /\bHAVALE\s+YAPILMISTIR\b/g,
  /\bHAVALE\b/g,
  /\bEFT\b/g,
  /\bFAST\b/g,
  /\bYAPILMISTIR\b/g,
  /\bCIKIS\b/g,
  /\bGIRIS\b/g,
  /\bGELEN\b/g,
  /\bGIDEN\b/g,
  /\bSORGU\s*(NO\s*LU|NOLU|NUMARALI|NUMARASI|NUMARA|NO)?\b/g,
  /\b(NO\s*LU|NOLU|NUMARALI)\b/g,
];

const BARE_CARI_MAINS = new Set([
  "120",
  "320",
  "329",
  "331",
  "336",
  "337",
  "338",
  "339",
]);

function compactCode(value = "") {
  // Hesap kodlarında nokta korunmalı (120.01 ≠ 12001); metin normalize etme.
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/İ/g, "I")
    .replace(/\s+/g, "");
}

function localNormalizeCariName(value) {
  let text = normalizeParserText(value);
  text = text
    .replace(/\bA\s*\.\s*S\b/g, " AS ")
    .replace(/\bA\s*S\b/g, " AS ")
    .replace(/\bANONIM\s+SIRKETI\b/g, " AS ")
    .replace(/\bLTD\s*\.\s*STI\b/g, " LTD STI ")
    .replace(/\bLTD\s+STI\b/g, " LTD STI ")
    .replace(/\bLTD\b/g, " LTD ")
    .replace(/\bLIMITED\b/g, " LTD ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function localNormalizeCariNameCore(value) {
  return localNormalizeCariName(value)
    .split(" ")
    .filter((token) => token && !COMPANY_SUFFIX_TOKENS.has(token))
    .join(" ")
    .trim();
}

function resolveDir(direction = "") {
  const d = String(direction || "").trim().toUpperCase();
  if (d === "CIKIS" || d === "GIDEN" || d === "BORC" || d === "OUT") return "CIKIS";
  if (d === "GIRIS" || d === "GELEN" || d === "ALACAK" || d === "IN") return "GIRIS";
  return "";
}

export function buildOwnCompanyIdentity(selectedCompany = null) {
  if (!selectedCompany) {
    return { titles: [], cores: [], ibans: [], taxNumbers: [] };
  }

  const titles = [
    getCompanyDisplayName(selectedCompany),
    selectedCompany.companyName,
    selectedCompany.name,
    selectedCompany.unvan,
    selectedCompany.title,
    selectedCompany.legalName,
    selectedCompany.ticariUnvan,
    selectedCompany.displayName,
    ...(selectedCompany.aliases || []),
    ...(selectedCompany.alternativeNames || []),
    ...(selectedCompany.altUnvanlar || []),
  ]
    .map((t) => String(t || "").trim())
    .filter(Boolean);

  const cores = [
    ...new Set(
      titles.map((t) => localNormalizeCariNameCore(t)).filter((c) => c.length >= 4)
    ),
  ];

  const banks = selectedCompany.bankAccounts || selectedCompany.banks || [];
  const ibans = new Set();
  for (const bank of banks) {
    const iban = normalizeParserText(bank?.iban || bank?.IBAN || "").replace(/\s+/g, "");
    if (iban.length >= 15) ibans.add(iban);
  }
  for (const raw of selectedCompany.ibans || []) {
    const iban = normalizeParserText(raw).replace(/\s+/g, "");
    if (iban.length >= 15) ibans.add(iban);
  }

  const taxNumbers = new Set();
  for (const raw of [
    selectedCompany.taxNumber,
    selectedCompany.vkn,
    selectedCompany.vergiNo,
    selectedCompany.vergiNumarasi,
  ]) {
    const digits = String(raw || "").replace(/\D/g, "");
    if (digits.length >= 10) taxNumbers.add(digits);
  }

  return {
    titles,
    cores,
    ibans: [...ibans],
    taxNumbers: [...taxNumbers],
  };
}

export function isOwnCompanyPartyName(name = "", ownIdentity = null) {
  const core = localNormalizeCariNameCore(name);
  if (!core || core.length < 4 || !ownIdentity?.cores?.length) return false;
  return ownIdentity.cores.some((ownCore) => {
    if (!ownCore) return false;
    if (core === ownCore) return true;
    if (core.length >= 8 && ownCore.length >= 8) {
      if (core.includes(ownCore) || ownCore.includes(core)) return true;
    }
    const ownTokens = ownCore.split(/\s+/).filter((t) => t.length >= 3);
    if (ownTokens.length < 2) return false;
    return ownTokens.every((t) => core.includes(t));
  });
}

const OWN_STRIP_SERVICE_NOISE = new Set([
  "FATURA",
  "BEDELI",
  "BEDEL",
  "ODEME",
  "ODEMESI",
  "UCRETI",
  "UCRET",
  "TAHSILAT",
  "HESABI",
  "HESAP",
  "TUTAR",
  "ISLEM",
  "TARIHLI",
  "SORGU",
  "REFERANS",
  "REF",
  "DEKONT",
  "BATCH",
  "PROVIZYON",
  "SIRA",
  "HAREKET",
  "FIS",
  "NUMARALI",
  "NUMARASI",
  "NUMARA",
  "NOLU",
  "NO",
  "LU",
  "GOND",
  "GONDEREN",
  "GLN",
  "HVL",
  "EFT",
  "FAST",
  "HAVALE",
  "YAPILMISTIR",
]);

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Aktif firma unvan / IBAN parçalarını açıklamadan temizler.
 * Mal-hizmet veya üçüncü taraf ifadelerini bilerek silmez.
 */
export function stripOwnCompanyIdentityFromText(
  description = "",
  ownIdentity = null
) {
  let norm = normalizeParserText(description);
  if (!norm || !ownIdentity) return norm;

  for (const iban of ownIdentity.ibans || []) {
    const compact = String(iban || "").replace(/\s+/g, "");
    if (compact.length < 15) continue;
    const spaced = escapeRegExp(compact).replace(/(.{1})/g, "$1\\s*");
    norm = norm.replace(new RegExp(spaced, "g"), " ");
  }

  const phrases = [
    ...(ownIdentity.titles || []),
    ...(ownIdentity.cores || []),
  ]
    .map((t) => localNormalizeCariName(String(t || "")))
    .filter((t) => t.replace(/\s+/g, "").length >= 6)
    .sort(
      (a, b) =>
        b.replace(/\s+/g, "").length - a.replace(/\s+/g, "").length
    );

  for (const phrase of phrases) {
    const pattern = phrase
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeRegExp)
      .join("\\s+");
    if (!pattern) continue;
    norm = norm.replace(new RegExp(`\\b${pattern}\\b`, "g"), " ");
  }

  return norm.replace(/\s+/g, " ").trim();
}

function descriptionHasCariShortCodeSignal(description = "") {
  const text = normalizeParserText(description);
  if (!text) return false;
  // Lazy import cycle yok — kısa kod anahtarları burada hafif kontrol
  const keys = [
    "BILETDUK",
    "BILET DUK",
    "BILETDUKKANI",
    "TTLKOM",
    "TTNET",
    "TURKCELL",
    "VODAFONE",
    "AYDEM",
    "BEDAS",
  ];
  return keys.some((key) => {
    const k = normalizeParserText(key);
    if (!k) return false;
    if (k.includes(" ")) return text.includes(k);
    return text.split(" ").some((w) => w === k || w.startsWith(k));
  });
}

/**
 * Dış karşı taraf yok: kendi unvan/IBAN çıkarıldıktan sonra ayırt edici
 * üçüncü taraf veya kısa kod kalmıyor.
 * Açıklamada kendi unvan geçmesi tek başına true yapmaz.
 */
export function isOwnOnlyOrMissingCounterparty(
  description = "",
  direction = "",
  selectedCompanyOrIdentity = null
) {
  const ownIdentity =
    selectedCompanyOrIdentity?.cores
      ? selectedCompanyOrIdentity
      : buildOwnCompanyIdentity(selectedCompanyOrIdentity);
  if (!ownIdentity?.cores?.length) return false;

  if (descriptionHasCariShortCodeSignal(description)) return false;

  const party =
    extractCounterpartyParty({
      description,
      direction,
      ownIdentity,
    }) || "";
  if (party && !isOwnCompanyPartyName(party, ownIdentity)) {
    return false;
  }

  const stripped = stripOwnCompanyIdentityFromText(description, ownIdentity);
  // Analysis-key tarzı meta artıkları da düş (SORGU/NOLU/TARIHLI vb.)
  let cleaned = stripped;
  cleaned = cleaned.replace(/\bTARIHLI\b/g, " ");
  cleaned = cleaned.replace(
    /\b(SORGU|REFERANS|REF|DEKONT|BATCH|PROVIZYON|SIRA)\s*(NO LU|NOLU|NUMARALI|NUMARASI|NUMARA|NO)?\b/g,
    " "
  );
  cleaned = cleaned.replace(/\b(NO LU|NOLU|NUMARALI)\b/g, " ");
  cleaned = cleaned.replace(/\b\d{4,}\b/g, " ");
  const remainder = stripTransactionalNoise(cleaned);
  const core = localNormalizeCariNameCore(remainder);
  if (!core) return true;

  const distinctive = core
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length >= 3 && !OWN_STRIP_SERVICE_NOISE.has(t));

  return distinctive.length === 0;
}

export function stripTransactionalNoise(text = "") {
  let norm = normalizeParserText(text);
  if (!norm) return "";

  norm = norm.replace(/\bTR\d{2}[\d\s]{10,30}\b/g, " ");
  norm = norm.replace(/\bTR\d{24}\b/g, " ");
  norm = norm.replace(/\b\d{1,2}\s+\d{1,2}\s+\d{4}\b/g, " ");
  norm = norm.replace(/\b\d{4}\s+\d{1,2}\s+\d{1,2}\b/g, " ");
  norm = norm.replace(/\b\d{6,}\b/g, " ");

  for (const phrase of NOISE_PHRASES) {
    norm = norm.replace(phrase, " ");
  }

  norm = norm
    .split(/\s+/)
    .filter((token) => {
      if (!token) return false;
      if (MONTH_TOKENS.has(token)) return false;
      if (/^\d+$/.test(token) && token.length <= 4) return false;
      return true;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return localNormalizeCariName(norm);
}

export function extractTransferCounterparty(
  description = "",
  direction = "",
  ownIdentity = null
) {
  const norm = normalizeParserText(description);
  if (!norm.includes("HESABINDAN") || !norm.includes("HESABINA")) {
    return "";
  }

  const match = norm.match(
    /(.+?)\s+HESABINDAN\s+(.+?)\s+HESABINA(?:\s+(?:HAVALE|EFT|FAST))?(?:\s+YAPILMISTIR)?/
  );
  if (!match) return "";

  const fromRaw = stripTransactionalNoise(match[1]);
  const toRaw = stripTransactionalNoise(match[2]);
  const dir = resolveDir(direction);

  const fromOwn = isOwnCompanyPartyName(fromRaw, ownIdentity);
  const toOwn = isOwnCompanyPartyName(toRaw, ownIdentity);

  if (dir === "CIKIS") {
    if (toRaw && !toOwn) return toRaw;
    if (fromRaw && !fromOwn) return fromRaw;
    return toRaw || fromRaw || "";
  }

  if (dir === "GIRIS") {
    if (fromRaw && !fromOwn) return fromRaw;
    if (toRaw && !toOwn) return toRaw;
    return fromRaw || toRaw || "";
  }

  if (toRaw && !toOwn) return toRaw;
  if (fromRaw && !fromOwn) return fromRaw;
  return "";
}

function pickBestDescriptionSegment(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return "";

  if (text.includes("/")) {
    const parts = text
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    let best = "";
    let bestScore = -1;
    for (const part of parts) {
      const compact = part.replace(/\s+/g, "");
      if (/^TR\d{16,}/i.test(compact)) continue;
      if (/^\d+$/.test(compact)) continue;
      const cleaned = stripTransactionalNoise(part);
      if (!cleaned || cleaned.length < 3) continue;
      const tokens = cleaned.split(/\s+/).filter(Boolean);
      const score =
        cleaned.replace(/\s+/g, "").length +
        tokens.filter((t) => t.length >= 3).length * 8;
      if (score > bestScore) {
        bestScore = score;
        best = cleaned;
      }
    }
    if (best) return best;
  }

  return stripTransactionalNoise(text);
}

export function extractCounterpartyParty({
  description = "",
  direction = "",
  ownIdentity = null,
} = {}) {
  const transfer = extractTransferCounterparty(description, direction, ownIdentity);
  if (transfer && !isOwnCompanyPartyName(transfer, ownIdentity)) {
    return localNormalizeCariName(transfer);
  }

  const segment = pickBestDescriptionSegment(description);
  if (segment && !isOwnCompanyPartyName(segment, ownIdentity)) {
    return localNormalizeCariName(segment);
  }

  return "";
}

export function parseCariDisplayDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return Number.POSITIVE_INFINITY;
  const dmy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) {
    return Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

export function sortCariDisplayDates(dates = []) {
  return [...dates]
    .filter(Boolean)
    .sort((a, b) => parseCariDisplayDate(a) - parseCariDisplayDate(b));
}

export function buildCariParentCodeSet(accountCodes = []) {
  const codes = [...new Set(accountCodes.map(compactCode).filter(Boolean))];
  const parents = new Set(BARE_CARI_MAINS);

  for (const code of codes) {
    if (BARE_CARI_MAINS.has(code)) parents.add(code);
    for (const other of codes) {
      if (other !== code && other.startsWith(`${code}.`)) {
        parents.add(code);
        break;
      }
    }
  }

  return parents;
}

export function isSelectableCariLeafAccount(code = "", parentCodeSet = null) {
  const compact = compactCode(code);
  if (!compact) return false;
  if (BARE_CARI_MAINS.has(compact)) return false;
  if (parentCodeSet?.has(compact)) return false;
  return true;
}

export function compactCariAccountCode(value = "") {
  return compactCode(value);
}
