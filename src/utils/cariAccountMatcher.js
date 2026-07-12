import { CARI_SHORT_CODE_MAPPINGS } from "@/src/config/cariShortCodeMappings";
import { normalizeBankAnalysisKey, normalizeParserText, resolveLucaRowBankDirection } from "@/src/utils/textNormalize";
import {
  CARI_NOT_REQUIRED_TYPES,
  CARI_REQUIRED_TYPES,
  PERSONEL_REQUIRED_TYPES,
  isLikelyCariGlAccount,
  isExpenseOrIncomeGlAccount,
} from "@/src/utils/bankTransactionType";

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

/** Tek başına karar vermeyen genel kelimeler */
export const CARI_GENERIC_TOKENS = new Set([
  "TURIZM",
  "TURIZMI",
  "INSAAT",
  "OTEL",
  "OTELI",
  "RESORT",
  "HOTEL",
  "KONAKLAMA",
  "REZERVASYON",
  "MUSTERI",
  "GECELIK",
  "ODA",
  "GIDA",
  "TEKSTIL",
  "YAPI",
  "PROJE",
  "DANISMANLIK",
  "HIZMET",
  "HIZMETLERI",
  "LOJISTIK",
  "NAKLIYE",
  "SANAYI",
  "PAZARLAMA",
  "ITHALAT",
  "IHRACAT",
  "ELEKTRONIK",
  "BILISIM",
  "YAZILIM",
  "ORGANIZASYON",
  "ORGANIZASYONU",
  "SEYAHAT",
  "ACENTASI",
  "ACENTA",
  "HOLDING",
  "GRUP",
  "GROUP",
  "COMPANY",
  "CO",
]);

const HAVALE_PREFIX_RE =
  /^(GLN\.?\s*HVL|GOND\.?\s*HVL|GÖND\.?\s*HVL|GELEN\s+HAVALE|GIDEN\s+HAVALE|GELEN\s+EFT|GONDERILEN\s+(HAVALE|EFT))\s*\/?\s*/i;

const CARI_GROUP_PRIORITY = [
  { prefix: "320", priority: 1 },
  { prefix: "120", priority: 2 },
  { prefix: "329", priority: 3 },
  { prefix: "336", priority: 4 },
];

const OTHER_CARI_PREFIXES = ["331", "337", "338", "339"];

/** Kullanıcı ölçeği: 80+ otomatik, altı inceleme */
export const CARI_AUTO_APPLY_MIN_CONFIDENCE = 80;

export const CARI_MATCH_REASON = {
  FIRMA_HAFIZA: "firma hafızası",
  ANALYSIS_KEY: "öğrenilmiş analysisKey",
  VERGI_NO: "exact vergi no",
  IBAN: "exact IBAN",
  IBAN_HISTORY: "aynı IBAN geçmişi",
  UNVAN: "exact unvan",
  ALIAS: "alias exact",
  LEARNED_DESCRIPTION: "öğrenilmiş açıklama",
  TOKEN_STRONG: "güçlü token",
  TOKEN_WEAK: "düşük güven token",
  NONE: "eşleşmedi",
};

function compactAccount(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function getAccountCode(account) {
  return account?.accountCode || account?.hesapKodu || "";
}

function getAccountName(account) {
  return account?.accountName || account?.hesapAdi || "";
}

export function normalizeCariName(value) {
  let text = normalizeParserText(value);

  text = text
    .replace(/\bA\s*\.\s*S\b/g, " AS ")
    .replace(/\bA\s*S\b/g, " AS ")
    .replace(/\bANONIM\s+SIRKETI\b/g, " AS ")
    .replace(/\bLTD\s*\.\s*STI\b/g, " LTD STI ")
    .replace(/\bLTD\s+STI\b/g, " LTD STI ")
    .replace(/\bLTD\b/g, " LTD ")
    .replace(/\bLIMITED\b/g, " LTD ")
    .replace(/\bTICARET\s+VE\s+SAN\b/g, " TICARET SAN ")
    .replace(/\bTIC\b/g, " TICARET ")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

export function normalizeCariNameCore(value) {
  const tokens = normalizeCariName(value)
    .split(" ")
    .filter((token) => token && !COMPANY_SUFFIX_TOKENS.has(token));

  return tokens.join(" ").trim();
}

function getCariGroupPriority(code) {
  const compact = compactAccount(code);

  for (const group of CARI_GROUP_PRIORITY) {
    if (compact.startsWith(group.prefix)) {
      return group.priority;
    }
  }

  if (OTHER_CARI_PREFIXES.some((prefix) => compact.startsWith(prefix))) {
    return 5;
  }

  return 99;
}

function isCariAccount(account) {
  const code = getAccountCode(account);
  if (!code || account?.isActive === false) return false;
  return getCariGroupPriority(code) < 99;
}

function getCariAccountsFromPlan(companyPlans = []) {
  return companyPlans
    .filter(isCariAccount)
    .map((account) => ({
      account,
      code: getAccountCode(account),
      name: getAccountName(account),
      priority: getCariGroupPriority(getAccountCode(account)),
    }))
    .sort((a, b) => a.priority - b.priority);
}

function isGenericToken(token = "") {
  return CARI_GENERIC_TOKENS.has(String(token || "").trim());
}

function isUsableMatchToken(token = "") {
  const value = String(token || "").trim();
  if (value.length < 3) return false;
  if (isGenericToken(value)) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
}

function distinctiveTokens(nameCore = "") {
  return normalizeCariNameCore(nameCore)
    .split(" ")
    .filter(isUsableMatchToken);
}

/**
 * Cari indeksi — işlem başında bir kez.
 */
export function buildCariMatchIndex(companyPlans = []) {
  const accounts = getCariAccountsFromPlan(companyPlans);
  const byNormalizedName = new Map();
  const byNormalizedCore = new Map();
  const byVergiNo = new Map();
  const byIban = new Map();
  const byToken = new Map();
  const byAlias = new Map();

  for (const item of accounts) {
    const full = normalizeCariName(item.name);
    const core = normalizeCariNameCore(item.name);
    if (full) byNormalizedName.set(full, item);
    if (core) byNormalizedCore.set(core, item);

    const vergi =
      item.account?.vergiNo ||
      item.account?.taxNo ||
      item.account?.vkn ||
      item.account?.tckn ||
      "";
    const vergiKey = String(vergi).replace(/\D/g, "");
    if (vergiKey.length >= 10) byVergiNo.set(vergiKey, item);

    const ibanRaw =
      item.account?.iban || item.account?.IBAN || item.account?.ibanNo || "";
    const ibanKey = normalizeParserText(ibanRaw).replace(/\s+/g, "");
    if (ibanKey.length >= 15) byIban.set(ibanKey, item);

    for (const token of distinctiveTokens(core)) {
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token).push(item);
    }

    const aliases = [
      ...(item.account?.aliases || []),
      ...(item.account?.bankAliases || []),
    ];
    for (const alias of aliases) {
      const aliasKey = normalizeCariNameCore(alias);
      if (aliasKey) byAlias.set(aliasKey, item);
      const aliasFull = normalizeCariName(alias);
      if (aliasFull) byAlias.set(aliasFull, item);
    }
  }

  return {
    accounts,
    byNormalizedName,
    byNormalizedCore,
    byVergiNo,
    byIban,
    byToken,
    byAlias,
    cariCount: accounts.length,
  };
}

function extractVergiNoFromText(text) {
  return String(text || "").match(/\b\d{10,11}\b/g) || [];
}

function extractIbanFromText(text) {
  const normalized = normalizeParserText(text).replace(/\s+/g, "");
  const match = normalized.match(/TR\d{24}/);
  return match ? match[0] : "";
}

function stripHavalePrefix(raw = "") {
  return String(raw || "")
    .replace(HAVALE_PREFIX_RE, "")
    .replace(/^INT[-\s]*/i, "")
    .replace(/^MOBIL[-\s]*/i, "")
    .replace(/^CEP\s*SUBE[-\s]*/i, "")
    .trim();
}

function extractNameFromStructuredText(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  if (raw.includes("/")) {
    return stripHavalePrefix(raw.split("/").pop().trim());
  }

  if (raw.includes("-")) {
    const parts = raw.split("-");
    const tail = parts[parts.length - 1].trim();
    if (tail.length >= 3) return stripHavalePrefix(tail);
  }

  return stripHavalePrefix(raw);
}

function isLikelyReferenceToken(token) {
  const value = String(token || "");
  if (!value) return true;
  if (/^\d+$/.test(value) && value.length >= 4) return true;
  return false;
}

/**
 * Açıklamadan cari aday unvanları üretir.
 * GLN. HVL / … ve konaklama gürültüsünü ayıklar.
 */
function extractCariNamesFromDescription(description) {
  const raw = String(description || "");
  const names = [];

  const pushPart = (part) => {
    const cleaned = normalizeCariName(stripHavalePrefix(part));
    if (!cleaned || cleaned.length < 3) return;
    names.push(cleaned);

    const core = normalizeCariNameCore(cleaned);
    const tokens = core.split(" ").filter(Boolean);
    const distinctive = tokens.filter(isUsableMatchToken);

    if (distinctive.length >= 2) {
      names.push(distinctive.slice(0, 2).join(" "));
      // Kaydıran ikililer (MUT MARE vb.)
      for (let i = 0; i < distinctive.length - 1; i += 1) {
        names.push(`${distinctive[i]} ${distinctive[i + 1]}`);
      }
    }
    if (distinctive.length >= 3) {
      names.push(distinctive.slice(0, 3).join(" "));
      for (let i = 0; i < distinctive.length - 2; i += 1) {
        names.push(distinctive.slice(i, i + 3).join(" "));
      }
      names.push(distinctive.join(" "));
    }

    // Genel kelimeleri düşürülmüş çekirdek
    if (distinctive.length && distinctive.length < tokens.length) {
      names.push(distinctive.join(" "));
    }
  };

  pushPart(extractNameFromStructuredText(raw));

  if (raw.includes("/")) {
    pushPart(raw.split("/").pop());
  }

  if (raw.includes("-")) {
    pushPart(raw.split("-").pop());
  }

  const words = normalizeParserText(stripHavalePrefix(raw))
    .split(" ")
    .filter(Boolean);
  const meaningfulWords = words.filter((word) => !isLikelyReferenceToken(word));

  if (meaningfulWords.length >= 2) {
    pushPart(meaningfulWords.slice(0, 2).join(" "));
    pushPart(meaningfulWords.slice(-2).join(" "));
  }
  if (meaningfulWords.length >= 3) {
    pushPart(meaningfulWords.slice(0, 3).join(" "));
  }
  pushPart(meaningfulWords.filter(isUsableMatchToken).join(" "));

  return [...new Set(names.map(normalizeCariName).filter(Boolean))];
}

function resolveShortCodeCandidates(description) {
  const text = normalizeParserText(description);
  const candidates = [];

  for (const mapping of CARI_SHORT_CODE_MAPPINGS) {
    const matched = mapping.keys.some((key) => {
      const normalizedKey = normalizeParserText(key);
      if (!normalizedKey) return false;

      if (normalizedKey.includes(" ")) {
        return text.includes(normalizedKey);
      }

      return text
        .split(" ")
        .some((word) => word === normalizedKey || word.startsWith(normalizedKey));
    });

    if (!matched) continue;

    for (const name of mapping.names || []) {
      candidates.push(normalizeCariName(name));
    }
  }

  return candidates;
}

export function buildCariSearchCandidates(sources = {}) {
  const { description = "", lucaDescription = "", ruleAciklama = "" } = sources;
  const candidates = new Set();

  for (const name of extractCariNamesFromDescription(description)) {
    candidates.add(name);
  }
  for (const name of extractCariNamesFromDescription(lucaDescription)) {
    candidates.add(name);
  }
  for (const name of extractCariNamesFromDescription(ruleAciklama)) {
    candidates.add(name);
  }
  for (const name of resolveShortCodeCandidates(description)) {
    candidates.add(name);
  }

  return [...candidates].filter(Boolean);
}

/**
 * 0–100 güven skoru (kullanıcı ölçeği).
 */
function scoreCariMatchConfidence(accountName, candidateName) {
  const accountFull = normalizeCariName(accountName);
  const accountCore = normalizeCariNameCore(accountName);
  const candidateFull = normalizeCariName(candidateName);
  const candidateCore = normalizeCariNameCore(candidateName);

  if (!accountCore || !candidateCore) {
    return { confidence: 0, reason: CARI_MATCH_REASON.NONE };
  }

  // Çok kısa tek parça aday — otomatik yok
  const candidateTokens = candidateCore.split(" ").filter(Boolean);
  const candidateDistinct = distinctiveTokens(candidateCore);
  if (candidateCore.replace(/\s+/g, "").length < 5 && candidateTokens.length < 2) {
    return { confidence: 0, reason: CARI_MATCH_REASON.NONE };
  }

  if (accountCore === candidateCore || accountFull === candidateFull) {
    return { confidence: 95, reason: CARI_MATCH_REASON.UNVAN };
  }

  // Tek genel kelime asla
  if (
    candidateTokens.length === 1 &&
    (isGenericToken(candidateTokens[0]) || candidateTokens[0].length < 4)
  ) {
    return { confidence: 0, reason: CARI_MATCH_REASON.NONE };
  }

  const accountWords = distinctiveTokens(accountCore);
  const accountAll = accountCore.split(" ").filter((t) => t.length >= 3);

  // Alt küme / kapsama — unvan parçasının planda geçmesi (örn. ABC INSAAT ⊂ ABC INSAAT SAN…)
  if (
    candidateCore.length >= 6 &&
    candidateTokens.length >= 2 &&
    (accountCore.includes(candidateCore) || candidateCore.includes(accountCore))
  ) {
    const conf = Math.min(
      92,
      84 + Math.min(candidateTokens.length, accountAll.length) * 2
    );
    return { confidence: conf, reason: CARI_MATCH_REASON.TOKEN_STRONG };
  }

  if (!accountWords.length && !accountAll.length) {
    return { confidence: 0, reason: CARI_MATCH_REASON.NONE };
  }

  if (
    candidateDistinct.length >= 2 &&
    (accountCore.includes(candidateCore) || candidateCore.includes(accountCore))
  ) {
    const conf = Math.min(
      92,
      82 + Math.min(candidateDistinct.length, accountWords.length || 1) * 3
    );
    return { confidence: conf, reason: CARI_MATCH_REASON.TOKEN_STRONG };
  }

  const overlap = candidateDistinct.filter((word) =>
    (accountWords.length ? accountWords : accountAll).some(
      (accountWord) =>
        accountWord === word ||
        (word.length >= 5 && accountWord.includes(word)) ||
        (accountWord.length >= 5 && word.includes(accountWord))
    )
  );

  if (overlap.length >= 2) {
    const conf = Math.min(89, 80 + overlap.length * 3);
    return { confidence: conf, reason: CARI_MATCH_REASON.TOKEN_STRONG };
  }

  // Tek ayırt edici token: yalnızca öneri (otomatik değil)
  if (overlap.length === 1) {
    const token = overlap[0];
    if (token.length < 5) {
      return { confidence: 0, reason: CARI_MATCH_REASON.NONE };
    }
    if (candidateDistinct.length === 1 && accountWords.length > 3) {
      return { confidence: 45, reason: CARI_MATCH_REASON.TOKEN_WEAK };
    }
    return {
      confidence: Math.min(72, 55 + token.length),
      reason: CARI_MATCH_REASON.TOKEN_WEAK,
    };
  }

  return { confidence: 0, reason: CARI_MATCH_REASON.NONE };
}

function rankCariAccounts(cariAccounts, candidates) {
  const ranked = [];

  for (const item of cariAccounts) {
    let bestConfidence = 0;
    let bestCandidate = "";
    let bestReason = CARI_MATCH_REASON.NONE;

    for (const candidate of candidates) {
      const { confidence, reason } = scoreCariMatchConfidence(item.name, candidate);
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestCandidate = candidate;
        bestReason = reason;
      }
    }

    if (bestConfidence <= 0) continue;

    ranked.push({
      ...item,
      confidence: bestConfidence,
      score: bestConfidence,
      matchedCandidate: bestCandidate,
      matchReason: bestReason,
      rank: bestConfidence * 100 - item.priority,
    });
  }

  return ranked.sort((a, b) => b.rank - a.rank);
}

export function formatCariSuggestion(account) {
  const code = getAccountCode(account);
  const name = getAccountName(account);
  return name ? `${code} ${name}` : code;
}

function toSuggestionPayload(item) {
  return {
    code: item.code,
    name: item.name,
    label: formatCariSuggestion(item.account || { accountCode: item.code, accountName: item.name }),
    confidence: item.confidence ?? item.score ?? 0,
    matchReason: item.matchReason || CARI_MATCH_REASON.TOKEN_WEAK,
    matchedCandidate: item.matchedCandidate || "",
  };
}

export function collectCariSuggestions(
  companyPlans,
  candidates,
  limit = 3,
  cariIndex = null
) {
  const cariAccounts = cariIndex?.accounts || getCariAccountsFromPlan(companyPlans);
  const ranked = rankCariAccounts(cariAccounts, candidates);
  const seen = new Set();
  const suggestions = [];

  for (const item of ranked) {
    const key = compactAccount(item.code);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    suggestions.push(toSuggestionPayload(item));
    if (suggestions.length >= limit) break;
  }

  return suggestions;
}

export function buildCariNotFoundWarning(suggestions = []) {
  if (!suggestions.length) {
    return "Cari hesap bulunamadı";
  }

  return `Cari hesap bulunamadı. Öneriler: ${suggestions
    .map((item) => {
      const conf =
        item.confidence != null ? ` (${item.confidence}% ${item.matchReason || ""})` : "";
      return `${item.label}${conf}`.trim();
    })
    .join(", ")}`;
}

function emptyMatchResult(suggestions = []) {
  return {
    code: "",
    matchedName: "",
    note: "",
    confidence: 0,
    matchReason: CARI_MATCH_REASON.NONE,
    autoApplied: false,
    suggestions,
    extractedParty: "",
    hasVergiNo: false,
    hasIban: false,
  };
}

function memoryHitToResult(record, reason, extractedParty, vergiList, iban) {
  const code = String(record.accountCode || record.cariId || "").trim();
  if (!code || isExpenseOrIncomeGlAccount(code)) return null;
  if (!isLikelyCariGlAccount(code)) return null;
  return {
    code,
    matchedName: record.accountName || record.cariName || "",
    note: "Cari hesap eşleşti",
    confidence: 100,
    matchReason: reason,
    autoApplied: true,
    suggestions: [],
    extractedParty,
    hasVergiNo: vergiList.length > 0,
    hasIban: Boolean(iban),
    fromMemory: true,
  };
}

function bumpCariStat(stats, key) {
  if (!stats) return;
  stats[key] = (stats[key] || 0) + 1;
}

export function resolveCariAccountMatch(companyPlans, sources = {}) {
  const candidates = buildCariSearchCandidates(sources);
  const stats = sources.stats || null;
  const index =
    sources.cariIndex ||
    (companyPlans?.length ? buildCariMatchIndex(companyPlans) : null);

  const haystack = [
    sources.description,
    sources.lucaDescription,
    sources.ruleAciklama,
  ]
    .filter(Boolean)
    .join(" ");

  const vergiList = extractVergiNoFromText(haystack);
  const iban = extractIbanFromText(haystack);
  const extractedParty =
    extractNameFromStructuredText(sources.lucaDescription || sources.description || "") ||
    candidates[0] ||
    "";

  // Mapper önceden çözülmüş firma hafızası kayıtları
  const preMemoryHits = [
    {
      record: sources.analysisKeyMemory || null,
      reason: CARI_MATCH_REASON.ANALYSIS_KEY,
      stat: "cariFromAnalysisKey",
    },
    {
      record: sources.firmaMemoryRecord || null,
      reason: CARI_MATCH_REASON.FIRMA_HAFIZA,
      stat: "cariFromFirmaMemory",
    },
  ];

  for (const item of preMemoryHits) {
    if (!item.record) continue;
    const hit = memoryHitToResult(
      item.record,
      item.reason,
      extractedParty,
      vergiList,
      iban
    );
    if (hit) {
      bumpCariStat(stats, item.stat);
      bumpCariStat(stats, "cariFromFirmaMemory");
      bumpCariStat(stats, "cariExactHit");
      return hit;
    }
  }

  // Exact IBAN (plan)
  if (iban && index?.byIban?.get(iban)) {
    const hit = index.byIban.get(iban);
    bumpCariStat(stats, "cariExactHit");
    bumpCariStat(stats, "cariFromIban");
    return {
      code: hit.code,
      matchedName: hit.name,
      note: "Cari hesap eşleşti",
      confidence: 100,
      matchReason: CARI_MATCH_REASON.IBAN,
      autoApplied: true,
      suggestions: [],
      extractedParty,
      hasVergiNo: vergiList.length > 0,
      hasIban: true,
    };
  }

  // 3) Exact Vergi No
  for (const vergi of vergiList) {
    const hit = index?.byVergiNo?.get(vergi);
    if (hit) {
      bumpCariStat(stats, "cariExactHit");
      bumpCariStat(stats, "cariFromVergiNo");
      return {
        code: hit.code,
        matchedName: hit.name,
        note: "Cari hesap eşleşti",
        confidence: 100,
        matchReason: CARI_MATCH_REASON.VERGI_NO,
        autoApplied: true,
        suggestions: [],
        extractedParty,
        hasVergiNo: true,
        hasIban: Boolean(iban),
      };
    }
  }

  // 4–5) Tam unvan / alias
  const sortedCandidates = [...candidates].sort(
    (a, b) =>
      normalizeCariNameCore(b).replace(/\s+/g, "").length -
      normalizeCariNameCore(a).replace(/\s+/g, "").length
  );

  const haystackNorm = normalizeParserText(haystack);
  const hotelContext =
    /\b(KONAKLAMA|RESORT|OTEL|REZERVASYON|GECELIK|MUSTERI)\b/.test(haystackNorm);

  const exactHits = [];
  for (const candidate of sortedCandidates) {
    const full = normalizeCariName(candidate);
    const core = normalizeCariNameCore(candidate);
    if (core.replace(/\s+/g, "").length < 5 && distinctiveTokens(core).length < 2) {
      continue;
    }

    const byName =
      index?.byNormalizedName?.get(full) || index?.byNormalizedCore?.get(core) || null;
    if (byName) {
      exactHits.push({
        hit: byName,
        candidate,
        confidence: 95,
        matchReason: CARI_MATCH_REASON.UNVAN,
        span: core.replace(/\s+/g, "").length,
      });
      continue;
    }

    const byAlias = index?.byAlias?.get(core) || index?.byAlias?.get(full) || null;
    if (byAlias) {
      exactHits.push({
        hit: byAlias,
        candidate,
        confidence: 90,
        matchReason: CARI_MATCH_REASON.ALIAS,
        span: core.replace(/\s+/g, "").length,
      });
    }
  }

  if (exactHits.length) {
    exactHits.sort((a, b) => {
      if (hotelContext) {
        const aBiz = /\b(OTEL|RESORT|TURIZM|KONAKLAMA)\b/.test(
          normalizeParserText(a.hit.name)
        )
          ? 1
          : 0;
        const bBiz = /\b(OTEL|RESORT|TURIZM|KONAKLAMA)\b/.test(
          normalizeParserText(b.hit.name)
        )
          ? 1
          : 0;
        if (bBiz !== aBiz) return bBiz - aBiz;
      }
      if (b.span !== a.span) return b.span - a.span;
      return b.confidence - a.confidence;
    });
    const bestExact = exactHits[0];
    bumpCariStat(stats, "cariExactHit");
    if (bestExact.matchReason === CARI_MATCH_REASON.ALIAS) {
      bumpCariStat(stats, "cariFromAlias");
    } else {
      bumpCariStat(stats, "cariFromUnvan");
    }
    return {
      code: bestExact.hit.code,
      matchedName: bestExact.hit.name,
      note: "Cari hesap eşleşti",
      confidence: bestExact.confidence,
      matchReason: bestExact.matchReason,
      autoApplied: true,
      suggestions: [],
      extractedParty,
      hasVergiNo: vergiList.length > 0,
      hasIban: Boolean(iban),
    };
  }

  // 6) Güçlü token
  const tokenCandidates = new Set();
  if (index?.byToken) {
    for (const candidate of sortedCandidates) {
      for (const token of distinctiveTokens(candidate)) {
        for (const item of index.byToken.get(token) || []) {
          tokenCandidates.add(item);
        }
      }
    }
  }

  const pool =
    tokenCandidates.size > 0 ? [...tokenCandidates] : index?.accounts || [];

  if (stats && tokenCandidates.size > 0) {
    stats.cariTokenScan = (stats.cariTokenScan || 0) + 1;
    stats.cariFuzzyCandidateCount =
      (stats.cariFuzzyCandidateCount || 0) + pool.length;
  }

  const ranked = rankCariAccounts(pool, sortedCandidates);
  const best = ranked[0];
  const suggestions = ranked.slice(0, 3).map(toSuggestionPayload);

  if (best && best.confidence >= CARI_AUTO_APPLY_MIN_CONFIDENCE) {
    bumpCariStat(stats, "cariTokenScan");
    bumpCariStat(stats, "cariFromToken");
    return {
      code: best.code,
      matchedName: best.name,
      note: "Cari hesap eşleşti",
      confidence: best.confidence,
      matchReason: best.matchReason || CARI_MATCH_REASON.TOKEN_STRONG,
      autoApplied: true,
      suggestions: [],
      extractedParty,
      hasVergiNo: vergiList.length > 0,
      hasIban: Boolean(iban),
    };
  }

  // 7) Öğrenilmiş açıklama (mapper ön-çözümü)
  if (sources.learnedDescriptionMemory) {
    const hit = memoryHitToResult(
      sources.learnedDescriptionMemory,
      CARI_MATCH_REASON.LEARNED_DESCRIPTION,
      extractedParty,
      vergiList,
      iban
    );
    if (hit) {
      hit.confidence = Math.min(
        98,
        Number(sources.learnedDescriptionConfidence || 90)
      );
      bumpCariStat(stats, "cariFromLearnedDescription");
      bumpCariStat(stats, "cariFromFirmaMemory");
      return hit;
    }
  }

  // 8) Aynı IBAN geçmişi
  if (sources.ibanHistoryMemory) {
    const hit = memoryHitToResult(
      sources.ibanHistoryMemory,
      CARI_MATCH_REASON.IBAN_HISTORY,
      extractedParty,
      vergiList,
      iban
    );
    if (hit) {
      bumpCariStat(stats, "cariFromIbanHistory");
      bumpCariStat(stats, "cariFromFirmaMemory");
      return hit;
    }
  }

  bumpCariStat(stats, "cariUnresolved");

  return {
    code: "",
    matchedName: "",
    note: "",
    confidence: best?.confidence || 0,
    matchReason: best?.matchReason || CARI_MATCH_REASON.NONE,
    autoApplied: false,
    suggestions,
    extractedParty,
    hasVergiNo: vergiList.length > 0,
    hasIban: Boolean(iban),
  };
}

export function findCariAccountInPlan(companyPlans, description, options = {}) {
  const result = resolveCariAccountMatch(companyPlans, {
    description,
    lucaDescription: options.lucaDescription,
    ruleAciklama: options.ruleAciklama,
  });

  return result.code;
}

/**
 * “Cari bulunamadı” satırlarını analysisKey ile gruplar.
 * Cari gerektirmeyen transactionType satırları hariç tutulur.
 */
export function groupUnresolvedCariRows(rows = [], context = {}) {
  const unresolved = (rows || []).filter((row) => {
    if (row.cariRequired === false) return false;
    const type = String(row.transactionType || "");
    if (type && CARI_NOT_REQUIRED_TYPES.has(type)) return false;
    if (type && !CARI_REQUIRED_TYPES.has(type) && type !== "BILINMEYEN") {
      // Personel vb. cari grubuna alınmaz
      if (PERSONEL_REQUIRED_TYPES.has(type)) return false;
    }
    const missing =
      !String(row.hesapKodu || "").trim() || row.riskDurumu === "HESAP_EKSIK";
    if (!missing) return false;
    const cat = String(row.missingHesapCategory || "");
    if (cat && cat !== "Cari bulunamadı") return false;
    if (cat === "Cari bulunamadı") return true;
    // Eski uyarı metni — yalnızca cariRequired veya cari gereken türlerde
    const note = String(row.kontrolNotu || row.uyari || row.warning || "");
    if (!note.toLocaleLowerCase("tr").includes("cari hesap bulunamadı")) {
      return false;
    }
    if (row.cariRequired === true || CARI_REQUIRED_TYPES.has(type)) return true;
    if (!type || type === "BILINMEYEN") return true;
    return false;
  });

  const groups = new Map();
  for (const row of unresolved) {
    const desc = row.detayAciklama || row.fisAciklama || row.description || "";
    const direction = resolveLucaRowBankDirection(row, context);
    const key =
      row.analysisKey || normalizeBankAnalysisKey(desc, direction) || "unknown";
    if (!groups.has(key)) {
      groups.set(key, {
        analysisKey: key,
        count: 0,
        directions: new Set(),
        samples: [],
        rowIds: [],
        suggestion: row.cariSuggestions?.[0] || null,
      });
    }
    const group = groups.get(key);
    group.count += 1;
    if (direction) group.directions.add(direction);
    group.rowIds.push(row.id);
    if (group.samples.length < 8) {
      group.samples.push(String(desc).slice(0, 160));
    }
    if (!group.suggestion && row.cariSuggestions?.[0]) {
      group.suggestion = row.cariSuggestions[0];
    }
  }

  const companyPlans = context.companyPlans || [];
  const cariIndex =
    context.cariIndex ||
    (companyPlans.length ? buildCariMatchIndex(companyPlans) : null);

  const ranked = [...groups.values()]
    .map((group) => {
      const sample = group.samples[0] || "";
      const direction = [...group.directions][0] || "";
      const live = resolveCariAccountMatch(companyPlans, {
        description: sample,
        lucaDescription: sample,
        cariIndex,
      });
      const top = live.suggestions?.[0] || group.suggestion || null;
      const why =
        live.autoApplied
          ? "Analiz sonrası otomatik çözülebilir"
          : top
            ? `Aday var (${top.confidence}% · ${top.matchReason}) — onay bekliyor`
            : live.hasVergiNo || live.hasIban
              ? "Vergi/IBAN metinde var ama planda yok"
              : live.extractedParty
                ? `Unvan adayı: ${live.extractedParty} — planda exact/güçlü token yok`
                : "Cari adayı çıkarılamadı";

      return {
        analysisKey: group.analysisKey,
        count: group.count,
        directions: [...group.directions],
        samples: group.samples,
        rowIds: group.rowIds,
        extractedParty: live.extractedParty || "",
        hasVergiNo: live.hasVergiNo,
        hasIban: live.hasIban,
        suggestedAccount: top?.code || live.code || "",
        suggestedName: top?.name || live.matchedName || "",
        confidence: top?.confidence ?? live.confidence ?? 0,
        matchReason: top?.matchReason || live.matchReason || CARI_MATCH_REASON.NONE,
        whyUnmatched: why,
        canAutoApply:
          Boolean(top?.code) &&
          Number(top?.confidence || 0) >= CARI_AUTO_APPLY_MIN_CONFIDENCE,
      };
    })
    .sort((a, b) => b.count - a.count);

  const top20 = ranked.slice(0, 20);
  const top20Coverage = top20.reduce((sum, g) => sum + g.count, 0);

  return {
    totalUnresolved: unresolved.length,
    groupCount: ranked.length,
    top20,
    top20Coverage,
    top20CoveragePct: unresolved.length
      ? Math.round((top20Coverage / unresolved.length) * 100)
      : 0,
    allGroups: ranked,
  };
}

/**
 * Cari karar motoru özet raporu (analiz sonrası).
 */
export function buildCariDecisionReport({
  analysisStats = {},
  timings = {},
  previousMissingCount = null,
  currentMissingCount = null,
  cariGroupReport = null,
} = {}) {
  const required =
    Number(analysisStats.cariRequiredAttempts || 0) ||
    Number(analysisStats.cariAutoFound || 0) +
      Number(analysisStats.cariUnresolved || 0);
  const autoFound = Number(analysisStats.cariAutoFound || 0);
  const unresolved =
    Number(analysisStats.cariUnresolved || 0) ||
    Number(cariGroupReport?.totalUnresolved || 0);

  return {
    totalCariRequiredAttempts: required,
    autoFoundCari: autoFound,
    fromFirmaMemory: Number(analysisStats.cariFromFirmaMemory || 0),
    fromAnalysisKey: Number(analysisStats.cariFromAnalysisKey || 0),
    fromIban: Number(analysisStats.cariFromIban || 0),
    fromVergiNo: Number(analysisStats.cariFromVergiNo || 0),
    fromUnvan: Number(analysisStats.cariFromUnvan || 0),
    fromAlias: Number(analysisStats.cariFromAlias || 0),
    fromToken: Number(analysisStats.cariFromToken || 0),
    fromLearnedDescription: Number(analysisStats.cariFromLearnedDescription || 0),
    fromIbanHistory: Number(analysisStats.cariFromIbanHistory || 0),
    stillUnresolvedCari: unresolved,
    unresolvedGroups: Number(cariGroupReport?.groupCount || 0),
    previousMissingCount,
    currentMissingCount,
    missingDelta:
      previousMissingCount == null || currentMissingCount == null
        ? null
        : Number(currentMissingCount) - Number(previousMissingCount),
    analysisMs: Number(timings.totalAnalysisMs || 0),
    cariResolutionMs: Number(timings.cariResolutionMs || 0),
  };
}

export function formatCariDecisionReportText(report = {}) {
  if (!report) return "";
  const delta =
    report.missingDelta == null
      ? "—"
      : report.missingDelta > 0
        ? `+${report.missingDelta}`
        : String(report.missingDelta);
  return [
    `Cari gereken deneme: ${report.totalCariRequiredAttempts}`,
    `Otomatik bulunan cari: ${report.autoFoundCari}`,
    `  · Firma hafızası: ${report.fromFirmaMemory}`,
    `  · analysisKey: ${report.fromAnalysisKey}`,
    `  · IBAN: ${report.fromIban}`,
    `  · Alias: ${report.fromAlias}`,
    `  · Öğrenilmiş açıklama: ${report.fromLearnedDescription}`,
    `Hâlâ cari bulunamayan: ${report.stillUnresolvedCari} (${report.unresolvedGroups} grup)`,
    `Eksik hesap farkı: ${delta} (önceki ${report.previousMissingCount ?? "—"} → yeni ${report.currentMissingCount ?? "—"})`,
    `Analiz süresi: ${report.analysisMs} ms (cari ${report.cariResolutionMs} ms)`,
  ].join("\n");
}
