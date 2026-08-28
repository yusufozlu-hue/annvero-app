/**
 * Düzeltme fişi V1 — programdan bağımsız recipe/draft/export motoru.
 * Persist=0; kaynak fişe yazma yok; fail-closed belirsizlikte.
 */
import * as XLSX from "xlsx";
import { E_DEFTER_ISSUE_SEVERITY } from "@/src/config/eDefterKontrolDefaults";
import { formatDateTR } from "@/src/utils/formatDateTR";
import { enforceLucaExportDateStrings } from "@/src/utils/formatDateTR";
import { normalizeAccountCodeForComparison } from "@/src/utils/textNormalize";
import {
  finalizeStandardLucaRow,
  LUCA_EXPORT_HEADERS,
  standardLucaRowsToExcelRows,
} from "@/src/utils/standardLucaRow";
import { sanitizeExportJsonRows } from "@/src/utils/safeXlsx";
import {
  CORRECTION_DATE_SOURCE,
  formatLedgerPeriodKey,
  ledgerPeriodFromIsoDate,
  resolveCorrectionDateContext,
  resolveLastClosedLedgerPeriod,
  validateCorrectionDate,
} from "@/src/utils/correctionVoucher/correctionDatePolicy";

export const CORRECTION_RECIPE = {
  SAME_ACCOUNT_WRONG_DEBIT: "SAME_ACCOUNT_WRONG_DEBIT",
};

export const CORRECTION_EXPORT_MODE = {
  LUCA_STANDARD: "LUCA_STANDARD",
  ANNVERO_FALLBACK: "ANNVERO_FALLBACK",
};

const BALANCE_TOLERANCE = 0.01;

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function compactFisNo(value = "") {
  return String(value ?? "").trim();
}

function compactAccount(value = "") {
  return normalizeAccountCodeForComparison(value);
}

function fail(reason, message, extra = {}) {
  return { ok: false, reason, message, ...extra };
}

function rowMoney(row = {}, side = "borc") {
  return roundMoney(side === "borc" ? row.borc : row.alacak);
}

/** GM kontrol satırlarından kaynak fiş paketi */
export function buildSourceVoucherFromLedgerRows(rows = [], fisNo = "") {
  const needle = compactFisNo(fisNo);
  if (!needle) return null;

  const voucherRows = (rows || []).filter(
    (row) => compactFisNo(row.fisNo) === needle && String(row.hesapKodu || "").trim()
  );
  if (!voucherRows.length) return null;

  const first = voucherRows[0];
  const belgeNo = String(
    first.belgeNo || first.evrakNo || first.documentNo || ""
  ).trim();

  return {
    fisNo: first.fisNo,
    tarih: first.tarih || "",
    belgeNo,
    cariUnvan: String(first.cariUnvan || first.hesapAdi || "").trim(),
    rows: voucherRows,
  };
}

function detectSameAccountWrongDebit(finding, sourceVoucher) {
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
    excludedKdvLineCount: rows.filter(
      (row) => rowMoney(row, "borc") > 0 && compactAccount(row.hesapKodu) !== compactAccount(wrongAccountCode)
    ).length,
    findingCode: finding?.code || "",
    findingSeverity: finding?.severity || "",
  };
}

/** finding + kaynak fiş → desteklenen recipe (genişletilebilir) */
export function detectCorrectionRecipe(finding = {}, sourceVoucher = null) {
  if (!sourceVoucher) {
    return fail("SOURCE_VOUCHER_MISSING", "Kaynak fiş detayı bulunamadı.");
  }

  if (
    finding?.severity &&
    finding.severity !== E_DEFTER_ISSUE_SEVERITY.UYARI &&
    finding.severity !== "UYARI"
  ) {
    return fail("FINDING_NOT_ELIGIBLE", "Yalnızca UYARI bulguları düzeltme fişine uygundur.");
  }

  const sameAccount = detectSameAccountWrongDebit(finding, sourceVoucher);
  if (sameAccount.ok) return sameAccount;

  return sameAccount;
}

export function buildCorrectionReference(sourceVoucher = {}) {
  return {
    sourceFisNo: compactFisNo(sourceVoucher.fisNo),
    sourceDate: sourceVoucher.tarih || "",
    sourceDocumentNo: sourceVoucher.belgeNo || "",
    sourceParty: sourceVoucher.cariUnvan || "",
    displaySourceDate: formatDateTR(sourceVoucher.tarih) || sourceVoucher.tarih || "",
  };
}

export function buildCorrectionDescription({
  reference = {},
  correctDebitAccountCode = "",
  correctDebitAccountName = "",
} = {}) {
  const datePart = reference.displaySourceDate || reference.sourceDate || "—";
  const fisPart = reference.sourceFisNo || "—";
  const belgePart = reference.sourceDocumentNo || "—";
  const targetLabel = [correctDebitAccountCode, correctDebitAccountName]
    .filter(Boolean)
    .join(" ");

  return `${datePart} tarihli ${fisPart} numaralı fişte sehven borçlandırılan cari hesabın ${targetLabel} hesabına düzeltilmesi. Kaynak belge: ${belgePart}.`;
}

function accountPlanHasCode(accountPlanCodes, code) {
  if (!accountPlanCodes || accountPlanCodes.size === 0) return true;
  const c = String(code || "").trim();
  if (!c) return false;
  if (accountPlanCodes.has(c)) return true;
  return accountPlanCodes.has(compactAccount(c));
}

/** recipe + kullanıcı seçimleri → taslak */
export function buildCorrectionDraft(recipe = {}, userSelections = {}) {
  if (!recipe?.ok) {
    return fail("INVALID_RECIPE", "Geçerli düzeltme recipe bulunamadı.");
  }

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
    return {
      ok: false,
      reason: "CORRECTION_DATE_INVALID",
      message: dateValidation.issues[0]?.message || "Düzeltme tarihi geçersiz.",
      issues: dateValidation.issues,
      dateContext,
      requiresClosedPeriodInput: dateContext.requiresClosedPeriodInput,
    };
  }

  const reference = buildCorrectionReference(recipe.sourceVoucher);
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

  return {
    ok: true,
    recipeType: recipe.recipeType,
    reference,
    description,
    lines,
    wrongAccountCode: recipe.wrongAccountCode,
    wrongDebitAmount: recipe.wrongDebitAmount,
    correctionDate: dateContext.correctionDate,
    correctionDateSource: dateContext.correctionDateSource,
    correctionPeriod: dateValidation.correctionPeriod,
    lastClosedLedgerPeriod: dateContext.lastClosedLedgerPeriod,
    firstOpenDate: dateContext.firstOpenDate,
    companyId,
    companySlug,
    sourceFisNo: reference.sourceFisNo,
    persist: 0,
    kdvLineCount: 0,
  };
}

export function validateCorrectionDraft(draft = {}, options = {}) {
  const issues = [];
  if (!draft?.ok) {
    return {
      ok: false,
      issues: [{ code: "DRAFT_INVALID", message: draft?.message || "Taslak geçersiz." }],
    };
  }

  const lines = draft.lines || [];
  if (lines.length !== 2) {
    issues.push({
      code: "LINE_COUNT",
      message: "Düzeltme taslağı tam iki satır olmalıdır.",
    });
  }

  let borc = 0;
  let alacak = 0;
  for (const line of lines) {
    borc = roundMoney(borc + roundMoney(line.borc));
    alacak = roundMoney(alacak + roundMoney(line.alacak));

    const code = String(line.hesapKodu || "").trim();
    if (!code) {
      issues.push({ code: "MISSING_ACCOUNT", message: "Hesap kodu eksik." });
    } else if (
      options.accountPlanCodes &&
      !accountPlanHasCode(options.accountPlanCodes, code)
    ) {
      issues.push({
        code: "ACCOUNT_NOT_IN_PLAN",
        message: `Hesap planında yok: ${code}`,
      });
    }
  }

  if (Math.abs(borc - alacak) > BALANCE_TOLERANCE) {
    issues.push({
      code: "UNBALANCED",
      message: "Düzeltme fişi dengeli değil; export engellendi.",
    });
  }

  const dateValidation = validateCorrectionDate({
    correctionDate: draft.correctionDate,
    lastClosedLedgerPeriod: draft.lastClosedLedgerPeriod,
    lastClosedReliability:
      draft.lastClosedLedgerPeriod && draft.correctionDate
        ? options.lastClosedReliability || "USER_CONFIRMED"
        : null,
  });
  if (!dateValidation.ok) {
    issues.push(...dateValidation.issues);
  }

  if (draft.persist !== 0) {
    issues.push({
      code: "PERSIST_FORBIDDEN",
      message: "Düzeltme fişi kalıcı kayıt oluşturmaz (persist=0).",
    });
  }

  return { ok: issues.length === 0, issues, borc, alacak };
}

function draftToLucaRows(draft = {}, options = {}) {
  const fisNo = options.correctionFisNo || "DUZELTME";
  const fisTarihi = draft.correctionDate;
  const periodSlug = String(draft.correctionPeriod || "")
    .replace("/", "-");

  return (draft.lines || []).map((line, index) =>
    finalizeStandardLucaRow({
      id: `corr-${index + 1}`,
      firmaId: draft.companyId || "",
      kaynakTipi: "DUZELTME",
      kaynakAdi: "Genel Muhasebe Kontrol",
      fisNo,
      fisTarihi,
      fisAciklama: draft.description,
      detayAciklama: draft.description,
      aciklama: draft.description,
      belgeTuru: "MF",
      belgeNo: draft.reference?.sourceDocumentNo || "",
      evrakNo: draft.reference?.sourceDocumentNo || "",
      evrakTarihi: draft.reference?.sourceDate || fisTarihi,
      hesapKodu: line.hesapKodu,
      hesapAdi: line.hesapAdi,
      borc: line.borc,
      alacak: line.alacak,
      kontrolNotu: `Kaynak fiş ${draft.reference?.sourceFisNo || ""} · dönem ${periodSlug}`,
    })
  );
}

function buildExportFileName(draft = {}, options = {}) {
  const slug = String(options.companySlug || draft.companySlug || "FIRMA")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 32);
  const period = String(draft.correctionPeriod || "").replace("/", "-");
  const fis = compactFisNo(draft.reference?.sourceFisNo || draft.sourceFisNo || "00000");
  return `${slug}_${period}_DUZELTME_${fis}.xlsx`;
}

/**
 * Onaylı taslak → Luca standard veya ANNVERO fallback Excel.
 * userApproved=false ise export yapılmaz.
 */
export function exportCorrectionDraft(draft = {}, options = {}) {
  const { userApproved = false, exportMode = CORRECTION_EXPORT_MODE.LUCA_STANDARD } = options;

  if (!userApproved) {
    return {
      ok: false,
      reason: "APPROVAL_REQUIRED",
      message: "Export için kullanıcı onayı gerekir.",
    };
  }

  const validation = validateCorrectionDraft(draft, options);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "VALIDATION_FAILED",
      message: validation.issues[0]?.message || "Taslak doğrulanamadı.",
      issues: validation.issues,
    };
  }

  const lucaRows = draftToLucaRows(draft, options);
  if (!lucaRows.length) {
    return {
      ok: false,
      reason: "EMPTY_DRAFT",
      message: "Export satırı üretilemedi.",
    };
  }

  const fileName = buildExportFileName(draft, options);
  const excelRows = sanitizeExportJsonRows(standardLucaRowsToExcelRows(lucaRows));
  const worksheet = XLSX.utils.json_to_sheet(excelRows, {
    header: LUCA_EXPORT_HEADERS,
  });
  enforceLucaExportDateStrings(worksheet, ["Fiş Tarihi", "Evrak Tarihi", "Hesap Kodu"]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Luca Fisleri");
  XLSX.writeFile(workbook, fileName);

  const result = {
    ok: true,
    fileName,
    rowCount: lucaRows.length,
    exportMode,
    lucaCompatible: exportMode === CORRECTION_EXPORT_MODE.LUCA_STANDARD,
    persist: 0,
  };

  if (exportMode === CORRECTION_EXPORT_MODE.ANNVERO_FALLBACK) {
    result.warning =
      "Doğrudan Luca içe aktarım uyumluluğu henüz doğrulanmadı.";
  }

  return result;
}

/** UI: bulgu + ledger satırları → düzeltme hazırlığı */
export function prepareCorrectionFromFinding({
  finding = {},
  ledgerRows = [],
  companyAccountingRules = {},
  userSelectedClosedPeriod = "",
} = {}) {
  const sourceVoucher = buildSourceVoucherFromLedgerRows(
    ledgerRows,
    finding.fisNo
  );
  const recipe = detectCorrectionRecipe(finding, sourceVoucher);
  if (!recipe.ok) {
    return { recipe, sourceVoucher, dateContext: null };
  }

  const closed = resolveLastClosedLedgerPeriod({
    companyAccountingRules,
    userSelectedPeriod: userSelectedClosedPeriod,
  });

  const dateContext = resolveCorrectionDateContext({
    lastClosedLedgerPeriod: closed.lastClosedLedgerPeriod,
    lastClosedReliability: closed.reliability,
  });

  return { recipe, sourceVoucher, dateContext, closedReliability: closed.reliability };
}

export {
  CORRECTION_DATE_SOURCE,
  formatLedgerPeriodKey,
  ledgerPeriodFromIsoDate,
  resolveCorrectionDateContext,
  resolveLastClosedLedgerPeriod,
  validateCorrectionDate,
};
