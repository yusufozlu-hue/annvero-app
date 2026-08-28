import { formatDateTR } from "@/src/utils/formatDateTR";
import { E_DEFTER_ISSUE_SEVERITY } from "@/src/config/eDefterKontrolDefaults";
import {
  buildCorrectionRecordFingerprint,
  fingerprintInputFromDraftAndRecipe,
} from "@/src/utils/correctionRecords/correctionRecordFingerprint";
import { CORRECTION_RECORD_STATUS } from "@/src/utils/correctionRecords/correctionRecordTypes";

function compactFisNo(value = "") {
  return String(value ?? "").trim();
}

export function indexCorrectionRecordsByFingerprint(records = []) {
  const map = new Map();
  for (const record of records) {
    if (record?.sourceFingerprint) {
      map.set(record.sourceFingerprint, record);
    }
  }
  return map;
}

export function resolveCorrectionRecordForFinding(finding = {}, recordsByFingerprint = new Map()) {
  for (const record of recordsByFingerprint.values()) {
    if (record.status === CORRECTION_RECORD_STATUS.CANCELLED) continue;
    if (compactFisNo(record.sourceVoucherNo) !== compactFisNo(finding.fisNo)) continue;
    if (finding.code && record.findingCode && finding.code !== record.findingCode) continue;
    if (finding.hesapKodu && record.wrongAccountCode) {
      if (String(finding.hesapKodu).trim() !== String(record.wrongAccountCode).trim()) continue;
    }
    return record;
  }
  return null;
}

export function buildAppliedCorrectionStatusLabel(record = {}) {
  const voucherNo = record.externalVoucherNo || "—";
  const dateTr = formatDateTR(record.externalVoucherDate || record.correctionDate);
  return `Luca fişi ${voucherNo} ile ${dateTr} tarihinde düzeltildi.`;
}

export function buildExportedPendingStatusLabel() {
  return "Düzeltme dosyası indirildi — Luca kaydı bekleniyor";
}

export function enrichFindingWithCorrectionRecord(finding = {}, record = null) {
  if (!record || record.status === CORRECTION_RECORD_STATUS.CANCELLED) {
    return {
      ...finding,
      correctionRecord: null,
      correctionResolved: false,
      correctionPendingExport: false,
      correctionStatusLabel: "",
    };
  }

  if (record.status === CORRECTION_RECORD_STATUS.APPLIED) {
    return {
      ...finding,
      correctionRecord: record,
      correctionResolved: true,
      correctionPendingExport: false,
      correctionStatusLabel: "Düzeltildi",
      correctionStatusMessage: buildAppliedCorrectionStatusLabel(record),
      displayMessage: buildAppliedCorrectionStatusLabel(record),
    };
  }

  if (record.status === CORRECTION_RECORD_STATUS.EXPORTED) {
    return {
      ...finding,
      correctionRecord: record,
      correctionResolved: false,
      correctionPendingExport: true,
      correctionStatusLabel: "Export bekleniyor",
      correctionStatusMessage: buildExportedPendingStatusLabel(),
    };
  }

  return finding;
}

export function summarizeCorrectionPresentationImpact(catalog = [], records = []) {
  const activeRecords = records.filter(
    (record) => record.status !== CORRECTION_RECORD_STATUS.CANCELLED
  );
  const recordsByFingerprint = indexCorrectionRecordsByFingerprint(activeRecords);

  let duzeltildi = 0;
  let exportedPending = 0;
  let adjustedInceleme = 0;

  for (const item of catalog) {
    if (item.severity === E_DEFTER_ISSUE_SEVERITY.BILGI) continue;

    const record = resolveCorrectionRecordForFinding(item, recordsByFingerprint);
    if (record?.status === CORRECTION_RECORD_STATUS.APPLIED) {
      duzeltildi += 1;
      continue;
    }
    if (record?.status === CORRECTION_RECORD_STATUS.EXPORTED) {
      exportedPending += 1;
    }
    adjustedInceleme += 1;
  }

  return {
    duzeltildi,
    exportedPending,
    adjustedInceleme,
    recordsByFingerprint,
  };
}

export function buildDraftFingerprintContext(draft = {}, recipe = {}) {
  const input = fingerprintInputFromDraftAndRecipe(draft, recipe);
  return {
    sourceFingerprint: buildCorrectionRecordFingerprint(input),
    fingerprintInput: input,
  };
}
