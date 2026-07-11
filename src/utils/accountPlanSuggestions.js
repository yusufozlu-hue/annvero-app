import { normalizeParserText } from "@/src/utils/bankMovementMapper";
import { MEMORY_MATCH_LABEL } from "@/src/utils/previewRowEdit";

function compactAccount(code) {
  return normalizeParserText(code).replace(/\s+/g, "");
}

function getAccountCode(account) {
  return account?.accountCode || account?.hesapKodu || "";
}

function getAccountName(account) {
  return account?.accountName || account?.hesapAdi || "";
}

/** Hesap planı kod Set'i — O(1) exact varlık kontrolü */
export function buildAccountPlanCodeSet(companyPlans = []) {
  const set = new Set();
  for (const account of companyPlans || []) {
    if (account?.isActive === false) continue;
    const code = compactAccount(getAccountCode(account));
    if (code) set.add(code);
  }
  return set;
}

/**
 * Exact match: planCodeSet varsa O(1), yoksa dizi taraması.
 * Fuzzy/öneri bu fonksiyonda çalışmaz.
 */
export function accountExistsInCompanyPlan(
  companyPlans,
  accountCode,
  planCodeSet = null
) {
  if (!accountCode) return false;

  const wanted = compactAccount(accountCode);
  if (!wanted) return false;

  if (planCodeSet instanceof Set) {
    return planCodeSet.has(wanted);
  }

  if (!companyPlans?.length) return false;

  return companyPlans.some((account) => {
    if (account?.isActive !== false) {
      return compactAccount(getAccountCode(account)) === wanted;
    }
    return false;
  });
}

function getMainAccount(code) {
  const compact = compactAccount(code);
  const firstSegment = compact.split(".")[0] || compact;

  if (/^\d/.test(firstSegment)) {
    return firstSegment.slice(0, 3);
  }

  return firstSegment.slice(0, 3);
}

function getCodePrefixDepth(leftCode, rightCode) {
  const left = compactAccount(leftCode);
  const right = compactAccount(rightCode);
  let depth = 0;
  const max = Math.min(left.length, right.length);

  for (let index = 0; index < max; index += 1) {
    if (left[index] !== right[index]) break;
    depth += 1;
  }

  return depth;
}

function getContextWords(contextText) {
  return normalizeParserText(contextText)
    .split(" ")
    .filter((word) => word.length >= 3);
}

function scoreSimilarAccount(account, missingCode, contextWords) {
  const code = getAccountCode(account);

  if (!code || account?.isActive === false) return -1;
  if (compactAccount(code) === compactAccount(missingCode)) return -1;

  let score = 0;
  const mainMissing = getMainAccount(missingCode);
  const mainCandidate = getMainAccount(code);

  if (mainMissing && mainCandidate === mainMissing) {
    score += 1000;
  }

  const name = normalizeParserText(getAccountName(account));
  const nameWords = name.split(" ").filter((word) => word.length >= 3);

  for (const word of contextWords) {
    if (name.includes(word)) score += 50;
    if (nameWords.some((nameWord) => nameWord.includes(word) || word.includes(nameWord))) {
      score += 30;
    }
  }

  score += getCodePrefixDepth(missingCode, code);

  return score;
}

export function formatAccountSuggestion(account) {
  const code = getAccountCode(account);
  const name = getAccountName(account);

  return name ? `${code} ${name}` : code;
}

export function findSimilarAccountsInPlan(
  companyPlans,
  missingCode,
  contextText = "",
  limit = 3,
  planCodeSet = null
) {
  if (!missingCode || !companyPlans?.length) return [];

  // Exact kod planda varsa fuzzy öneri üretme
  if (accountExistsInCompanyPlan(companyPlans, missingCode, planCodeSet)) {
    return [];
  }

  const contextWords = getContextWords(contextText);
  const mainMissing = getMainAccount(missingCode);

  // Aynı ana hesap grubuna öncelik — full plan fuzzy'sini daralt
  const scoped = mainMissing
    ? companyPlans.filter((account) => {
        if (account?.isActive === false) return false;
        return getMainAccount(getAccountCode(account)) === mainMissing;
      })
    : companyPlans;

  const pool = scoped.length ? scoped : companyPlans;

  const ranked = pool
    .map((account) => ({
      account,
      score: scoreSimilarAccount(account, missingCode, contextWords),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const seen = new Set();
  const results = [];

  for (const item of ranked) {
    const code = getAccountCode(item.account);
    const key = compactAccount(code);

    if (!key || seen.has(key)) continue;

    seen.add(key);
    results.push(item.account);

    if (results.length >= limit) break;
  }

  return results;
}

export function collectAccountSuggestions(
  companyPlans,
  missingCodes,
  contextText = "",
  limit = 3,
  planCodeSet = null
) {
  const uniqueCodes = [...new Set((missingCodes || []).filter(Boolean))];
  const suggestions = [];
  const seen = new Set();

  for (const code of uniqueCodes) {
    const matches = findSimilarAccountsInPlan(
      companyPlans,
      code,
      contextText,
      limit,
      planCodeSet
    );

    for (const account of matches) {
      const accountCode = getAccountCode(account);
      const key = compactAccount(accountCode);

      if (!key || seen.has(key)) continue;

      seen.add(key);
      suggestions.push({
        code: accountCode,
        name: getAccountName(account),
        label: formatAccountSuggestion(account),
      });

      if (suggestions.length >= limit) break;
    }

    if (suggestions.length >= limit) break;
  }

  return suggestions;
}

export function parseSuggestionsFromWarning(warningText) {
  const match = String(warningText || "").match(/Öneriler:\s*(.+)$/i);

  if (!match) return [];

  return match[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((label) => {
      const [code, ...nameParts] = label.split(" ");

      return {
        code: code || label,
        name: nameParts.join(" "),
        label,
      };
    });
}

export function buildAccountPlanNotFoundWarning(
  companyPlans,
  missingCodes,
  contextText = "",
  limit = 3,
  planCodeSet = null
) {
  const suggestions = collectAccountSuggestions(
    companyPlans,
    missingCodes,
    contextText,
    limit,
    planCodeSet
  );

  if (suggestions.length === 0) {
    return "Hesap planında bulunamadı";
  }

  return `Hesap planında bulunamadı. Öneriler: ${suggestions
    .map((item) => item.label)
    .join(", ")}`;
}

export function resolveSuggestionTargetField(row, suggestion) {
  const missing = row.accountPlanMissing || {};
  const suggestionMain = getMainAccount(suggestion.code);

  if (missing.counterAccountCode && suggestionMain !== "102") {
    return "counterAccountCode";
  }

  if (missing.accountCode) {
    return "accountCode";
  }

  if (missing.counterAccountCode) {
    return "counterAccountCode";
  }

  return "counterAccountCode";
}

export function buildLearningMemoryAccountUpdate(row, targetField, suggestion) {
  const code = suggestion.code;
  const name = suggestion.name || "";

  if (targetField === "counterAccountCode") {
    if (row.direction === "GIRIS") {
      return {
        counter_account_code: code,
        counter_account_name: name,
      };
    }

    return {
      account_code: code,
      account_name: name,
    };
  }

  if (targetField === "accountCode") {
    if (row.direction === "GIRIS") {
      return {
        account_code: code,
        account_name: name,
      };
    }

    return {
      counter_account_code: code,
      counter_account_name: name,
    };
  }

  return {};
}

export function applySuggestionToMovement(row, suggestion, bankAccounts = []) {
  const targetField = resolveSuggestionTargetField(row, suggestion);

  const updated = {
    ...row,
    accountSuggestions: [],
    accountPlanMissing: null,
  };

  if (targetField === "accountCode") {
    updated.accountCode = resolve102BankAccount(
      bankAccounts,
      suggestion.code,
      suggestion.code
    );
  } else {
    updated.counterAccountCode = suggestion.code;
  }

  const warnings = [];

  if (
    row.matchedMemoryId ||
    row.warning?.includes(MEMORY_MATCH_LABEL) ||
    row.warning?.includes("Öğrenen hafızadan eşleşti")
  ) {
    warnings.push(MEMORY_MATCH_LABEL);
  }

  warnings.push("Önerilen hesap uygulandı");
  updated.warning = warnings.join(" | ");

  return updated;
}
