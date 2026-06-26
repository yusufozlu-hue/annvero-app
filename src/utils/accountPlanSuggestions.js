import { normalizeParserText } from "@/src/utils/bankMovementMapper";
import { resolve102BankAccount } from "@/src/utils/companyCenter";

function compactAccount(code) {
  return normalizeParserText(code).replace(/\s+/g, "");
}

function getAccountCode(account) {
  return account?.accountCode || account?.hesapKodu || "";
}

function getAccountName(account) {
  return account?.accountName || account?.hesapAdi || "";
}

export function accountExistsInCompanyPlan(companyPlans, accountCode) {
  if (!accountCode || !companyPlans?.length) return false;

  const wanted = compactAccount(accountCode);

  return companyPlans.some((account) => {
    if (account?.isActive === false) return false;
    return compactAccount(getAccountCode(account)) === wanted;
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
  limit = 3
) {
  if (!missingCode || !companyPlans?.length) return [];

  const contextWords = getContextWords(contextText);

  const ranked = companyPlans
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
  limit = 3
) {
  const uniqueCodes = [...new Set((missingCodes || []).filter(Boolean))];
  const suggestions = [];
  const seen = new Set();

  for (const code of uniqueCodes) {
    const matches = findSimilarAccountsInPlan(
      companyPlans,
      code,
      contextText,
      limit
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
  limit = 3
) {
  const suggestions = collectAccountSuggestions(
    companyPlans,
    missingCodes,
    contextText,
    limit
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
    row.warning?.includes("Öğrenen hafızadan eşleşti")
  ) {
    warnings.push("Öğrenen hafızadan eşleşti");
  }

  warnings.push("Önerilen hesap uygulandı");
  updated.warning = warnings.join(" | ");

  return updated;
}
