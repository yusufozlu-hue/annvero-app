import { resolve102BankAccount, getCompanyBankLucaCode } from "@/src/utils/companyCenter";
import {
  accountExistsInCompanyPlan,
  collectAccountSuggestions,
} from "@/src/utils/accountPlanSuggestions";
import { enhanceHgsOgsLucaDescription } from "@/src/utils/plateParser";
import {
  applyAccountingRuleToBankMovement,
  matchAccountingRule,
} from "@/src/utils/accountingRuleEngine";
import { matchSafeSystemBankRule } from "@/src/utils/bankSmartSuggestions";
import {
  buildCariNotFoundWarning,
  resolveCariAccountMatch,
} from "@/src/utils/cariAccountMatcher";
import {
  resolveBankTransactionType,
  isPersonelRequiredForType,
  isVergiSgkType,
  isPosType,
  isFinanceType,
  isBareVergiSgkMainAccount,
  missingCategoryForTransactionType,
  BANK_TRANSACTION_TYPE,
  isExpenseOrIncomeGlAccount,
  isLikelyCariGlAccount,
  isDirectExpenseAllowedType,
} from "@/src/utils/bankTransactionType";
import { normalizeBankAnalysisKey, normalizeParserText } from "@/src/utils/textNormalize";
import {
  findAccountMemoryByAnalysisKey,
  findAccountMemoryByIban,
  findAccountMemoryMatchInRecords,
} from "@/src/utils/accountMemoryV1";
import {
  createEmptyMemoryTelemetry,
  resolveAccountMemoryV2Decision,
} from "@/src/utils/accountMemoryV2";
import {
  buildCreditCardPaymentDescription,
  findCreditCardByText,
  getCreditCardAccount,
} from "@/src/utils/creditCardAccountResolver";

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

function getDefaultBankLucaCode(bankAccounts = [], selectedBank = "") {
  return getCompanyBankLucaCode(bankAccounts, selectedBank);
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

export function buildLearningMemoryIndex(learningMemory = [], companyId = "") {
  const active = (learningMemory || []).filter(
    (record) => record?.is_active !== false
  );
  const byExactKeyword = new Map();
  const byToken = new Map();
  const byCompanyKeyword = new Map();
  const company = String(companyId || "").trim();

  for (const record of active) {
    const keyword = normalizeParserText(record.keyword);
    if (!keyword) continue;

    const existing = byExactKeyword.get(keyword);
    if (!existing || keyword.length >= normalizeParserText(existing.keyword || "").length) {
      byExactKeyword.set(keyword, record);
    }

    if (company) {
      byCompanyKeyword.set(`${company}|${keyword}`, record);
    }

    for (const token of keyword.split(" ").filter((t) => t.length >= 3)) {
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token).push(record);
    }
  }

  return {
    active,
    byExactKeyword,
    byToken,
    byCompanyKeyword,
    size: active.length,
    tokenKeys: byToken.size,
  };
}

function scoreLearningRecord(record, text, context = {}) {
  const keyword = normalizeParserText(record.keyword);
  if (!keyword || !text.includes(keyword)) return 0;

  let score = keyword.length;
  const bankName = normalizeParserText(context.bankName || "");
  const seriesPrefix = normalizeParserText(context.seriesPrefix || "");
  const counterpartyName = normalizeParserText(context.counterpartyName || "");
  const sourceModule = normalizeParserText(context.sourceModule || "");

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

  return score;
}

function findLearningMemoryMatch(learningMemory, description, context = {}) {
  const text = normalizeParserText(description);
  const stats = context.analysisStats || null;
  const index = context.learningMemoryIndex || null;
  const companyId = String(context.companyId || "").trim();

  if (!text) return null;

  // Exact keyword == full description
  if (index?.byExactKeyword?.has(text)) {
    if (stats) stats.learningExactHit = (stats.learningExactHit || 0) + 1;
    return index.byExactKeyword.get(text);
  }
  if (companyId && index?.byCompanyKeyword?.has(`${companyId}|${text}`)) {
    if (stats) stats.learningExactHit = (stats.learningExactHit || 0) + 1;
    return index.byCompanyKeyword.get(`${companyId}|${text}`);
  }

  // Token adayları
  if (index?.byToken) {
    const tokens = text.split(" ").filter((t) => t.length >= 3);
    const candidates = new Set();
    for (const token of tokens) {
      for (const record of index.byToken.get(token) || []) {
        candidates.add(record);
      }
    }

    if (candidates.size === 0) {
      return null;
    }

    if (stats) {
      stats.learningFuzzyHit = (stats.learningFuzzyHit || 0) + 1;
      stats.learningFuzzyCandidateCount =
        (stats.learningFuzzyCandidateCount || 0) + candidates.size;
    }

    let best = null;
    let bestScore = 0;
    for (const record of candidates) {
      const score = scoreLearningRecord(record, text, context);
      if (score > bestScore) {
        best = record;
        bestScore = score;
      }
    }
    return best;
  }

  // İndeks yoksa eski full scan (geriye dönük)
  if (stats) stats.learningFullScan = (stats.learningFullScan || 0) + 1;
  const records = Array.isArray(context.activeLearningMemory)
    ? context.activeLearningMemory
    : (learningMemory || []).filter((record) => record?.is_active !== false);

  let best = null;
  let bestScore = 0;
  for (const record of records) {
    const score = scoreLearningRecord(record, text, context);
    if (score > bestScore) {
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

function accountExistsInPlan(companyPlans, accountCode, planCodeSet = null) {
  return accountExistsInCompanyPlan(companyPlans, accountCode, planCodeSet);
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
  warnings,
  planCodeSet = null,
  cariIndex = null,
  analysisStats = null,
  memorySources = {}
) {
  // Cari gereken türde gider hesabı (770 vb.) tutma — cari ara
  if (isExpenseOrIncomeGlAccount(counterAccountCode)) {
    counterAccountCode = "";
  }

  const needsResolve =
    !counterAccountCode ||
    (isGenericCariAccount(counterAccountCode) &&
      !accountExistsInPlan(companyPlans, counterAccountCode, planCodeSet));

  if (!needsResolve) {
    return { counterAccountCode, cariSuggestions: [] };
  }

  if (analysisStats) {
    analysisStats.cariRequiredAttempts =
      (analysisStats.cariRequiredAttempts || 0) + 1;
  }

  const result = resolveCariAccountMatch(companyPlans, {
    description,
    lucaDescription,
    ruleAciklama,
    cariIndex,
    stats: analysisStats,
    ...memorySources,
  });

  removeWarningsMatching(
    warnings,
    (message) =>
      message === "Cari hesap bulunamadı" ||
      message.startsWith("Cari hesap bulunamadı.")
  );

  if (result.code && result.autoApplied !== false) {
    // Güvenlik: otomatik gider hesabı asla cari sonucu olmasın
    if (isExpenseOrIncomeGlAccount(result.code)) {
      appendWarning(warnings, buildCariNotFoundWarning(result.suggestions));
      if (analysisStats) {
        analysisStats.cariUnresolved = (analysisStats.cariUnresolved || 0) + 1;
      }
      return {
        counterAccountCode: "",
        cariSuggestions: result.suggestions,
        cariMatchConfidence: result.confidence || 0,
        cariMatchReason: result.matchReason || "",
      };
    }
    appendWarning(
      warnings,
      `Cari hesap eşleşti (${result.confidence}% · ${result.matchReason || "exact"})`
    );
    if (analysisStats) {
      analysisStats.cariAutoFound = (analysisStats.cariAutoFound || 0) + 1;
    }
    return {
      counterAccountCode: result.code,
      cariSuggestions: [],
      cariMatchConfidence: result.confidence,
      cariMatchReason: result.matchReason,
    };
  }

  appendWarning(warnings, buildCariNotFoundWarning(result.suggestions));
  return {
    counterAccountCode: "",
    cariSuggestions: result.suggestions,
    cariMatchConfidence: result.confidence || 0,
    cariMatchReason: result.matchReason || "",
  };
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
    activeLearningMemory,
    learningMemoryIndex = null,
    accountingRules = [],
    selectedCompanyId = "",
    planCodeSet = null,
    planIndex = null,
    cariIndex = null,
    analysisStats = null,
    analysisTimings = null,
    accountMemoryRecords = null,
  } = context;

  const addTiming = (key, started) => {
    if (!analysisTimings) return;
    analysisTimings[key] = (analysisTimings[key] || 0) + (Date.now() - started);
  };

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
  let cariMatchConfidence = 0;
  let cariMatchReason = "";
  let accountSuggestions = [];
  let transactionType = BANK_TRANSACTION_TYPE.BILINMEYEN;
  let cariRequired = false;
  let personelRequired = false;

  // İşlem türü — cari/personelden ÖNCE
  const typeResolution = resolveBankTransactionType(description, direction, {
    companyPlans,
    cariUnvan: rawRow.unvan || rawRow.cariUnvan || "",
    personelAdi: rawRow.personelAdi || "",
  });
  transactionType = typeResolution.transactionType;
  cariRequired = typeResolution.cariRequired;
  personelRequired = typeResolution.personelRequired;

  const bankLucaBase = resolve102BankAccount(
    selectedCompany?.bankAccounts || [],
    "102",
    getDefaultBankLucaCode(selectedCompany?.bankAccounts, selectedBank),
    selectedBank
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
    transactionType = BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI;
    cariRequired = false;
    personelRequired = false;

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
    const firmAnalysisKey = normalizeBankAnalysisKey(description, direction);
    const memoryList = Array.isArray(accountMemoryRecords)
      ? accountMemoryRecords
      : [];
    if (analysisStats && !analysisStats.memoryTelemetry) {
      analysisStats.memoryTelemetry = createEmptyMemoryTelemetry();
    }
    const firmMemoryStarted = Date.now();
    const firmDecision = resolveAccountMemoryV2Decision(
      {
        companyId: selectedCompanyId || selectedCompany?.id || "",
        analysisKey: firmAnalysisKey,
        direction,
        transactionType,
        iban:
          String(rawRow.iban || "").replace(/\s+/g, "") ||
          (description.match(/TR\d{2}[\d\s]{20,}/i) || [""])[0].replace(
            /\s+/g,
            ""
          ),
        taxNumber: rawRow.vkn || rawRow.taxNumber || "",
        counterpartyAlias: rawRow.unvan || rawRow.cariUnvan || "",
        normalizedDescription: description,
        amount,
      },
      memoryList,
      {
        telemetry: analysisStats?.memoryTelemetry || null,
        allowAuto: true,
      }
    );
    addTiming("firmMemoryMs", firmMemoryStarted);

    let firmMemoryApplied = false;
    if (firmDecision.mode === "conflict") {
      appendWarning(
        warnings,
        firmDecision.message ||
          "Firma hafızasında çakışan kararlar var; otomatik uygulanmadı."
      );
      if (analysisStats) {
        analysisStats.firmMemoryConflict =
          (analysisStats.firmMemoryConflict || 0) + 1;
      }
    } else if (firmDecision.autoApply && firmDecision.record) {
      firmMemoryApplied = true;
      matchedRule = {
        source: "firmaHafizaV2",
        islem: firmDecision.record.decisionType || "HAFIZA",
        anahtar: firmDecision.tier,
      };
      matchedMemoryId = firmDecision.record.id || null;
      counterAccountCode = firmDecision.record.accountCode || "";
      if (firmDecision.record.documentType) {
        documentType = firmDecision.record.documentType;
      }
      // GLN. HVL / GÖND. HVL standartlarını bozma — şablon yalnızca uyumluysa
      const template = String(
        firmDecision.record.finalDescriptionTemplate || ""
      ).trim();
      const templateNorm = normalizeParserText(template);
      if (
        template &&
        (templateNorm.includes("GLN HVL") ||
          templateNorm.includes("GOND HVL") ||
          templateNorm.startsWith("GLN") ||
          templateNorm.startsWith("GOND"))
      ) {
        lucaDescription = template;
      } else {
        lucaDescription = buildFallbackLucaDescription({
          ...rawRow,
          yon: direction,
          aciklama: description,
        });
      }
      appendWarning(warnings, `Firma hafızası (${firmDecision.tier})`);
      if (analysisStats) {
        analysisStats.firmMemoryAutoApplied =
          (analysisStats.firmMemoryAutoApplied || 0) + 1;
      }
    }

    if (!firmMemoryApplied) {
    const learningStarted = Date.now();
    const memoryMatch = findLearningMemoryMatch(learningMemory, description, {
      bankName: rawRow.banka || rawRow.bankName || selectedBank,
      seriesPrefix: extractSeriesPrefix(
        description,
        selectedCompany?.documentSeriesRules || []
      ),
      sourceModule: "banka",
      activeLearningMemory,
      learningMemoryIndex,
      companyId: selectedCompanyId || selectedCompany?.id || "",
      analysisStats,
    });
    addTiming("learningMatchMs", learningStarted);

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
      // Cari gereken türde öğrenilmiş 770/gider → yok say, cari ara
      if (
        cariRequired &&
        isExpenseOrIncomeGlAccount(counterAccountCode) &&
        !isDirectExpenseAllowedType(transactionType)
      ) {
        counterAccountCode = "";
        removeWarningsMatching(warnings, (m) => String(m).includes(MEMORY_MATCH_LABEL));
      } else if (!counterAccountCode) {
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

      if (counterAccountCode || !cariRequired) {
        appendWarning(warnings, MEMORY_MATCH_LABEL);
      }
    } else {
      const ruleStarted = Date.now();
      const accountingRule = matchAccountingRule(description, {
        companyId: selectedCompany?.id || selectedCompanyId,
        kaynakTipi: "Banka",
        rules: accountingRules,
      });
      if (analysisStats) {
        analysisStats.ruleMatch = (analysisStats.ruleMatch || 0) + 1;
      }

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
          // 3) Güvenli sistem kuralı (firma hafızası / özel kural sonrası)
          const systemMatch =
            typeResolution.systemMatch ||
            matchSafeSystemBankRule(description, direction, {
              companyPlans,
              cariUnvan: rawRow.unvan || rawRow.cariUnvan || "",
              personelAdi: rawRow.personelAdi || "",
            });

          if (systemMatch) {
            matchedRule = {
              source: "safeSystemRule",
              islem: systemMatch.family,
              anahtar: systemMatch.id,
              transactionType,
            };
            documentType = systemMatch.documentType || documentType;
            lucaDescription = systemMatch.lucaDescription || lucaDescription;

            const systemExpenseBlocked =
              cariRequired &&
              systemMatch.autoApplied &&
              isExpenseOrIncomeGlAccount(systemMatch.accountCode) &&
              !isDirectExpenseAllowedType(transactionType);

            const bareVergiBlocked =
              isVergiSgkType(transactionType) &&
              systemMatch.autoApplied &&
              isBareVergiSgkMainAccount(systemMatch.accountCode);

            if (systemExpenseBlocked) {
              // Çay/aidat/kargo vb. → 770 otomatik uygulanmaz
              appendWarning(warnings, "Cari eşleşmesi gerekli");
            } else if (bareVergiBlocked) {
              accountSuggestions = systemMatch.accountSuggestions || [];
              appendWarning(warnings, "Vergi/SGK türü çözülemedi");
              appendWarning(warnings, `Sistem ailesi: ${systemMatch.family}`);
            } else if (systemMatch.autoApplied && systemMatch.accountCode) {
              counterAccountCode = systemMatch.accountCode;
              appendWarning(
                warnings,
                `Sistem kuralı: ${systemMatch.family}`
              );
            } else if (systemMatch.planMissing) {
              accountSuggestions = systemMatch.accountSuggestions || [];
              if (isVergiSgkType(transactionType)) {
                appendWarning(warnings, "Vergi/SGK türü çözülemedi");
              } else if (isPosType(transactionType)) {
                appendWarning(warnings, "POS/komisyon ayrımı çözülemedi");
              } else if (isFinanceType(transactionType)) {
                appendWarning(warnings, "Finans işlem türü çözülemedi");
              } else {
                appendWarning(warnings, "Hesap planında karşılığı yok");
              }
              appendWarning(warnings, `Sistem ailesi: ${systemMatch.family}`);
            } else if (systemMatch.needsEntity && cariRequired) {
              lucaDescription =
                systemMatch.lucaDescription ||
                buildFallbackLucaDescription({
                  ...rawRow,
                  yon: direction,
                  aciklama: description,
                });
            } else if (systemMatch.needsEntity && !cariRequired) {
              accountSuggestions = systemMatch.accountSuggestions || [];
              appendWarning(warnings, "Hesap eşleşmesi bulunamadı");
              appendWarning(warnings, `Sistem ailesi: ${systemMatch.family}`);
            } else {
              accountSuggestions = systemMatch.accountSuggestions || [];
              if (isVergiSgkType(transactionType)) {
                appendWarning(warnings, "Vergi/SGK türü çözülemedi");
              } else if (isPosType(transactionType)) {
                appendWarning(warnings, "POS/komisyon ayrımı çözülemedi");
              } else if (isFinanceType(transactionType)) {
                appendWarning(warnings, "Finans işlem türü çözülemedi");
              } else {
                appendWarning(warnings, "Kural bulunamadı");
              }
              appendWarning(warnings, `Sistem ailesi: ${systemMatch.family}`);
            }
            if (analysisStats) {
              analysisStats.safeSystemHit =
                (analysisStats.safeSystemHit || 0) + 1;
              if (
                systemMatch.autoApplied &&
                !systemExpenseBlocked &&
                !bareVergiBlocked
              ) {
                analysisStats.safeSystemAutoApplied =
                  (analysisStats.safeSystemAutoApplied || 0) + 1;
              }
            }
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
      addTiming("ruleMatchMs", ruleStarted);
    }
    } // !firmMemoryApplied

    // Cari yalnızca transactionType gerektiriyorsa (firma hafızası hesabı doldurduysa atlanır)
    if (cariRequired && !(firmMemoryApplied && counterAccountCode)) {
      // Kural/hafıza gider hesabı bırakmışsa temizle
      if (
        isExpenseOrIncomeGlAccount(counterAccountCode) &&
        !isDirectExpenseAllowedType(transactionType)
      ) {
        counterAccountCode = "";
      }

      const analysisKey = normalizeBankAnalysisKey(description, direction);
      const memoryList = Array.isArray(accountMemoryRecords)
        ? accountMemoryRecords
        : [];
      const memoryCtx = {
        firmaId: selectedCompanyId || selectedCompany?.id || "",
        companyId: selectedCompanyId || selectedCompany?.id || "",
        bankName: selectedBank || "",
        kaynakAdi: selectedBank || "",
      };
      const analysisKeyMemory = findAccountMemoryByAnalysisKey(
        memoryList,
        analysisKey,
        memoryCtx,
        direction
      );
      const learnedMatch = findAccountMemoryMatchInRecords(
        memoryList,
        {
          detayAciklama: description,
          fisAciklama: lucaDescription,
          analysisKey,
          direction,
          transactionType,
        },
        memoryCtx
      );
      const ibanHistoryMemory = findAccountMemoryByIban(
        memoryList,
        String(rawRow.iban || "").replace(/\s+/g, "") ||
          (description.match(/TR\d{2}[\d\s]{20,}/i) || [""])[0].replace(/\s+/g, ""),
        memoryCtx
      );

      const cariStarted = Date.now();
      const cariResolution = applyCariResolution(
        companyPlans,
        description,
        lucaDescription,
        ruleAciklama,
        counterAccountCode,
        warnings,
        planCodeSet || planIndex?.codeSet,
        cariIndex,
        analysisStats,
        {
          companyId: selectedCompanyId || selectedCompany?.id || "",
          bankName: selectedBank || "",
          analysisKey,
          direction,
          transactionType,
          analysisKeyMemory:
            analysisKeyMemory && isLikelyCariGlAccount(analysisKeyMemory.accountCode)
              ? analysisKeyMemory
              : null,
          firmaMemoryRecord:
            analysisKeyMemory && isLikelyCariGlAccount(analysisKeyMemory.accountCode)
              ? analysisKeyMemory
              : null,
          learnedDescriptionMemory:
            learnedMatch?.record &&
            isLikelyCariGlAccount(learnedMatch.record.accountCode)
              ? learnedMatch.record
              : null,
          learnedDescriptionConfidence: learnedMatch?.confidence || 0,
          ibanHistoryMemory:
            ibanHistoryMemory && isLikelyCariGlAccount(ibanHistoryMemory.accountCode)
              ? ibanHistoryMemory
              : null,
        }
      );
      addTiming("cariResolutionMs", cariStarted);

      counterAccountCode = cariResolution.counterAccountCode;
      cariSuggestions = cariResolution.cariSuggestions;
      cariMatchConfidence = cariResolution.cariMatchConfidence || 0;
      cariMatchReason = cariResolution.cariMatchReason || "";
    } else {
      // Cari gerektirmeyen türlerde yanlış “Cari bulunamadı” üretme
      removeWarningsMatching(
        warnings,
        (message) =>
          String(message).includes("Cari hesap bulunamadı") ||
          String(message).includes("cari eşleşmesi gerekli")
      );
      // Ham 360/361 kör atama temizle
      if (isBareVergiSgkMainAccount(counterAccountCode)) {
        counterAccountCode = "";
      }
      if (
        !counterAccountCode &&
        !warnings.some((w) =>
          /Hesap planında|Kural bulunamadı|Hesap eşleşmesi|Vergi|SGK|Personel|POS|Finans/i.test(
            String(w)
          )
        )
      ) {
        if (isVergiSgkType(transactionType)) {
          appendWarning(warnings, "Vergi/SGK türü çözülemedi");
        } else if (isPosType(transactionType)) {
          appendWarning(warnings, "POS/komisyon ayrımı çözülemedi");
        } else if (isFinanceType(transactionType)) {
          appendWarning(warnings, "Finans işlem türü çözülemedi");
        } else if (personelRequired || isPersonelRequiredForType(transactionType)) {
          appendWarning(warnings, "Personel bulunamadı");
        }
      }
    }

    // Hesap çözüldüyse “Kural bulunamadı” uyarı gürültüsünü temizle
    if (counterAccountCode) {
      for (let i = warnings.length - 1; i >= 0; i -= 1) {
        if (String(warnings[i]).includes("Kural bulunamadı")) {
          warnings.splice(i, 1);
        }
      }
    }
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
      getDefaultBankLucaCode(selectedCompany?.bankAccounts, selectedBank),
      selectedBank
    );
  }

  const missingPlanAccounts = [];
  const accountPlanMissing = {};
  const effectiveCodeSet = planCodeSet || planIndex?.codeSet || null;

  if (accountCode && !accountExistsInPlan(companyPlans, accountCode, effectiveCodeSet)) {
    missingPlanAccounts.push(accountCode);
    accountPlanMissing.accountCode = accountCode;
  }

  if (
    counterAccountCode &&
    !accountExistsInPlan(companyPlans, counterAccountCode, effectiveCodeSet) &&
    !missingPlanAccounts.includes(counterAccountCode)
  ) {
    missingPlanAccounts.push(counterAccountCode);
    accountPlanMissing.counterAccountCode = counterAccountCode;
  }

  let accountSuggestionsMerged = accountSuggestions;

  if (missingPlanAccounts.length > 0) {
    const suggestionStarted = Date.now();
    const contextText = [description, lucaDescription].join(" ");
    const planSuggestions = collectAccountSuggestions(
      companyPlans,
      missingPlanAccounts,
      contextText,
      3,
      effectiveCodeSet,
      planIndex,
      analysisStats
    );
    const seen = new Set(
      accountSuggestionsMerged.map((item) => compactAccount(item.code || item.label))
    );
    for (const item of planSuggestions) {
      const key = compactAccount(item.code || item.label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      accountSuggestionsMerged.push(item);
    }
    accountSuggestions = accountSuggestionsMerged;
    appendWarning(
      warnings,
      accountSuggestions.length === 0
        ? "Hesap planında bulunamadı"
        : `Hesap planında bulunamadı. Öneriler: ${accountSuggestions
            .map((item) => item.label)
            .join(", ")}`
    );
    addTiming("accountSuggestionMs", suggestionStarted);
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
    cariMatchConfidence,
    cariMatchReason,
    transactionType,
    cariRequired,
    personelRequired,
    missingHesapCategory: !counterAccountCode
      ? missingCategoryForTransactionType(transactionType)
      : "",
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
