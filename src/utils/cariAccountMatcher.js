import { CARI_SHORT_CODE_MAPPINGS } from "@/src/config/cariShortCodeMappings";
import { normalizeParserText } from "@/src/utils/textNormalize";

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

const CARI_GROUP_PRIORITY = [
  { prefix: "320", priority: 1 },
  { prefix: "120", priority: 2 },
  { prefix: "329", priority: 3 },
  { prefix: "336", priority: 4 },
];

const OTHER_CARI_PREFIXES = ["331", "337", "338", "339"];

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

function extractNameFromStructuredText(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  if (raw.includes("/")) {
    return raw.split("/").pop().trim();
  }

  if (raw.includes("-")) {
    const parts = raw.split("-");
    const tail = parts[parts.length - 1].trim();
    if (tail.length >= 3) return tail;
  }

  return raw;
}

function isLikelyReferenceToken(token) {
  const value = String(token || "");
  if (!value) return true;
  if (/^\d+$/.test(value) && value.length >= 6) return true;
  return false;
}

function extractCariNamesFromDescription(description) {
  const raw = String(description || "");
  const names = [];

  const pushPart = (part) => {
    const cleaned = normalizeCariName(part);
    if (cleaned && cleaned.length >= 3) names.push(cleaned);
  };

  pushPart(extractNameFromStructuredText(raw));

  if (raw.includes("-")) {
    pushPart(raw.split("-").pop());
  }

  if (raw.includes("/")) {
    pushPart(raw.split("/").pop());
  }

  const words = normalizeParserText(raw).split(" ").filter(Boolean);
  const meaningfulWords = words.filter((word) => !isLikelyReferenceToken(word));

  if (meaningfulWords.length >= 2) {
    pushPart(meaningfulWords.slice(-2).join(" "));
  }

  if (meaningfulWords.length >= 3) {
    pushPart(meaningfulWords.slice(-3).join(" "));
  }

  pushPart(meaningfulWords.join(" "));
  pushPart(raw);

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

function scoreCariMatch(accountName, candidateName) {
  const accountFull = normalizeCariName(accountName);
  const accountCore = normalizeCariNameCore(accountName);
  const candidateFull = normalizeCariName(candidateName);
  const candidateCore = normalizeCariNameCore(candidateName);

  if (!accountCore || !candidateCore) return 0;

  if (accountCore === candidateCore) return 1000;
  if (accountFull === candidateFull) return 950;

  if (
    accountCore.includes(candidateCore) ||
    candidateCore.includes(accountCore)
  ) {
    return 850 + Math.min(accountCore.length, candidateCore.length);
  }

  const accountWords = accountCore.split(" ").filter((word) => word.length >= 3);
  const candidateWords = candidateCore
    .split(" ")
    .filter((word) => word.length >= 3);

  if (candidateWords.length === 0) return 0;

  const overlap = candidateWords.filter((word) =>
    accountWords.some(
      (accountWord) =>
        accountWord.includes(word) ||
        word.includes(accountWord) ||
        accountWord === word
    )
  );

  if (overlap.length >= 2) {
    return 600 + overlap.length * 40;
  }

  if (overlap.length === 1 && candidateWords.length === 1) {
    return 450;
  }

  if (overlap.length === 1) {
    return 350 + overlap[0].length;
  }

  return 0;
}

function rankCariAccounts(cariAccounts, candidates) {
  const ranked = [];

  for (const item of cariAccounts) {
    let bestScore = 0;
    let bestCandidate = "";

    for (const candidate of candidates) {
      const score = scoreCariMatch(item.name, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestScore <= 0) continue;

    ranked.push({
      ...item,
      score: bestScore,
      matchedCandidate: bestCandidate,
      rank: bestScore * 100 - item.priority,
    });
  }

  return ranked.sort((a, b) => b.rank - a.rank);
}

export function formatCariSuggestion(account) {
  const code = getAccountCode(account);
  const name = getAccountName(account);
  return name ? `${code} ${name}` : code;
}

export function collectCariSuggestions(companyPlans, candidates, limit = 3) {
  const cariAccounts = getCariAccountsFromPlan(companyPlans);
  const ranked = rankCariAccounts(cariAccounts, candidates);
  const seen = new Set();
  const suggestions = [];

  for (const item of ranked) {
    const key = compactAccount(item.code);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    suggestions.push({
      code: item.code,
      name: item.name,
      label: formatCariSuggestion(item.account),
    });

    if (suggestions.length >= limit) break;
  }

  return suggestions;
}

export function buildCariNotFoundWarning(suggestions = []) {
  if (!suggestions.length) {
    return "Cari hesap bulunamadı";
  }

  return `Cari hesap bulunamadı. Öneriler: ${suggestions
    .map((item) => item.label)
    .join(", ")}`;
}

export function resolveCariAccountMatch(companyPlans, sources = {}) {
  const candidates = buildCariSearchCandidates(sources);

  if (!candidates.length || !companyPlans?.length) {
    return {
      code: "",
      matchedName: "",
      note: "",
      suggestions: [],
    };
  }

  const cariAccounts = getCariAccountsFromPlan(companyPlans);
  const ranked = rankCariAccounts(cariAccounts, candidates);
  const best = ranked[0];

  if (best && best.score >= 350) {
    return {
      code: best.code,
      matchedName: best.name,
      note: "Cari hesap eşleşti",
      suggestions: [],
    };
  }

  return {
    code: "",
    matchedName: "",
    note: "",
    suggestions: collectCariSuggestions(companyPlans, candidates),
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
