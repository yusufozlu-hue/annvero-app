import { resolve102BankAccount } from "@/src/utils/companyCenter";
import {
  accountExistsInCompanyPlan,
  buildAccountPlanNotFoundWarning,
  collectAccountSuggestions,
} from "@/src/utils/accountPlanSuggestions";
import { enhanceHgsOgsLucaDescription } from "@/src/utils/plateParser";
import {
  applyAccountingRuleToBankMovement,
  matchAccountingRule,
} from "@/src/utils/accountingRuleEngine";
import {
  buildCariNotFoundWarning,
  resolveCariAccountMatch,
} from "@/src/utils/cariAccountMatcher";
import {
  buildCreditCardPaymentDescription,
  findCreditCardByText,
  getCreditCardAccount,
} from "@/src/utils/creditCardAccountResolver";

import { normalizeParserText } from "@/src/utils/textNormalize";
import {
  buildFallbackLucaDescription,
  buildStandardLucaDescription,
} from "@/src/utils/muhasebeDescriptionStandards";
import {
  extractSeriesPrefix,
  MEMORY_MATCH_LABEL,
} from "@/src/utils/previewRowEdit";

export { normalizeParserText };
export { buildFallbackLucaDescription, buildStandardLucaDescription };

function compactAccount(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

export function formatParserDate(dateText) {
  if (!dateText) return "";

  if (dateText instanceof Date) {
    const day = String(dateText.getDate()).padStart(2, "0");
    const month = String(dateText.getMonth() + 1).padStart(2, "0");
    const year = dateText.getFullYear();
    return `${day}.${month}.${year}`;
  }

  const text = String(dateText);

  if (text.includes("-")) {
    const [year, month, day] = text.split("-");
    return `${day}.${month}.${year}`;
  }

  return text.split(" ")[0];
}

function getDefaultBankLucaCode(bankAccounts = []) {
  const activeBank = bankAccounts.find((bank) => bank.isActive !== false);
  return activeBank?.lucaAccountCode || "102";
}

function findBankRule(companyRules, description) {
  const rules = companyRules?.banka || [];
  const text = normalizeParserText(description);

  return (
    rules.find((rule) => {
      const keyword = normalizeParserText(rule.anahtar);
      return keyword && text.includes(keyword);
    }) || null
  );
}

function findFaturaRule(companyRules, description) {
  const rules = companyRules?.fatura || [];
  const text = normalizeParserText(description);

  return (
    rules.find((rule) => {
      const keyword = normalizeParserText(rule.anahtar);
      return keyword && text.includes(keyword);
    }) || null
  );
}

function findLegacyRule(legacyRules, description) {
  const text = normalizeParserText(description);

  return (
    legacyRules.find((item) =>
      item.anahtarlar?.some((keyword) => text.includes(normalizeParserText(keyword)))
    ) || null
  );
}

function findLearningMemoryMatch(learningMemory, description, context = {}) {
  const text = normalizeParserText(description);
  const bankName = normalizeParserText(context.bankName || "");
  const seriesPrefix = normalizeParserText(context.seriesPrefix || "");
  const counterpartyName = normalizeParserText(context.counterpartyName || "");
  const sourceModule = normalizeParserText(context.sourceModule || "");

  const records = (learningMemory || []).filter(
    (record) => record?.is_active !== false
  );

  let best = null;
  let bestScore = 0;

  for (const record of records) {
    const keyword = normalizeParserText(record.keyword);

    if (!keyword || !text.includes(keyword)) continue;

    let score = keyword.length;

    const recordBank = normalizeParserText(
      record.account_name || record.transaction_type || ""
    );
    const recordSeries = normalizeParserText(record.counter_account_name || "");
    const recordSource = normalizeParserText(record.source_module || "");

    if (bankName && recordBank && recordBank === bankName) score += 20;
    if (seriesPrefix && recordSeries && text.includes(recordSeries)) score += 15;
    if (
      counterpartyName &&
      recordSeries &&
      text.includes(normalizeParserText(recordSeries))
    ) {
      score += 10;
    }
    if (sourceModule && recordSource && recordSource === sourceModule) score += 5;

    if (!best || score > bestScore) {
      best = record;
      bestScore = score;
    }
  }

  return best;
}

function applyLearningMemoryAccounts(memory, direction, bankLucaBase, bankAccounts) {
  const debitAccount = memory.account_code || "";
  const creditAccount = memory.counter_account_code || "";

  let accountCode = bankLucaBase;
  let counterAccountCode = "";

  if (direction === "GIRIS") {
    counterAccountCode = creditAccount || debitAccount;
  } else {
    counterAccountCode = debitAccount || creditAccount;
  }

  if (compactAccount(creditAccount).startsWith("102")) {
    accountCode = resolve102BankAccount(bankAccounts, creditAccount, creditAccount);
  } else if (compactAccount(debitAccount).startsWith("102")) {
    accountCode = resolve102BankAccount(bankAccounts, debitAccount, debitAccount);
  } else {
    accountCode = resolve102BankAccount(bankAccounts, accountCode, bankLucaBase);
  }

  return { accountCode, counterAccountCode };
}

function formatMemoryDescription(memory, description, direction) {
  const template = memory?.description_format || "";

  if (!template) {
    return buildFallbackLucaDescription({
      aciklama: description,
      description,
      yon: direction,
    });
  }

  return template
    .replaceAll("{ACIKLAMA}", description)
    .replaceAll("{aciklama}", description);
}

function isCreditCardPaymentText(description) {
  const text = normalizeParserText(description);

  return (
    text.includes("K KART") ||
    text.includes("KREDI KART") ||
    text.includes("KREDİ KART") ||
    text.includes("EKSTRE BORC") ||
    text.includes("EKSTRE BORÇ")
  );
}

function accountExistsInPlan(companyPlans, accountCode) {
  return accountExistsInCompanyPlan(companyPlans, accountCode);
}

export { findCariAccountInPlan } from "@/src/utils/cariAccountMatcher";

function isGenericCariAccount(accountCode) {
  const compact = compactAccount(accountCode);
  return compact.startsWith("320") || compact.startsWith("120");
}

function appendWarning(warnings, message) {
  if (!message) return;
  if (!warnings.includes(message)) warnings.push(message);
}

function removeWarningsMatching(warnings, predicate) {
  for (let index = warnings.length - 1; index >= 0; index -= 1) {
    if (predicate(warnings[index])) {
      warnings.splice(index, 1);
    }
  }
}

function applyCariResolution(
  companyPlans,
  description,
  lucaDescription,
  ruleAciklama,
  counterAccountCode,
  warnings
) {
  const needsResolve =
    !counterAccountCode ||
    (isGenericCariAccount(counterAccountCode) &&
      !accountExistsInPlan(companyPlans, counterAccountCode));

  if (!needsResolve) {
    return { counterAccountCode, cariSuggestions: [] };
  }

  const result = resolveCariAccountMatch(companyPlans, {
    description,
    lucaDescription,
    ruleAciklama,
  });

  removeWarningsMatching(
    warnings,
    (message) =>
      message === "Cari hesap bulunamadı" ||
      message.startsWith("Cari hesap bulunamadı.")
  );

  if (result.code) {
    appendWarning(warnings, "Cari hesap eşleşti");
    return { counterAccountCode: result.code, cariSuggestions: [] };
  }

  appendWarning(warnings, buildCariNotFoundWarning(result.suggestions));
  return { counterAccountCode: "", cariSuggestions: result.suggestions };
}

function formatRuleDescription(rule, description) {
  const template = rule?.aciklama || rule?.description || "";

  if (!template) return "";

  return template.replaceAll("{ACIKLAMA}", description).replaceAll("{aciklama}", description);
}

export function mapParsedRowToStandardMovement(rawRow, context) {
  const {
    selectedCompany,
    companyPlans = [],
    companyRules = {},
    selectedBank,
    legacyRules = [],
    learningMemory = [],
    accountingRules = [],
    selectedCompanyId = "",
  } = context;

  const description = String(rawRow.aciklama || rawRow.description || "").trim();
  const amount = Math.abs(Number(rawRow.tutar ?? rawRow.amount ?? 0));
  const direction = rawRow.yon === "CIKIS" || rawRow.direction === "CIKIS" ? "CIKIS" : "GIRIS";
  const date = formatParserDate(rawRow.tarih || rawRow.date);
  const warnings = [];

  let matchedRule = null;
  let matchedMemoryId = null;
  let accountCode = "";
  let counterAccountCode = "";
  let lucaDescription = "";
  let documentType = "DK";
  let ruleAciklama = "";
  let cariSuggestions = [];

  const bankLucaBase = resolve102BankAccount(
    selectedCompany?.bankAccounts || [],
    "102",
    getDefaultBankLucaCode(selectedCompany?.bankAccounts)
  );

  accountCode = bankLucaBase;

  const creditCard =
    findCreditCardByText(selectedCompany?.creditCards || [], description) ||
    (isCreditCardPaymentText(description)
      ? findCreditCardByText(selectedCompany?.creditCards || [], description)
      : null);

  const isCardPaymentRow = !!creditCard || isCreditCardPaymentText(description);

  if (isCardPaymentRow) {
    const card =
      creditCard ||
      (selectedCompany?.creditCards || []).find((item) => item.isActive !== false) ||
      null;

    const resolvedCard = getCreditCardAccount({
      creditCard: card,
      paymentDate: date || new Date(),
      installmentYearShift: false,
    }) || { accountCode: "", warning: "Kredi kartı hesabı çözülemedi." };

    matchedRule = {
      source: "creditCard",
      islem: "KREDI KARTI",
      anahtar: card?.lastFourDigits || card?.cardName || "",
    };

    counterAccountCode = resolvedCard?.accountCode || "";
    documentType = "KR";
    lucaDescription = buildCreditCardPaymentDescription({
      creditCard: card,
      paymentDate: date || new Date(),
      rawDescription: description,
    });

    if (resolvedCard?.warning) appendWarning(warnings, resolvedCard.warning);
    if (!card) appendWarning(warnings, "Kredi kartı eşleşmedi");
    if (!counterAccountCode) {
      appendWarning(warnings, "Hesap eşleşmesi bulunamadı");
    }
  } else {
    const memoryMatch = findLearningMemoryMatch(learningMemory, description, {
      bankName: rawRow.banka || rawRow.bankName || selectedBank,
      seriesPrefix: extractSeriesPrefix(
        description,
        selectedCompany?.documentSeriesRules || []
      ),
      sourceModule: "banka",
    });

    if (memoryMatch) {
      matchedRule = {
        source: "learningMemory",
        islem: "HAFIZA",
        anahtar: memoryMatch.keyword || "",
      };
      matchedMemoryId = memoryMatch.id || null;

      const memoryAccounts = applyLearningMemoryAccounts(
        memoryMatch,
        direction,
        bankLucaBase,
        selectedCompany?.bankAccounts || []
      ) || { accountCode: bankLucaBase || "", counterAccountCode: "" };

      accountCode = memoryAccounts?.accountCode || bankLucaBase || "";
      counterAccountCode = memoryAccounts?.counterAccountCode || "";
      if (!counterAccountCode) {
        appendWarning(warnings, "Hesap eşleşmesi bulunamadı");
      }
      lucaDescription = formatMemoryDescription(
        memoryMatch,
        description,
        direction
      );

      if (memoryMatch.document_type) {
        documentType = memoryMatch.document_type;
      }

      appendWarning(warnings, MEMORY_MATCH_LABEL);
    } else {
      const accountingRule = matchAccountingRule(description, {
        companyId: selectedCompany?.id || selectedCompanyId,
        kaynakTipi: "Banka",
        rules: accountingRules,
      });

      if (accountingRule) {
        matchedRule = {
          source: "accountingRuleEngine",
          islem: "KURAL",
          anahtar: accountingRule.aramaMetni || "",
        };

        const applied = applyAccountingRuleToBankMovement(
          accountingRule,
          description,
          direction
        ) || {};

        counterAccountCode = applied?.counterAccountCode || "";
        documentType = applied?.documentType || documentType;
        ruleAciklama = applied?.ruleAciklama || "";
        lucaDescription =
          applied?.lucaDescription ||
          buildFallbackLucaDescription({
            ...rawRow,
            yon: direction,
            aciklama: description,
          });

        if (!counterAccountCode) {
          appendWarning(warnings, "Hesap eşleşmesi bulunamadı");
        }

        appendWarning(warnings, `Kural Motoru: ${accountingRule.aramaMetni}`);
      } else {
        const engineRule = findBankRule(companyRules, description);
        const legacyRule = findLegacyRule(legacyRules, description);

        matchedRule = engineRule || legacyRule || null;

        if (engineRule) {
          ruleAciklama =
            formatRuleDescription(engineRule, description) ||
            engineRule.aciklama ||
            engineRule.description ||
            "";
          lucaDescription =
            ruleAciklama ||
            buildFallbackLucaDescription({
              ...rawRow,
              yon: direction,
              aciklama: description,
            });

          if (direction === "GIRIS") {
            counterAccountCode = engineRule.alacakHesabi || engineRule.borcHesabi || "";
          } else {
            counterAccountCode = engineRule.borcHesabi || engineRule.alacakHesabi || "";
          }
        } else if (legacyRule) {
          ruleAciklama = legacyRule.aciklama || "";
          lucaDescription =
            ruleAciklama ||
            buildFallbackLucaDescription({
              ...rawRow,
              yon: direction,
              aciklama: description,
            });
          counterAccountCode = legacyRule.hesap || "";
        } else {
          appendWarning(warnings, "Kural bulunamadı");
          lucaDescription = buildFallbackLucaDescription({
            ...rawRow,
            yon: direction,
            aciklama: description,
          });
        }
      }
    }

    const cariResolution = applyCariResolution(
      companyPlans,
      description,
      lucaDescription,
      ruleAciklama,
      counterAccountCode,
      warnings
    );

    counterAccountCode = cariResolution.counterAccountCode;
    cariSuggestions = cariResolution.cariSuggestions;
  }

  const faturaRule = findFaturaRule(companyRules, description);

  if (
    !isCardPaymentRow &&
    faturaRule?.belgeTuru &&
    matchedRule?.source !== "learningMemory" &&
    matchedRule?.source !== "accountingRuleEngine"
  ) {
    documentType = faturaRule.belgeTuru;
  }

  if (
    matchedRule?.source !== "learningMemory" &&
    matchedRule?.source !== "accountingRuleEngine"
  ) {
    accountCode = resolve102BankAccount(
      selectedCompany?.bankAccounts || [],
      accountCode,
      getDefaultBankLucaCode(selectedCompany?.bankAccounts)
    );
  }

  const missingPlanAccounts = [];
  const accountPlanMissing = {};

  if (accountCode && !accountExistsInPlan(companyPlans, accountCode)) {
    missingPlanAccounts.push(accountCode);
    accountPlanMissing.accountCode = accountCode;
  }

  if (
    counterAccountCode &&
    !accountExistsInPlan(companyPlans, counterAccountCode) &&
    !missingPlanAccounts.includes(counterAccountCode)
  ) {
    missingPlanAccounts.push(counterAccountCode);
    accountPlanMissing.counterAccountCode = counterAccountCode;
  }

  let accountSuggestions = [];

  if (missingPlanAccounts.length > 0) {
    const contextText = [description, lucaDescription].join(" ");
    accountSuggestions = collectAccountSuggestions(
      companyPlans,
      missingPlanAccounts,
      contextText
    );
    appendWarning(
      warnings,
      buildAccountPlanNotFoundWarning(
        companyPlans,
        missingPlanAccounts,
        contextText
      )
    );
  }

  const hgsOgsEnhancement = enhanceHgsOgsLucaDescription(description, lucaDescription);
  lucaDescription = hgsOgsEnhancement.lucaDescription;

  return {
    id: crypto.randomUUID(),
    date,
    description,
    amount,
    direction,
    bankName: rawRow.banka || rawRow.bankName || selectedBank,
    rawRow,
    matchedRule,
    accountCode,
    counterAccountCode,
    documentType,
    lucaDescription,
    warning: warnings.join(" | "),
    matchedMemoryId,
    accountSuggestions,
    accountPlanMissing:
      Object.keys(accountPlanMissing).length > 0 ? accountPlanMissing : null,
    normalizedPlate: hgsOgsEnhancement.normalizedPlate,
    displayPlate: hgsOgsEnhancement.displayPlate,
    cariSuggestions,
  };
}

export function filterActiveBankParsedRows(parsedRows = []) {
  return (parsedRows || []).filter(
    (row) => Math.abs(Number(row?.tutar ?? row?.amount ?? 0)) > 0
  );
}

/**
 * Aşama 1 — yalnızca parser çıktısı.
 * Learning / kural / cari / CORE / Luca YOK.
 */
export function buildParserOnlyMovement(row = {}, context = {}, index = 0) {
  const description = String(row?.aciklama || row?.description || "").trim();
  const amount = Math.abs(Number(row?.tutar ?? row?.amount ?? 0));
  const direction =
    row?.yon === "CIKIS" || row?.direction === "CIKIS" ? "CIKIS" : "GIRIS";
  const date = formatParserDate(row?.tarih || row?.date);

  return {
    id: `preview-${index + 1}-${String(date || "x")}-${amount}`,
    date,
    description,
    amount,
    direction,
    bankName: row?.banka || row?.bankName || context?.selectedBank || "",
    rawRow: row,
    matchedRule: null,
    accountCode: "",
    counterAccountCode: "",
    documentType: "DK",
    lucaDescription: description,
    warning: "Muhasebe analizi bekleniyor",
    matchedMemoryId: null,
    accountSuggestions: [],
    accountPlanMissing: null,
    normalizedPlate: "",
    displayPlate: "",
    cariSuggestions: [],
    _parserOnly: true,
    _accountingAnalyzed: false,
  };
}

export function buildParserOnlyMovements(parsedRows = [], context = {}) {
  return filterActiveBankParsedRows(parsedRows).map((row, index) =>
    buildParserOnlyMovement(row, context, index)
  );
}

/**
 * Tek satır legacy movement mapping — hata durumunda mevcut fallback objesi.
 * CORE bridge unknown satırlarda da bunu çağırır (parser yeniden yazılmaz).
 */
export function mapSingleParsedRowToMovement(row, context, index = 0) {
  try {
    return mapParsedRowToStandardMovement(row, context);
  } catch (error) {
    const description = String(row?.aciklama || row?.description || "").trim();
    console.error("[bankMovementMapper] row failed", {
      index: index + 1,
      description,
      error: error?.message || String(error),
    });
    return {
      id: `fallback-${index + 1}-${Date.now()}`,
      date: String(row?.tarih || row?.date || ""),
      description,
      amount: Math.abs(Number(row?.tutar ?? row?.amount ?? 0)),
      direction: row?.yon === "CIKIS" || row?.direction === "CIKIS" ? "CIKIS" : "GIRIS",
      bankName: row?.banka || row?.bankName || context?.selectedBank || "",
      rawRow: row,
      matchedRule: null,
      accountCode: "",
      counterAccountCode: "",
      documentType: "DK",
      lucaDescription: description,
      warning: `Satır ${index + 1}: Hesap eşleşmesi bulunamadı (${error?.message || "mapping hatası"})`,
      matchedMemoryId: null,
      accountSuggestions: [],
      accountPlanMissing: null,
      normalizedPlate: "",
      displayPlate: "",
      cariSuggestions: [],
      mappingError: true,
    };
  }
}

export function mapParsedRowsToStandardMovements(parsedRows, context) {
  return filterActiveBankParsedRows(parsedRows).map((row, index) =>
    mapSingleParsedRowToMovement(row, context, index)
  );
}

export function standardMovementToLucaPendingRow(movement) {
  const isIncoming = movement.direction === "GIRIS";

  return {
    Tarih: movement.date,
    Aciklama: movement.description,
    Tutar: movement.amount,
    IslemTipi: movement.matchedRule?.islemTipi || movement.matchedRule?.islem || "",
    BorcluHesap: isIncoming ? movement.accountCode : movement.counterAccountCode,
    AlacakliHesap: isIncoming ? movement.counterAccountCode : movement.accountCode,
    LucaBankaHesabi: movement.accountCode,
    BelgeTuru: movement.documentType,
    LucaAciklama: movement.lucaDescription,
    Uyari: movement.warning,
  };
}
