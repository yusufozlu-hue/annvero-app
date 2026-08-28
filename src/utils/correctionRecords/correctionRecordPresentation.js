import { formatDateTR } from "@/src/utils/formatDateTR";
import { E_DEFTER_ISSUE_SEVERITY } from "@/src/config/eDefterKontrolDefaults";
import {
  buildCorrectionRecordFingerprint,
  fingerprintInputFromDraftAndRecipe,
} from "@/src/utils/correctionRecords/correctionRecordFingerprint";
import {
  CORRECTION_RECORD_ERROR,
  CORRECTION_RECORD_STATUS,
  correctionRecordUserMessage,
} from "@/src/utils/correctionRecords/correctionRecordTypes";

/**
 * Next.js 15+/16 App Router: dynamic `params` is a Promise.
 * Apply/cancel must await before reading `id` — otherwise recordId is empty → NOT_FOUND.
 */
export async function resolveCorrectionRecordRouteId(paramsOrPromise) {
  const params = await paramsOrPromise;
  return String(params?.id || "").trim();
}

/**
 * Fail-closed: Excel download and apply CTA require a real server EXPORTED/APPLIED record id.
 */
export function assertExportApiReadyForDownload(responseOk, payload = {}) {
  if (!responseOk || payload?.error) {
    return {
      ok: false,
      allowDownload: false,
      allowApply: false,
      code: payload?.code || CORRECTION_RECORD_ERROR.EXPORT_FAILED,
      error:
        payload?.error ||
        correctionRecordUserMessage(CORRECTION_RECORD_ERROR.EXPORT_FAILED),
      record: null,
    };
  }

  const record = payload?.record && typeof payload.record === "object" ? payload.record : null;
  if (!record?.id || !record?.sourceFingerprint) {
    return {
      ok: false,
      allowDownload: false,
      allowApply: false,
      code: CORRECTION_RECORD_ERROR.EXPORT_FAILED,
      error: correctionRecordUserMessage(CORRECTION_RECORD_ERROR.EXPORT_FAILED),
      record: null,
    };
  }

  if (
    record.status !== CORRECTION_RECORD_STATUS.EXPORTED &&
    record.status !== CORRECTION_RECORD_STATUS.APPLIED
  ) {
    return {
      ok: false,
      allowDownload: false,
      allowApply: false,
      code: CORRECTION_RECORD_ERROR.EXPORT_FAILED,
      error: correctionRecordUserMessage(CORRECTION_RECORD_ERROR.EXPORT_FAILED),
      record: null,
    };
  }

  return {
    ok: true,
    allowDownload: true,
    allowApply: record.status === CORRECTION_RECORD_STATUS.EXPORTED,
    code: null,
    error: "",
    record,
    created: Boolean(payload.created),
    fileName: payload.fileName || record.exportedFileName || "",
  };
}

/** Upsert-by-id/fingerprint into local list without duplicates. */
export function mergeCorrectionRecordIntoList(records = [], record = null) {
  if (!record?.id) return Array.isArray(records) ? [...records] : [];
  const next = (Array.isArray(records) ? records : []).filter(
    (entry) =>
      entry?.id !== record.id &&
      (!record.sourceFingerprint || entry?.sourceFingerprint !== record.sourceFingerprint)
  );
  return [record, ...next];
}

export function isCorrectionRecordNotFoundError(payload = {}, responseOk = false) {
  if (responseOk) return false;
  if (payload?.code === CORRECTION_RECORD_ERROR.NOT_FOUND) return true;
  return /kayd[ıi] bulunamad[ıi]/i.test(String(payload?.error || ""));
}

export function buildStaleCorrectionRecordNotice() {
  return "Düzeltme kaydı bulunamadı. Lütfen Luca aktarım dosyasını yeniden export edin.";
}

/** Apply UI may open only with a server-backed EXPORTED record id. */
export function canOpenApplyForCorrectionRecord(record = null) {
  return Boolean(
    record?.id &&
      record?.sourceFingerprint &&
      record.status === CORRECTION_RECORD_STATUS.EXPORTED
  );
}

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
