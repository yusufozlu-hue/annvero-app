/**
 * E-Defter analyze worker contract — clone-safe request/response.
 * Worker is only an execution boundary around eDefterKontrolEngine.
 */

import { runOneClickEDefterKontrol } from "@/src/utils/eDefterKontrolEngine";

export const EDEFTER_ANALYZE_PROTOCOL = 1;

export const EDEFTER_ANALYZE_MSG = {
  REQUEST: "EDEFTER_ANALYZE_REQUEST",
  RESULT: "EDEFTER_ANALYZE_RESULT",
  ERROR: "EDEFTER_ANALYZE_ERROR",
};

const SENSITIVE_KEY_RE =
  /^(xml|zip|raw|content|filePath|absolutePath|token|secret|password|authorization|env)$/i;

function cloneJson(value, depth = 0) {
  if (depth > 8) return null;
  if (value == null) return value;
  if (typeof value === "string") return value.slice(0, 4000);
  if (typeof value === "number" || typeof value === "boolean") return value;
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

function sanitizeRow(row = {}) {
  return cloneJson({
    id: row.id,
    kaynak: row.kaynak,
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

/** Clone-safe analyze payload (no File/Set/DOM/raw XML). */
export function buildCloneSafeAnalyzePayload(input = {}) {
  return {
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
  const issueCodes = rows
    .flatMap((row) => {
      if (Array.isArray(row.issueDetails)) {
        return row.issueDetails.map((d) => d.code || d.message || "");
      }
      if (Array.isArray(row.issues)) return row.issues.map((x) => String(x));
      return [];
    })
    .filter(Boolean)
    .sort();
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
  return {
    ok: true,
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
    resultFingerprint: buildResultFingerprint({
      rows,
      summary,
      overallSonuc: result.overallSonuc,
    }),
    diagnostics: cloneJson({
      ...diagnostics,
      rowCount: rows.length,
      protocolVersion: EDEFTER_ANALYZE_PROTOCOL,
    }),
  };
}

export async function executeEDefterAnalyzePayload(payload = {}) {
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
