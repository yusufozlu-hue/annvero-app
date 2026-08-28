import { E_DEFTER_ISSUE_SEVERITY } from "@/src/config/eDefterKontrolDefaults";
import {
  CORRECTION_RECIPE,
  IMPLEMENTED_CORRECTION_RECIPES,
  PLANNED_CORRECTION_RECIPES,
} from "@/src/utils/correctionVoucher/correctionRecipeTypes";
import {
  detectSameAccountWrongDebitRecipe,
  isSameAccountWrongDebitFindingEligible,
} from "@/src/utils/correctionVoucher/recipes/sameAccountWrongDebit";

function fail(reason, message, extra = {}) {
  return { ok: false, reason, message, ...extra };
}

const RECIPE_DETECTORS = {
  [CORRECTION_RECIPE.SAME_ACCOUNT_WRONG_DEBIT]: {
    detect: detectSameAccountWrongDebitRecipe,
    isFindingEligible: isSameAccountWrongDebitFindingEligible,
  },
};

const PLANNED_RECIPE_MESSAGES = {
  [CORRECTION_RECIPE.WRONG_ACCOUNT_TRANSFER]:
    "Yanlış hesap virmanı düzeltmesi henüz desteklenmiyor; manuel inceleme gerekli.",
  [CORRECTION_RECIPE.DUPLICATE_REVERSAL]:
    "Mükerrer/iptal düzeltmesi henüz desteklenmiyor; manuel inceleme gerekli.",
  [CORRECTION_RECIPE.WRONG_SIDE_CORRECTION]:
    "Yön düzeltmesi henüz desteklenmiyor; manuel inceleme gerekli.",
  [CORRECTION_RECIPE.MISSING_DOCUMENT_COMPLETION]:
    "Belge tamamlama düzeltmesi henüz desteklenmiyor; manuel inceleme gerekli.",
  [CORRECTION_RECIPE.ACCOUNT_PLAN_MAPPING]:
    "Hesap planı eşleme düzeltmesi henüz desteklenmiyor; manuel inceleme gerekli.",
};

function isUyariFinding(finding = {}) {
  return (
    !finding?.severity ||
    finding.severity === E_DEFTER_ISSUE_SEVERITY.UYARI ||
    finding.severity === "UYARI"
  );
}

/**
 * Bulgu + kaynak fiş → uygulanabilir recipe adayı (fail-closed).
 * Sırayla IMPLEMENTED_CORRECTION_RECIPES dener; belirsizlikte otomatik fiş üretmez.
 */
export function detectCorrectionRecipe(finding = {}, sourceVoucher = null) {
  if (!sourceVoucher) {
    return fail("SOURCE_VOUCHER_MISSING", "Kaynak fiş detayı bulunamadı.");
  }

  if (!isUyariFinding(finding)) {
    return fail(
      "FINDING_NOT_ELIGIBLE",
      "Yalnızca UYARI bulguları düzeltme fişine uygundur."
    );
  }

  let lastFailure = null;

  for (const recipeType of IMPLEMENTED_CORRECTION_RECIPES) {
    const entry = RECIPE_DETECTORS[recipeType];
    if (!entry) continue;
    if (entry.isFindingEligible && !entry.isFindingEligible(finding)) {
      continue;
    }
    const result = entry.detect(finding, sourceVoucher);
    if (result.ok) return result;
    lastFailure = result;
  }

  if (lastFailure) return lastFailure;

  return fail(
    "RECIPE_UNSUPPORTED",
    "Bu bulgu için desteklenen otomatik düzeltme recipe bulunamadı; manuel inceleme gerekli."
  );
}

/** Alias — UI/diagnostics: recipe aday çözümlemesi. */
export function resolveCorrectionCandidate(finding = {}, sourceVoucher = null) {
  return detectCorrectionRecipe(finding, sourceVoucher);
}

/** Kayıtlı recipe listesi (gelecek türler dahil). */
export function listCorrectionRecipeTypes() {
  return {
    implemented: [...IMPLEMENTED_CORRECTION_RECIPES],
    planned: [...PLANNED_CORRECTION_RECIPES],
  };
}

/** Planlanmış recipe için açıklayıcı mesaj (otomatik fiş üretmez). */
export function plannedRecipeMessage(recipeType = "") {
  return (
    PLANNED_RECIPE_MESSAGES[recipeType] ||
    "Bu düzeltme türü henüz desteklenmiyor; manuel inceleme gerekli."
  );
}
