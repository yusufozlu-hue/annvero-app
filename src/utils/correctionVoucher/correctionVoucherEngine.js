/**
 * Düzeltme fişi — validate/export ve orchestration.
 * Recipe algılama: correctionRecipeRegistry.js
 * Taslak üretimi: correctionDraftBuilders.js
 */
import * as XLSX from "xlsx";
import { formatDateTR, enforceLucaExportDateStrings } from "@/src/utils/formatDateTR";
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
import { buildDraftForRecipe } from "@/src/utils/correctionVoucher/correctionDraftBuilders";
import {
  detectCorrectionRecipe,
  resolveCorrectionCandidate,
} from "@/src/utils/correctionVoucher/correctionRecipeRegistry";
import {
  CORRECTION_DRAFT_STATUS,
  CORRECTION_EXPORT_MODE,
  CORRECTION_RECIPE,
} from "@/src/utils/correctionVoucher/correctionRecipeTypes";
import {
  buildCorrectionDescription,
  buildCorrectionReference,
  buildSourceVoucherFromLedgerRows,
} from "@/src/utils/correctionVoucher/correctionVoucherCore";

export {
  CORRECTION_DATE_SOURCE,
  formatLedgerPeriodKey,
  ledgerPeriodFromIsoDate,
  resolveCorrectionDateContext,
  resolveLastClosedLedgerPeriod,
  validateCorrectionDate,
  CORRECTION_DRAFT_STATUS,
  CORRECTION_EXPORT_MODE,
  CORRECTION_RECIPE,
  buildCorrectionDescription,
  buildCorrectionReference,
  buildSourceVoucherFromLedgerRows,
  detectCorrectionRecipe,
  resolveCorrectionCandidate,
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

function accountPlanHasCode(accountPlanCodes, code) {
  if (!accountPlanCodes || accountPlanCodes.size === 0) return true;
  const c = String(code || "").trim();
  if (!c) return false;
  if (accountPlanCodes.has(c)) return true;
  return accountPlanCodes.has(compactAccount(c));
}

/** recipe + kullanıcı seçimleri → normalize edilmiş taslak */
export function buildCorrectionDraft(recipe = {}, userSelections = {}) {
  return buildDraftForRecipe(recipe, userSelections);
}

export function validateCorrectionDraft(draft = {}, options = {}) {
  const issues = [];
  if (!draft?.ok) {
    return {
      ok: false,
      issues: [
        { code: "DRAFT_INVALID", message: draft?.message || "Taslak geçersiz." },
      ],
    };
  }

  if (draft.status === CORRECTION_DRAFT_STATUS.BLOCKED) {
    issues.push({
      code: "DRAFT_BLOCKED",
      message: draft.message || "Taslak engellendi.",
    });
  }

  const ref = draft.reference || {};
  const sourceDate = draft.sourceDate || ref.sourceDate;
  const sourceDocumentNo = draft.sourceDocumentNo || ref.sourceDocumentNo;

  if (!sourceDate || !sourceDocumentNo) {
    issues.push({
      code: "SOURCE_META_INCOMPLETE",
      message: "Kaynak fiş tarih/belge bilgisi eksik; export engellendi.",
    });
  }

  if (!draft.description) {
    issues.push({
      code: "DESCRIPTION_INCOMPLETE",
      message: "Fiş açıklaması kaynak bilgileri olmadan oluşturulamaz.",
    });
  }

  const lines = draft.lines || [];
  if (lines.length !== 2) {
    issues.push({
      code: "LINE_COUNT",
      message: "Düzeltme taslağı tam iki satır olmalıdır.",
    });
  }

  let borc = draft.totalDebit != null ? roundMoney(draft.totalDebit) : 0;
  let alacak = draft.totalCredit != null ? roundMoney(draft.totalCredit) : 0;
  if (draft.totalDebit == null || draft.totalCredit == null) {
    borc = 0;
    alacak = 0;
    for (const line of lines) {
      borc = roundMoney(borc + roundMoney(line.borc));
      alacak = roundMoney(alacak + roundMoney(line.alacak));
    }
  }

  for (const line of lines) {
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
  const periodSlug = String(draft.correctionPeriod || "").replace("/", "-");
  const ref = draft.reference || {};

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
      belgeNo: draft.sourceDocumentNo || ref.sourceDocumentNo || "",
      evrakNo: draft.sourceDocumentNo || ref.sourceDocumentNo || "",
      evrakTarihi: draft.sourceDate || ref.sourceDate || fisTarihi,
      hesapKodu: line.hesapKodu,
      hesapAdi: line.hesapAdi,
      borc: line.borc,
      alacak: line.alacak,
      kontrolNotu: `Kaynak fiş ${draft.sourceFisNo || ref.sourceFisNo || ""} · dönem ${periodSlug}`,
    })
  );
}

function buildExportFileName(draft = {}, options = {}) {
  const slug = String(options.companySlug || draft.companySlug || "FIRMA")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 32);
  const period = String(draft.correctionPeriod || "").replace("/", "-");
  const fis = compactFisNo(
    draft.sourceFisNo || draft.reference?.sourceFisNo || "00000"
  );
  return `${slug}_${period}_DUZELTME_${fis}.xlsx`;
}

/** Onaylı taslak → workbook + dosya adı (V1 byte/header regresyonu korunur). */
export function buildCorrectionExportWorkbook(draft = {}, options = {}) {
  const {
    userApproved = false,
    exportMode = CORRECTION_EXPORT_MODE.LUCA_STANDARD,
  } = options;

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
  enforceLucaExportDateStrings(worksheet, [
    "Fiş Tarihi",
    "Evrak Tarihi",
    "Hesap Kodu",
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Luca Fisleri");

  const result = {
    ok: true,
    fileName,
    rowCount: lucaRows.length,
    exportMode,
    lucaCompatible: exportMode === CORRECTION_EXPORT_MODE.LUCA_STANDARD,
    persist: 0,
    workbook,
    lucaRows,
  };

  if (exportMode === CORRECTION_EXPORT_MODE.ANNVERO_FALLBACK) {
    result.warning =
      "Doğrudan Luca içe aktarım uyumluluğu henüz doğrulanmadı.";
  }

  return result;
}

/**
 * Onaylı taslak → Luca standard veya ANNVERO fallback Excel.
 * Toplu düzeltme gelecekte yalnız kullanıcı onaylı taslaklardan türetilmeli.
 */
export function exportCorrectionDraft(draft = {}, options = {}) {
  const built = buildCorrectionExportWorkbook(draft, options);
  if (!built.ok) return built;

  XLSX.writeFile(built.workbook, built.fileName);

  const result = {
    ok: true,
    fileName: built.fileName,
    rowCount: built.rowCount,
    exportMode: built.exportMode,
    lucaCompatible: built.lucaCompatible,
    persist: 0,
  };

  if (built.warning) result.warning = built.warning;
  return result;
}

/** Bulgu satırı düzeltmeye uygun mu? (registry üzerinden) */
export function isCorrectionEligibleFinding(finding, ledgerRows) {
  if (!finding) return false;
  const sourceVoucher = buildSourceVoucherFromLedgerRows(
    ledgerRows,
    finding.fisNo,
    { finding }
  );
  if (!sourceVoucher) return false;
  return detectCorrectionRecipe(finding, sourceVoucher).ok;
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
    finding.fisNo,
    { finding }
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

  return {
    recipe,
    sourceVoucher,
    dateContext,
    closedReliability: closed.reliability,
  };
}
