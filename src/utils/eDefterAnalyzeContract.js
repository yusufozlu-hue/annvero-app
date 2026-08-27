/**
 * E-Defter / Genel Muhasebe analyze worker contract — clone-safe request/response.
 * Worker is only an execution boundary around shared engines (no parallel motor).
 */

import { runOneClickEDefterKontrol } from "@/src/utils/eDefterKontrolEngine";
import { runGenelMuhasebeKontrol } from "@/src/utils/genelMuhasebeKontrolEngine";

export const EDEFTER_ANALYZE_PROTOCOL = 1;

/** Job kinds — E_DEFTER_CONTROL is the backward-compatible default. */
export const EDEFTER_ANALYZE_JOB_KIND = {
  E_DEFTER_CONTROL: "E_DEFTER_CONTROL",
  GENERAL_LEDGER_CONTROL: "GENERAL_LEDGER_CONTROL",
};

export const EDEFTER_ANALYZE_MSG = {
  REQUEST: "EDEFTER_ANALYZE_REQUEST",
  RESULT: "EDEFTER_ANALYZE_RESULT",
  ERROR: "EDEFTER_ANALYZE_ERROR",
};

const SENSITIVE_KEY_RE =
  /^(xml|zip|raw|content|filePath|absolutePath|token|secret|password|authorization|env)$/i;

export function resolveAnalyzeJobKind(value) {
  const raw = String(value || "").trim();
  if (raw === EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL) {
    return EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL;
  }
  return EDEFTER_ANALYZE_JOB_KIND.E_DEFTER_CONTROL;
}

function cloneJson(value, depth = 0) {
  if (depth > 8) return null;
  if (value == null) return value;
  if (typeof value === "string") return value.slice(0, 4000);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return value;
  }
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 200_000).map((item) => cloneJson(item, depth + 1));
  }
  if (typeof value !== "object") return null;
  if (value instanceof Date) return value.toISOString();
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) continue;
    if (typeof raw === "function" || typeof raw === "symbol") continue;
    out[key] = cloneJson(raw, depth + 1);
  }
  return out;
}

function sanitizeCell(cell) {
  if (cell == null) return "";
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return 0;
    return cell;
  }
  if (typeof cell === "boolean") return cell;
  if (cell instanceof Date) return cell.toISOString();
  return String(cell).slice(0, 500);
}

/** Clone-safe Excel sheet matrix (preserves 0 / empty string). */
export function sanitizeSheetRows(rows) {
  if (!Array.isArray(rows)) return null;
  return rows.slice(0, 200_000).map((row) => {
    if (!Array.isArray(row)) return [];
    return row.slice(0, 64).map(sanitizeCell);
  });
}

/** Normalize plan row codes from API (`accountCode`) or engine (`account_code`) shapes. */
export function accountCodeFromPlanRow(account) {
  return String(
    account?.account_code ||
      account?.accountCode ||
      account?.hesapKodu ||
      account?.code ||
      ""
  )
    .trim()
    .slice(0, 32);
}

function sanitizeAccountPlanAccounts(accounts) {
  if (!Array.isArray(accounts)) return null;
  return accounts
    .slice(0, 50_000)
    .map((account) => ({
      account_code: accountCodeFromPlanRow(account),
    }))
    .filter((account) => account.account_code);
}

function sanitizeRow(row = {}) {
  return cloneJson({
    id: row.id,
    kaynak: row.kaynak,
    documentClass: row.documentClass,
    fisNo: row.fisNo,
    yevmiyeNo: row.yevmiyeNo,
    belgeNo: row.belgeNo,
    belgeTarihi: row.belgeTarihi,
    fisTarihi: row.fisTarihi,
    hesapKodu: row.hesapKodu,
    hesapAdi: row.hesapAdi ? String(row.hesapAdi).slice(0, 120) : "",
    aciklama: row.aciklama ? String(row.aciklama).slice(0, 160) : "",
    borc: row.borc,
    alacak: row.alacak,
    tutar: row.tutar,
    paraBirimi: row.paraBirimi,
    companyId: row.companyId,
    period: row.period,
    counterAccountCode: row.counterAccountCode || row.karsiHesapKodu || "",
    karsiHesapKodu: row.karsiHesapKodu || row.counterAccountCode || "",
    issueDetails: row.issueDetails,
    issues: row.issues,
    grup: row.grup,
    riskScore: row.riskScore,
    sonucSeviye: row.sonucSeviye,
    disaridaBirak: row.disaridaBirak,
  });
}

function sanitizeParsedUpload(parsedUpload) {
  if (!parsedUpload || typeof parsedUpload !== "object") return null;
  return cloneJson({
    duplicate: Boolean(parsedUpload.duplicate),
    duplicateMessage: parsedUpload.duplicateMessage
      ? String(parsedUpload.duplicateMessage).slice(0, 240)
      : "",
    fingerprint: parsedUpload.fingerprint
      ? String(parsedUpload.fingerprint).slice(0, 128)
      : "",
    rows: Array.isArray(parsedUpload.rows)
      ? parsedUpload.rows.map(sanitizeRow)
      : [],
    technicalFindings: Array.isArray(parsedUpload.technicalFindings)
      ? cloneJson(parsedUpload.technicalFindings)
      : [],
    packageMeta: {
      taxId: parsedUpload.packageMeta?.taxId
        ? String(parsedUpload.packageMeta.taxId).slice(0, 20)
        : "",
      period: parsedUpload.packageMeta?.period
        ? String(parsedUpload.packageMeta.period).slice(0, 16)
        : "",
      defterType: parsedUpload.packageMeta?.defterType
        ? String(parsedUpload.packageMeta.defterType).slice(0, 40)
        : "",
    },
    beratMeta: parsedUpload.beratMeta ? cloneJson(parsedUpload.beratMeta) : null,
  });
}

function collectIssueCodes(rows = []) {
  return rows
    .flatMap((row) => {
      if (Array.isArray(row.issueDetails)) {
        return row.issueDetails.map((d) => d.code || d.message || "");
      }
      if (Array.isArray(row.issues)) return row.issues.map((x) => String(x));
      return [];
    })
    .filter(Boolean)
    .sort();
}

/** Clone-safe analyze payload (no File/Set/DOM/raw XML). */
export function buildCloneSafeAnalyzePayload(input = {}) {
  const jobKind = resolveAnalyzeJobKind(input.jobKind || input.jobType);

  if (jobKind === EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL) {
    return {
      jobKind,
      companyId: String(input.companyId || "").slice(0, 80),
      period: String(input.period || "").slice(0, 16),
      muavinSheetRows: sanitizeSheetRows(input.muavinSheetRows),
      yevmiyeSheetRows: sanitizeSheetRows(input.yevmiyeSheetRows),
      mizanSheetRows: sanitizeSheetRows(input.mizanSheetRows),
      accountPlanAccounts: sanitizeAccountPlanAccounts(input.accountPlanAccounts),
      accountPlanStatus: String(input.accountPlanStatus || "unknown").slice(0, 32),
    };
  }

  return {
    jobKind: EDEFTER_ANALYZE_JOB_KIND.E_DEFTER_CONTROL,
    parsedUpload: sanitizeParsedUpload(input.parsedUpload),
    muavinRows: (input.muavinRows || []).map(sanitizeRow),
    yevmiyeRows: (input.yevmiyeRows || []).map(sanitizeRow),
    mizanRows: (input.mizanRows || []).map(sanitizeRow),
    edefterListeRows: (input.edefterListeRows || []).map(sanitizeRow),
    companyId: String(input.companyId || "").slice(0, 80),
    companyTaxId: String(input.companyTaxId || "").slice(0, 20),
    period: String(input.period || "").slice(0, 16),
    accountPlanCodes: Array.isArray(input.accountPlanCodes)
      ? input.accountPlanCodes.map((code) => String(code).slice(0, 32)).slice(0, 50_000)
      : null,
    declarationRecords: cloneJson(input.declarationRecords || []),
    coreDecision: cloneJson(input.coreDecision || null),
  };
}

export function buildResultFingerprint(result = {}) {
  const summary = result.summary || {};
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const issueCodes = collectIssueCodes(rows);

  if (
    result.mode === "local-control" ||
    summary.localOnly === true ||
    result.jobKind === EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL
  ) {
    const mizan = summary.mizanMuavin || {};
    return [
      "GL",
      rows.length,
      summary.toplamSatir ?? "",
      summary.toplamFis ?? "",
      summary.kesinKarsit ?? "",
      summary.cokluKarsit ?? "",
      summary.incelemeGerekli ?? "",
      summary.hesapPlandaYok ?? "",
      summary.borcToplam ?? "",
      summary.alacakToplam ?? "",
      summary.borcAlacakFark ?? "",
      summary.planEvidence ?? "",
      mizan.status ?? "",
      mizan.matched === true ? "1" : "0",
      summary.overallSonuc || result.overallSonuc || "",
      summary.edefterUygun === true ? "1" : "0",
      JSON.stringify(result.documentClasses || {}),
      issueCodes.join("|"),
    ].join("::");
  }

  return [
    rows.length,
    summary.overallSonuc || result.overallSonuc || "",
    summary.edefterUygun === true ? "1" : "0",
    summary.findingCount ?? summary.bulguSayisi ?? "",
    summary.kritikHata ?? "",
    issueCodes.join("|"),
  ].join("::");
}

export function sanitizeAnalyzeResult(result = {}, diagnostics = {}) {
  const rows = Array.isArray(result.rows) ? result.rows.map(sanitizeRow) : [];
  const summary = cloneJson(result.summary || {});
  const jobKind =
    diagnostics.jobKind ||
    result.jobKind ||
    (result.mode === "local-control"
      ? EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL
      : EDEFTER_ANALYZE_JOB_KIND.E_DEFTER_CONTROL);

  return {
    ok: true,
    jobKind,
    mode: result.mode || "",
    duplicate: Boolean(result.duplicate),
    duplicateMessage: result.duplicateMessage
      ? String(result.duplicateMessage).slice(0, 240)
      : "",
    rows,
    summary,
    groupCounts: cloneJson(result.groupCounts || []),
    overallSonuc: result.overallSonuc || summary?.overallSonuc || "",
    disclaimer: result.disclaimer ? String(result.disclaimer).slice(0, 500) : "",
    journalLedger: cloneJson(result.journalLedger || null),
    findingExtras: cloneJson(result.findingExtras || []),
    documentClasses: cloneJson(result.documentClasses || {}),
    parsedCounts: cloneJson(result.parsedCounts || {}),
    timing: cloneJson(result.timing || {}),
    counters: cloneJson(result.counters || {}),
    resultFingerprint: buildResultFingerprint({
      rows,
      summary,
      overallSonuc: result.overallSonuc,
      mode: result.mode,
      jobKind,
      documentClasses: result.documentClasses,
    }),
    diagnostics: cloneJson({
      ...diagnostics,
      jobKind,
      rowCount: rows.length,
      protocolVersion: EDEFTER_ANALYZE_PROTOCOL,
    }),
  };
}

/**
 * Single worker/main entry for both job kinds.
 * E_DEFTER_CONTROL → runOneClickEDefterKontrol (unchanged).
 * GENERAL_LEDGER_CONTROL → runGenelMuhasebeKontrol (shared orchestration).
 */
export async function executeEDefterAnalyzePayload(payload = {}) {
  const jobKind = resolveAnalyzeJobKind(payload.jobKind || payload.jobType);

  if (jobKind === EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL) {
    return runGenelMuhasebeKontrol({
      companyId: payload.companyId || "",
      period: payload.period || "",
      muavinSheetRows: payload.muavinSheetRows,
      yevmiyeSheetRows: payload.yevmiyeSheetRows,
      mizanSheetRows: payload.mizanSheetRows,
      accountPlanAccounts: payload.accountPlanAccounts,
      accountPlanStatus: payload.accountPlanStatus || "unknown",
    });
  }

  return runOneClickEDefterKontrol({
    parsedUpload: payload.parsedUpload || null,
    muavinRows: payload.muavinRows || [],
    yevmiyeRows: payload.yevmiyeRows || [],
    mizanRows: payload.mizanRows || [],
    edefterListeRows: payload.edefterListeRows || [],
    companyId: payload.companyId || "",
    companyTaxId: payload.companyTaxId || "",
    period: payload.period || "",
    accountPlanCodes: payload.accountPlanCodes || null,
    declarationRecords: payload.declarationRecords || [],
    coreDecision: payload.coreDecision || null,
    fingerprintSession: null,
  });
}

export function resultsAreParityEqual(a, b) {
  return buildResultFingerprint(a) === buildResultFingerprint(b);
}
