import { createHash } from "node:crypto";
import { parseDateTR } from "@/src/utils/formatDateTR";
import { normalizeAccountCodeForComparison } from "@/src/utils/textNormalize";

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function canonicalMoneyString(value) {
  return roundMoney(value).toFixed(2);
}

export function canonicalIsoDateFromLedgerDate(value = "") {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = parseDateTR(text);
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compactVoucherNo(value = "") {
  return String(value ?? "").trim();
}

export function buildCorrectionRecordFingerprintInput({
  companyId = "",
  sourceVoucherNo = "",
  sourceVoucherDate = "",
  sourceDocumentNo = "",
  findingCode = "",
  recipeCode = "",
  wrongAccountCode = "",
  wrongDebit = 0,
  wrongCredit = 0,
} = {}) {
  return [
    String(companyId || "").trim(),
    compactVoucherNo(sourceVoucherNo),
    canonicalIsoDateFromLedgerDate(sourceVoucherDate),
    String(sourceDocumentNo ?? "").trim(),
    String(findingCode || "").trim(),
    String(recipeCode || "").trim(),
    normalizeAccountCodeForComparison(wrongAccountCode),
    canonicalMoneyString(wrongDebit),
    canonicalMoneyString(wrongCredit),
  ].join("|");
}

export function buildCorrectionRecordFingerprint(input = {}) {
  if (!input.companyId || !input.sourceVoucherNo || !input.findingCode || !input.recipeCode) {
    return "";
  }
  const material = buildCorrectionRecordFingerprintInput(input);
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export function fingerprintInputFromDraftAndRecipe(draft = {}, recipe = {}) {
  const ref = draft.reference || {};
  const wrongAccount = draft.wrongAccountCode || recipe.wrongAccountCode || draft.sourceAccountCode || "";
  let wrongDebit = roundMoney(draft.wrongDebitAmount ?? recipe.wrongDebitAmount ?? 0);
  let wrongCredit = 0;

  if (recipe.sourceVoucher?.rows?.length && wrongAccount) {
    const compact = normalizeAccountCodeForComparison(wrongAccount);
    for (const row of recipe.sourceVoucher.rows) {
      if (normalizeAccountCodeForComparison(row.hesapKodu) !== compact) continue;
      wrongDebit = Math.max(wrongDebit, roundMoney(row.borc));
      wrongCredit = Math.max(wrongCredit, roundMoney(row.alacak));
    }
  }

  if (wrongCredit <= 0 && recipe.creditAmount != null) {
    wrongCredit = roundMoney(recipe.creditAmount);
  }

  return {
    companyId: draft.companyId || "",
    sourceVoucherNo: draft.sourceFisNo || ref.sourceFisNo || "",
    sourceVoucherDate: draft.sourceDate || ref.sourceDate || "",
    sourceDocumentNo: draft.sourceDocumentNo || ref.sourceDocumentNo || "",
    findingCode: draft.sourceFindingCode || draft.findingCode || recipe.findingCode || "",
    recipeCode: draft.recipeType || recipe.recipeType || "",
    wrongAccountCode: wrongAccount,
    wrongDebit,
    wrongCredit,
  };
}
