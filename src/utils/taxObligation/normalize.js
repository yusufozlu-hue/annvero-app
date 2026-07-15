/**
 * Normalize edilmiş tahakkuk / satır / zincir anahtarı.
 */
import {
  ACCRUAL_STATUS,
  DOCUMENT_TYPE,
  LINE_TYPE,
  MAPPING_STATUS,
  PARSER_VERSION,
  REVISION_TYPE,
  SOURCE_PROVIDER,
} from "./types.js";

export function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function buildPeriodKey(start = "", end = "", fallback = "") {
  const s = String(start || "").trim();
  const e = String(end || "").trim();
  if (s && e) return `${s}|${e}`;
  if (s) return s;
  const f = String(fallback || "").trim();
  return f || "";
}

/** YYYY-MM veya YYYY/MM → normalize */
export function normalizePeriodToken(value = "") {
  const t = String(value || "").trim();
  const m = t.match(/^(20\d{2})[./-](0?[1-9]|1[0-2])$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}`;
  return t;
}

export function revisionNoFromType(revisionType = REVISION_TYPE.NORMAL, revisionNo = 0) {
  const type = String(revisionType || REVISION_TYPE.NORMAL).toUpperCase();
  if (type === REVISION_TYPE.NORMAL || type === "NORMAL") return 0;
  const n = Number(revisionNo);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  const fromLabel = String(revisionType || "").match(/(\d+)/);
  return fromLabel ? Number(fromLabel[1]) : 1;
}

/**
 * Belge zinciri anahtarı:
 * company_id | obligation_type | tax_period | revision_no | document_type
 */
export function buildObligationChainKey({
  companyId = "",
  obligationType = "",
  periodKey = "",
  revisionNo = 0,
  documentType = DOCUMENT_TYPE.TAHAKKUK,
} = {}) {
  return [
    companyId || "-",
    String(obligationType || "").toUpperCase() || "-",
    periodKey || "-",
    String(Number(revisionNo) || 0),
    String(documentType || DOCUMENT_TYPE.TAHAKKUK).toUpperCase(),
  ].join("|");
}

export function buildObligationAccrualLine(input = {}) {
  const principal = roundMoney(input.principal_amount ?? input.principalAmount ?? 0);
  const incentive = roundMoney(input.incentive_amount ?? input.incentiveAmount ?? 0);
  const cancellation = roundMoney(
    input.cancellation_amount ?? input.cancellationAmount ?? 0
  );
  const penalty = roundMoney(input.penalty_amount ?? input.penaltyAmount ?? 0);
  const lateFee = roundMoney(input.late_fee_amount ?? input.lateFeeAmount ?? 0);
  const payable =
    input.payable_amount != null || input.payableAmount != null
      ? roundMoney(input.payable_amount ?? input.payableAmount)
      : roundMoney(principal - incentive + cancellation + penalty + lateFee);

  return {
    id: input.id || "",
    accrual_id: input.accrual_id || input.accrualId || "",
    line_type: input.line_type || input.lineType || LINE_TYPE.PRINCIPAL,
    law_code: String(input.law_code || input.lawCode || "").trim(),
    description: String(input.description || "").trim(),
    principal_amount: principal,
    incentive_amount: incentive,
    cancellation_amount: cancellation,
    penalty_amount: penalty,
    late_fee_amount: lateFee,
    payable_amount: payable,
    accounting_role: input.accounting_role || input.accountingRole || "",
    mapped_account_code: String(
      input.mapped_account_code || input.mappedAccountCode || ""
    ).trim(),
    mapping_status:
      input.mapping_status ||
      input.mappingStatus ||
      (input.mapped_account_code || input.mappedAccountCode
        ? MAPPING_STATUS.MAPPED
        : MAPPING_STATUS.PENDING),
    source_text: String(input.source_text || input.sourceText || "").trim(),
    source_page: input.source_page ?? input.sourcePage ?? null,
    confidence: Number(input.confidence ?? 0) || 0,
  };
}

export function buildObligationAccrual(input = {}) {
  const lines = (input.lines || input.obligation_accrual_lines || []).map((row) =>
    buildObligationAccrualLine(row)
  );

  const sumField = (key) =>
    roundMoney(lines.reduce((s, l) => s + Number(l[key] || 0), 0));

  const revisionType = String(
    input.revision_type || input.revisionType || REVISION_TYPE.NORMAL
  ).toUpperCase();
  const revisionNo = revisionNoFromType(
    revisionType,
    input.revision_no ?? input.revisionNo
  );
  const periodKey =
    input.period_key ||
    input.periodKey ||
    buildPeriodKey(
      input.tax_period_start || input.taxPeriodStart,
      input.tax_period_end || input.taxPeriodEnd,
      normalizePeriodToken(input.period || "")
    );

  const totalPrincipal =
    input.total_principal != null || input.totalPrincipal != null
      ? roundMoney(input.total_principal ?? input.totalPrincipal)
      : sumField("principal_amount");
  const totalStamp =
    input.total_stamp_tax != null || input.totalStampTax != null
      ? roundMoney(input.total_stamp_tax ?? input.totalStampTax)
      : roundMoney(
          lines
            .filter((l) => l.line_type === LINE_TYPE.STAMP_TAX)
            .reduce((s, l) => s + l.payable_amount, 0)
        );
  const totalPenalty =
    input.total_penalty != null || input.totalPenalty != null
      ? roundMoney(input.total_penalty ?? input.totalPenalty)
      : sumField("penalty_amount");
  const totalLateFee =
    input.total_late_fee != null || input.totalLateFee != null
      ? roundMoney(input.total_late_fee ?? input.totalLateFee)
      : sumField("late_fee_amount");
  const totalLateInterest =
    input.total_late_interest != null || input.totalLateInterest != null
      ? roundMoney(input.total_late_interest ?? input.totalLateInterest)
      : 0;
  const totalIncentiveOnDoc =
    input.total_incentive_on_document != null ||
    input.totalIncentiveOnDocument != null
      ? roundMoney(
          input.total_incentive_on_document ?? input.totalIncentiveOnDocument
        )
      : sumField("incentive_amount");
  const totalPayable =
    input.total_payable != null || input.totalPayable != null
      ? roundMoney(input.total_payable ?? input.totalPayable)
      : roundMoney(
          lines.reduce((s, l) => s + Number(l.payable_amount || 0), 0) ||
            totalPrincipal +
              totalStamp +
              totalPenalty +
              totalLateFee +
              totalLateInterest -
              totalIncentiveOnDoc
        );

  const now = new Date().toISOString();
  const companyId = String(input.company_id || input.companyId || "").trim();
  const obligationType = String(
    input.obligation_type || input.obligationType || ""
  )
    .trim()
    .toUpperCase();
  const documentType = String(
    input.document_type || input.documentType || DOCUMENT_TYPE.TAHAKKUK
  ).toUpperCase();

  const id =
    input.id ||
    `obl-${companyId || "x"}-${obligationType || "x"}-${periodKey || "x"}-r${revisionNo}-${String(
      input.accrual_number || input.accrualNumber || ""
    ).slice(0, 24) || "n"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const accrual = {
    id,
    company_id: companyId,
    obligation_type: obligationType,
    document_type: documentType,
    tax_period_start: String(
      input.tax_period_start || input.taxPeriodStart || periodKey || ""
    ).trim(),
    tax_period_end: String(
      input.tax_period_end || input.taxPeriodEnd || periodKey || ""
    ).trim(),
    period_key: periodKey,
    revision_type: revisionType === REVISION_TYPE.DUZELTME || revisionNo > 0
      ? REVISION_TYPE.DUZELTME
      : REVISION_TYPE.NORMAL,
    revision_no: revisionNo,
    declaration_date: input.declaration_date || input.declarationDate || "",
    accrual_date: input.accrual_date || input.accrualDate || "",
    due_date: input.due_date || input.dueDate || "",
    accrual_number: String(
      input.accrual_number || input.accrualNumber || ""
    ).trim(),
    document_reference: String(
      input.document_reference || input.documentReference || ""
    ).trim(),
    total_principal: totalPrincipal,
    total_stamp_tax: totalStamp,
    total_penalty: totalPenalty,
    total_late_fee: totalLateFee,
    total_late_interest: totalLateInterest,
    total_incentive_on_document: totalIncentiveOnDoc,
    total_payable: totalPayable,
    currency: String(input.currency || "TRY").trim() || "TRY",
    source_file_id: String(input.source_file_id || input.sourceFileId || "").trim(),
    source_file_name: String(
      input.source_file_name || input.sourceFileName || ""
    ).trim(),
    source_file_hash: String(
      input.source_file_hash || input.sourceFileHash || ""
    ).trim(),
    source_provider:
      input.source_provider || input.sourceProvider || SOURCE_PROVIDER.UPLOAD,
    status: input.status || ACCRUAL_STATUS.OPEN,
    parser_version: input.parser_version || input.parserVersion || PARSER_VERSION,
    confidence: Number(input.confidence ?? 0) || 0,
    chain_key: buildObligationChainKey({
      companyId,
      obligationType,
      periodKey,
      revisionNo,
      documentType,
    }),
    lines,
    created_at: input.created_at || input.createdAt || now,
    updated_at: input.updated_at || input.updatedAt || now,
  };

  accrual.lines = accrual.lines.map((line) => ({
    ...line,
    accrual_id: accrual.id,
  }));

  return accrual;
}
