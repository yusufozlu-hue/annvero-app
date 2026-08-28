import {
  CORRECTION_DATE_SOURCE,
  resolveCorrectionDateContext,
  resolveLastClosedLedgerPeriod,
  validateCorrectionDate,
} from "@/src/utils/correctionVoucher/correctionDatePolicy";
import {
  CORRECTION_DRAFT_STATUS,
  CORRECTION_RECIPE,
} from "@/src/utils/correctionVoucher/correctionRecipeTypes";
import {
  buildCorrectionDescription,
  buildCorrectionReference,
} from "@/src/utils/correctionVoucher/correctionVoucherCore";

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function fail(reason, message, extra = {}) {
  return { ok: false, reason, message, ...extra };
}

function accountPlanHasCode(accountPlanCodes, code) {
  if (!accountPlanCodes || accountPlanCodes.size === 0) return true;
  const c = String(code || "").trim();
  if (!c) return false;
  if (accountPlanCodes.has(c)) return true;
  const compact = c.replace(/[^\dA-Za-z]/g, "").toUpperCase();
  return accountPlanCodes.has(compact);
}

function sumLines(lines = []) {
  let borc = 0;
  let alacak = 0;
  for (const line of lines) {
    borc = roundMoney(borc + roundMoney(line.borc));
    alacak = roundMoney(alacak + roundMoney(line.alacak));
  }
  return { borc, alacak };
}

export function normalizeCorrectionDraft(raw = {}) {
  if (!raw?.ok) {
    return {
      ...raw,
      status: CORRECTION_DRAFT_STATUS.INVALID,
      warnings: raw.warnings || [],
    };
  }

  const { borc, alacak } = sumLines(raw.lines || []);
  const ref = raw.reference || {};

  return {
    ...raw,
    sourceFindingCode: raw.sourceFindingCode || raw.findingCode || "",
    sourceFisNo: raw.sourceFisNo || ref.sourceFisNo || "",
    sourceDate: raw.sourceDate || ref.sourceDate || "",
    sourceDocumentNo: raw.sourceDocumentNo || ref.sourceDocumentNo || "",
    sourceAccountCode: raw.sourceAccountCode || raw.wrongAccountCode || "",
    sourceAccountName: raw.sourceAccountName || raw.wrongAccountName || "",
    correctionDate: raw.correctionDate || "",
    correctionPeriod: raw.correctionPeriod || "",
    lines: raw.lines || [],
    totalDebit: borc,
    totalCredit: alacak,
    status: CORRECTION_DRAFT_STATUS.READY,
    warnings: raw.warnings || [],
  };
}

function buildSameAccountWrongDebitDraft(recipe = {}, userSelections = {}) {
  const {
    correctDebitAccountCode = "",
    correctDebitAccountName = "",
    companyAccountingRules = {},
    userSelectedClosedPeriod = "",
    userCorrectionDate = "",
    correctionDateSource = "",
    accountPlanCodes = null,
    companyId = "",
    companySlug = "",
  } = userSelections;

  const correctCode = String(correctDebitAccountCode || "").trim();
  if (!correctCode) {
    return fail("CORRECT_ACCOUNT_MISSING", "Doğru borç hesabı seçilmelidir.");
  }

  if (accountPlanCodes && !accountPlanHasCode(accountPlanCodes, correctCode)) {
    return fail(
      "ACCOUNT_NOT_IN_PLAN",
      "Seçilen hesap aktif hesap planında bulunamadı."
    );
  }

  const closed = resolveLastClosedLedgerPeriod({
    companyAccountingRules,
    userSelectedPeriod: userSelectedClosedPeriod,
  });

  const dateContext = resolveCorrectionDateContext({
    lastClosedLedgerPeriod: closed.lastClosedLedgerPeriod,
    lastClosedReliability: closed.reliability,
    userCorrectionDate,
    correctionDateSource,
  });

  const dateValidation = validateCorrectionDate({
    correctionDate: dateContext.correctionDate,
    lastClosedLedgerPeriod: dateContext.lastClosedLedgerPeriod,
    lastClosedReliability: closed.reliability,
  });

  if (!dateValidation.ok) {
    return normalizeCorrectionDraft({
      ok: false,
      reason: "CORRECTION_DATE_INVALID",
      message: dateValidation.issues[0]?.message || "Düzeltme tarihi geçersiz.",
      issues: dateValidation.issues,
      dateContext,
      requiresClosedPeriodInput: dateContext.requiresClosedPeriodInput,
      status: CORRECTION_DRAFT_STATUS.BLOCKED,
    });
  }

  const reference = buildCorrectionReference(recipe.sourceVoucher);
  if (!reference.ok) {
    return fail(
      reference.reason || "SOURCE_META_INCOMPLETE",
      reference.message || "Kaynak fiş referansı oluşturulamadı."
    );
  }

  const description = buildCorrectionDescription({
    reference,
    correctDebitAccountCode: correctCode,
    correctDebitAccountName,
  });

  const lines = [
    {
      hesapKodu: correctCode,
      hesapAdi: correctDebitAccountName,
      borc: recipe.wrongDebitAmount,
      alacak: 0,
    },
    {
      hesapKodu: recipe.creditAccountCode,
      hesapAdi: recipe.creditAccountName,
      borc: 0,
      alacak: recipe.creditAmount,
    },
  ];

  const warnings = [];
  if (recipe.excludedKdvLineCount > 0) {
    warnings.push({
      code: "KDV_LINES_EXCLUDED",
      message: `${recipe.excludedKdvLineCount} adet KDV/diğer borç satırı düzeltme fişine taşınmadı.`,
    });
  }

  return normalizeCorrectionDraft({
    ok: true,
    recipeType: recipe.recipeType,
    findingCode: recipe.findingCode || "",
    reference,
    description,
    lines,
    wrongAccountCode: recipe.wrongAccountCode,
    wrongAccountName: recipe.wrongAccountName,
    wrongDebitAmount: recipe.wrongDebitAmount,
    correctionDate: dateContext.correctionDate,
    correctionDateSource: dateContext.correctionDateSource,
    correctionPeriod: dateValidation.correctionPeriod,
    lastClosedLedgerPeriod: dateContext.lastClosedLedgerPeriod,
    firstOpenDate: dateContext.firstOpenDate,
    companyId,
    companySlug,
    sourceFisNo: reference.sourceFisNo,
    sourceDate: reference.sourceDate,
    sourceDocumentNo: reference.sourceDocumentNo,
    sourceAccountCode: recipe.wrongAccountCode,
    sourceAccountName: recipe.wrongAccountName,
    sourceFindingCode: recipe.findingCode || "",
    persist: 0,
    kdvLineCount: 0,
    warnings,
  });
}

const DRAFT_BUILDERS = {
  [CORRECTION_RECIPE.SAME_ACCOUNT_WRONG_DEBIT]: buildSameAccountWrongDebitDraft,
};

/** recipeType → taslak üretici (yeni recipe buraya eklenir). */
export function buildDraftForRecipe(recipe = {}, userSelections = {}) {
  if (!recipe?.ok) {
    return fail("INVALID_RECIPE", "Geçerli düzeltme recipe bulunamadı.");
  }

  const builder = DRAFT_BUILDERS[recipe.recipeType];
  if (!builder) {
    return fail(
      "RECIPE_BUILDER_MISSING",
      "Bu düzeltme türü için taslak üretici tanımlı değil; manuel inceleme gerekli."
    );
  }

  return builder(recipe, userSelections);
}
