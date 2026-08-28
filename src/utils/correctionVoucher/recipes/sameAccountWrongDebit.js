import { E_DEFTER_ISSUE_CODE } from "@/src/config/eDefterKontrolDefaults";
import { CORRECTION_RECIPE } from "@/src/utils/correctionVoucher/correctionRecipeTypes";
import { normalizeAccountCodeForComparison } from "@/src/utils/textNormalize";

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function compactAccount(value = "") {
  return normalizeAccountCodeForComparison(value);
}

function rowMoney(row = {}, side = "borc") {
  return roundMoney(side === "borc" ? row.borc : row.alacak);
}

function fail(reason, message, extra = {}) {
  return { ok: false, reason, message, ...extra };
}

/**
 * SAME_ACCOUNT_WRONG_DEBIT:
 * Aynı hesap kaynak fişte hem borç hem alacak çalışmış; tek borç satırı net aday.
 * Fiş/firma/hesap/tutar bağımsız — yalnız kaynak fiş satır yapısına bakar.
 */
export function detectSameAccountWrongDebitRecipe(finding = {}, sourceVoucher = null) {
  const rows = sourceVoucher?.rows || [];
  if (!rows.length) {
    return fail("SOURCE_VOUCHER_MISSING", "Kaynak fiş satırları bulunamadı.");
  }

  const byAccount = new Map();
  for (const row of rows) {
    const code = String(row.hesapKodu || "").trim();
    if (!code) continue;
    const entry = byAccount.get(code) || { debits: [], credits: [] };
    const borc = rowMoney(row, "borc");
    const alacak = rowMoney(row, "alacak");
    if (borc > 0) entry.debits.push({ row, amount: borc });
    if (alacak > 0) entry.credits.push({ row, amount: alacak });
    byAccount.set(code, entry);
  }

  const dualSide = [...byAccount.entries()].filter(
    ([, sides]) => sides.debits.length > 0 && sides.credits.length > 0
  );

  if (!dualSide.length) {
    return fail(
      "NO_DUAL_SIDE_ACCOUNT",
      "Aynı hesapta borç ve alacak birlikte çalışmıyor."
    );
  }
  if (dualSide.length > 1) {
    return fail(
      "AMBIGUOUS_ACCOUNT",
      "Birden fazla çift yönlü hesap adayı; otomatik düzeltme üretilmez."
    );
  }

  const [wrongAccountCode, sides] = dualSide[0];

  if (finding?.hesapKodu) {
    const findingCode = compactAccount(finding.hesapKodu);
    const targetCode = compactAccount(wrongAccountCode);
    if (findingCode && targetCode && findingCode !== targetCode) {
      return fail(
        "FINDING_ACCOUNT_MISMATCH",
        "Bulgu hesabı ile kaynak fiş adayı uyuşmuyor."
      );
    }
  }

  if (sides.debits.length !== 1) {
    return fail(
      "AMBIGUOUS_WRONG_DEBIT",
      "Hatalı borç satırı tek aday olarak belirlenemedi."
    );
  }

  const wrongDebit = sides.debits[0];
  const amount = roundMoney(wrongDebit.amount);
  if (amount <= 0) {
    return fail("INVALID_AMOUNT", "Düzeltme tutarı belirlenemedi.");
  }

  const creditLines = sides.credits.filter((c) => roundMoney(c.amount) > 0);
  if (!creditLines.length) {
    return fail("NO_CREDIT_OFFSET", "Alacak karşılığı bulunamadı.");
  }

  const excludedKdvLineCount = rows.filter(
    (row) =>
      rowMoney(row, "borc") > 0 &&
      compactAccount(row.hesapKodu) !== compactAccount(wrongAccountCode)
  ).length;

  return {
    ok: true,
    recipeType: CORRECTION_RECIPE.SAME_ACCOUNT_WRONG_DEBIT,
    sourceVoucher,
    wrongAccountCode,
    wrongAccountName: String(wrongDebit.row.hesapAdi || "").trim(),
    wrongDebitRowId: wrongDebit.row.id || "",
    wrongDebitAmount: amount,
    creditAccountCode: wrongAccountCode,
    creditAccountName: String(creditLines[0].row.hesapAdi || "").trim(),
    creditAmount: amount,
    excludedKdvLineCount,
    findingCode: finding?.code || "",
    findingSeverity: finding?.severity || "",
    supportedFindingCodes: [E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE],
  };
}

/** Bu recipe için bulgu kodu uygun mu? (zorunlu değil; yapısal kanıt yeterli). */
export function isSameAccountWrongDebitFindingEligible(finding = {}) {
  const code = String(finding?.code || "").trim();
  if (!code) return true;
  return code === E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE;
}
