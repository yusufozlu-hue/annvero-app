import { ledgerPeriodFromIsoDate } from "@/src/utils/correctionVoucher/correctionDatePolicy";
import { validateCorrectionDate } from "@/src/utils/correctionVoucher/correctionDatePolicy";
import { validateCorrectionDraft } from "@/src/utils/correctionVoucher/correctionVoucherEngine";
import {
  CORRECTION_RECORD_ERROR,
  CORRECTION_RECORD_EXTERNAL_SYSTEM,
  CORRECTION_RECORD_STATUS,
} from "@/src/utils/correctionRecords/correctionRecordTypes";
import {
  buildCorrectionRecordFingerprint,
  canonicalIsoDateFromLedgerDate,
  fingerprintInputFromDraftAndRecipe,
} from "@/src/utils/correctionRecords/correctionRecordFingerprint";

const TABLE = "accounting_correction_records";

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function sanitizeText(value, max = 280) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

function compactVoucherNo(value = "") {
  return String(value ?? "").trim();
}

export function buildExportRecordPayloadFromDraft({
  draft = {},
  recipe = {},
  exportedFileName = "",
  lastClosedReliability = null,
} = {}) {
  const validation = validateCorrectionDraft(draft, { lastClosedReliability });
  if (!validation.ok) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: validation.issues?.[0]?.message || "Taslak doğrulanamadı.",
    };
  }

  const fingerprintInput = fingerprintInputFromDraftAndRecipe(draft, recipe);
  const sourceFingerprint = buildCorrectionRecordFingerprint(fingerprintInput);
  if (!sourceFingerprint) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: "Düzeltme fingerprint oluşturulamadı.",
    };
  }

  const ref = draft.reference || {};
  const correctionDateIso = canonicalIsoDateFromLedgerDate(draft.correctionDate);
  const sourceDateIso = canonicalIsoDateFromLedgerDate(
    draft.sourceDate || ref.sourceDate || ""
  );
  const correctionLine = (draft.lines || []).find((line) => roundMoney(line.borc) > 0);
  const creditLine = (draft.lines || []).find((line) => roundMoney(line.alacak) > 0);

  return {
    ok: true,
    row: {
      company_id: sanitizeText(draft.companyId, 80),
      source_period: sanitizeText(
        ledgerPeriodFromIsoDate(sourceDateIso) ||
          String(draft.correctionPeriod || "").replace("-", "/"),
        16
      ),
      source_voucher_no: compactVoucherNo(draft.sourceFisNo || ref.sourceFisNo),
      source_voucher_date: sourceDateIso || null,
      source_document_no: sanitizeText(draft.sourceDocumentNo || ref.sourceDocumentNo, 64),
      finding_code: sanitizeText(
        draft.sourceFindingCode || draft.findingCode || recipe.findingCode,
        80
      ),
      recipe_code: sanitizeText(draft.recipeType || recipe.recipeType, 80),
      wrong_account_code: sanitizeText(draft.wrongAccountCode || draft.sourceAccountCode, 64),
      wrong_debit: roundMoney(fingerprintInput.wrongDebit),
      wrong_credit: roundMoney(fingerprintInput.wrongCredit),
      correction_account_code: sanitizeText(correctionLine?.hesapKodu, 64),
      correction_account_name: sanitizeText(correctionLine?.hesapAdi, 160),
      correction_date: correctionDateIso || null,
      correction_period: sanitizeText(
        draft.correctionPeriod || ledgerPeriodFromIsoDate(correctionDateIso),
        16
      ),
      correction_debit: roundMoney(draft.totalDebit ?? validation.borc),
      correction_credit: roundMoney(draft.totalCredit ?? validation.alacak),
      exported_file_name: sanitizeText(exportedFileName, 180),
      source_fingerprint: sourceFingerprint,
      status: CORRECTION_RECORD_STATUS.EXPORTED,
      external_system: CORRECTION_RECORD_EXTERNAL_SYSTEM.LUCA,
      metadata: {
        recipe_type: sanitizeText(draft.recipeType || recipe.recipeType, 80),
        credit_account_code: sanitizeText(creditLine?.hesapKodu, 64),
      },
    },
    sourceFingerprint,
  };
}

export function publicCorrectionRecordView(row = {}) {
  if (!row?.id) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    sourcePeriod: row.source_period || "",
    sourceVoucherNo: row.source_voucher_no || "",
    sourceVoucherDate: row.source_voucher_date || "",
    sourceDocumentNo: row.source_document_no || "",
    findingCode: row.finding_code || "",
    recipeCode: row.recipe_code || "",
    wrongAccountCode: row.wrong_account_code || "",
    wrongDebit: Number(row.wrong_debit || 0),
    wrongCredit: Number(row.wrong_credit || 0),
    correctionAccountCode: row.correction_account_code || "",
    correctionAccountName: row.correction_account_name || "",
    correctionDate: row.correction_date || "",
    correctionPeriod: row.correction_period || "",
    correctionDebit: Number(row.correction_debit || 0),
    correctionCredit: Number(row.correction_credit || 0),
    exportedFileName: row.exported_file_name || "",
    sourceFingerprint: row.source_fingerprint || "",
    status: row.status || "",
    externalSystem: row.external_system || CORRECTION_RECORD_EXTERNAL_SYSTEM.LUCA,
    externalVoucherNo: row.external_voucher_no || "",
    externalVoucherDate: row.external_voucher_date || "",
    appliedAt: row.applied_at || null,
    appliedBy: row.applied_by || "",
    cancelledAt: row.cancelled_at || null,
    cancelReason: row.cancel_reason || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  };
}

export function validateApplyCorrectionRecordInput({
  record = {},
  externalVoucherNo = "",
  externalVoucherDate = "",
  userConfirmed = false,
  lastClosedLedgerPeriod = "",
  lastClosedReliability = null,
} = {}) {
  if (!record?.id) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.NOT_FOUND,
      message: "Düzeltme kaydı bulunamadı.",
    };
  }

  if (record.status === CORRECTION_RECORD_STATUS.APPLIED) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.CONFLICT,
      message: "Bu düzeltme zaten uygulanmış.",
    };
  }

  if (record.status === CORRECTION_RECORD_STATUS.CANCELLED) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: "İptal edilmiş düzeltme kaydı uygulanamaz.",
    };
  }

  if (record.status !== CORRECTION_RECORD_STATUS.EXPORTED) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: "Yalnız export edilmiş düzeltmeler uygulanabilir.",
    };
  }

  const voucherNo = compactVoucherNo(externalVoucherNo);
  if (!voucherNo) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: "Luca fiş numarası zorunludur.",
    };
  }

  const voucherDateIso = canonicalIsoDateFromLedgerDate(externalVoucherDate);
  if (!voucherDateIso) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: "Luca fiş tarihi geçersiz.",
    };
  }

  if (!userConfirmed) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: "Luca fişi onayı olmadan uygulama kaydedilemez.",
    };
  }

  const dateValidation = validateCorrectionDate({
    correctionDate: voucherDateIso,
    lastClosedLedgerPeriod,
    lastClosedReliability,
  });

  if (!dateValidation.ok) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: dateValidation.issues?.[0]?.message || "Luca fiş tarihi geçersiz.",
      issues: dateValidation.issues,
    };
  }

  const warnings = [];
  const recordCorrectionIso = canonicalIsoDateFromLedgerDate(record.correction_date);
  if (recordCorrectionIso && voucherDateIso !== recordCorrectionIso) {
    warnings.push({
      code: "EXTERNAL_DATE_DIFFERS",
      message: "Luca fiş tarihi düzeltme tarihinden farklı; açık dönemde kabul edildi.",
    });
  }

  if (voucherNo === compactVoucherNo(record.source_voucher_no)) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: "Kaynak fiş numarası ile Luca düzeltme fiş numarası karıştırılamaz.",
    };
  }

  return {
    ok: true,
    externalVoucherNo: voucherNo,
    externalVoucherDate: voucherDateIso,
    warnings,
  };
}

export function validateCancelCorrectionRecordInput({
  record = {},
  cancelReason = "",
  userConfirmed = false,
} = {}) {
  if (!record?.id) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.NOT_FOUND,
      message: "Düzeltme kaydı bulunamadı.",
    };
  }

  if (record.status === CORRECTION_RECORD_STATUS.CANCELLED) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.CONFLICT,
      message: "Kayıt zaten iptal edilmiş.",
    };
  }

  if (
    record.status !== CORRECTION_RECORD_STATUS.EXPORTED &&
    record.status !== CORRECTION_RECORD_STATUS.APPLIED
  ) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: "Bu kayıt iptal edilemez.",
    };
  }

  const reason = sanitizeText(cancelReason, 500);
  if (!reason) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: "İptal nedeni zorunludur.",
    };
  }

  if (!userConfirmed) {
    return {
      ok: false,
      code: CORRECTION_RECORD_ERROR.INVALID,
      message: "İptal onayı gerekli.",
    };
  }

  return { ok: true, cancelReason: reason };
}

export async function findActiveCorrectionRecordByFingerprint(supabase, companyId, fingerprint) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("company_id", companyId)
    .eq("source_fingerprint", fingerprint)
    .in("status", [CORRECTION_RECORD_STATUS.EXPORTED, CORRECTION_RECORD_STATUS.APPLIED])
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function upsertExportedCorrectionRecord(supabase, row, actorId) {
  const existing = await findActiveCorrectionRecordByFingerprint(
    supabase,
    row.company_id,
    row.source_fingerprint
  );

  if (existing) {
    return { record: existing, created: false };
  }

  const insertRow = {
    ...row,
    created_by: actorId,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(TABLE)
    .insert(insertRow)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const raced = await findActiveCorrectionRecordByFingerprint(
        supabase,
        row.company_id,
        row.source_fingerprint
      );
      if (raced) return { record: raced, created: false };
    }
    throw error;
  }

  return { record: data, created: true };
}

export { TABLE as CORRECTION_RECORDS_TABLE };
