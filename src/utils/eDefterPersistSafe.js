/**
 * E-Defter kalıcı kayıt — yalnız allowlist alanları.
 * Ham XML/ZIP, belge satırı, IBAN, tam VKN/MERSİS, Drive file ID, token YASAK.
 */

import { E_DEFTER_ENGINE_VERSION as DEFAULT_ENGINE_VERSION } from "@/src/config/eDefterKontrolDefaults";

export const E_DEFTER_ENGINE_VERSION = DEFAULT_ENGINE_VERSION;

export const EDEFTER_RUN_STATUSES = Object.freeze([
  "running",
  "completed",
  "failed",
  "superseded",
  "deleted",
]);

export const EDEFTER_RECONCILIATION_STATUSES = Object.freeze([
  "matched",
  "mismatched",
  "skipped",
  "partial",
]);

export const EDEFTER_FINDING_RESOLUTION = Object.freeze({
  OPEN: "open",
  RESOLVED: "resolved",
  ACCEPTED: "accepted",
  DISMISSED: "dismissed",
});

export const EDEFTER_AUDIT_EVENT_TYPES = Object.freeze({
  RUN_CREATED: "run_created",
  RUN_IDEMPOTENT_HIT: "run_idempotent_hit",
  RUN_SUPERSEDED: "run_superseded",
  FINDING_RESOLVED: "finding_resolved",
  SAVE_RETRY: "save_retry",
});

/** safe_metadata allowlist — istemci key'leri doğrudan saklanmaz */
export const EDEFTER_SAFE_METADATA_KEYS = Object.freeze([
  "engine_version",
  "period",
  "status",
  "revision",
  "document_count",
  "row_count",
  "reconciliation_status",
  "severity_counts",
  "overall_sonuc",
  "idempotent",
  "superseded_run_id",
  "finding_code",
  "resolution_status",
  "retry",
]);

const FORBIDDEN_KEY_RE =
  /xml|zip|iban|vkn|mersis|token|secret|password|raw|content|drive.?file|file.?id|payload|body|document.?text|satir|row.?data|belge.?metin/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeString(value, max = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

function sanitizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeJsonObject(value, depth = 0) {
  if (depth > 3) return {};
  if (!isPlainObject(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (FORBIDDEN_KEY_RE.test(key)) continue;
    if (typeof raw === "string") {
      out[sanitizeString(key, 64)] = sanitizeString(raw, 240);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      out[sanitizeString(key, 64)] = raw;
    } else if (typeof raw === "boolean") {
      out[sanitizeString(key, 64)] = raw;
    } else if (Array.isArray(raw)) {
      out[sanitizeString(key, 64)] = raw
        .slice(0, 40)
        .map((item) =>
          typeof item === "string"
            ? sanitizeString(item, 120)
            : typeof item === "number" && Number.isFinite(item)
              ? item
              : null
        )
        .filter((item) => item !== null);
    } else if (isPlainObject(raw)) {
      out[sanitizeString(key, 64)] = sanitizeJsonObject(raw, depth + 1);
    }
  }
  return out;
}

export function buildSafeEdefterMetadata(input = {}) {
  const out = {};
  for (const key of EDEFTER_SAFE_METADATA_KEYS) {
    if (input[key] === undefined || input[key] === null) continue;
    const value = input[key];
    if (typeof value === "string") out[key] = sanitizeString(value, 240);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else if (isPlainObject(value) || Array.isArray(value)) {
      out[key] = sanitizeJsonObject(
        Array.isArray(value) ? { items: value } : value
      );
    }
  }
  return out;
}

function mapSeverity(level = "") {
  const t = sanitizeString(level, 64).toLocaleLowerCase("tr-TR");
  if (t.includes("kritik") || t === "critical") return "critical";
  if (t.includes("uyarı") || t.includes("uyari") || t.includes("yüksek") || t.includes("yuksek")) {
    return "warning";
  }
  if (t.includes("bilgi") || t.includes("orta")) return "info";
  if (t.includes("uygun") || t.includes("düşük") || t.includes("dusuk")) return "ok";
  return "info";
}

function mapResolution(status = "") {
  const t = sanitizeString(status, 64).toLocaleLowerCase("tr-TR");
  if (t === "çözüldü" || t === "cozuldü" || t === "resolved" || t === "çözuldu") {
    return EDEFTER_FINDING_RESOLUTION.RESOLVED;
  }
  if (t === "accepted" || t === "kabul") return EDEFTER_FINDING_RESOLUTION.ACCEPTED;
  if (t === "dismissed" || t === "red") return EDEFTER_FINDING_RESOLUTION.DISMISSED;
  return EDEFTER_FINDING_RESOLUTION.OPEN;
}

function buildSafeReference(row = {}) {
  const parts = [
    row.fisNo ? `fis:${sanitizeString(row.fisNo, 40)}` : "",
    row.yevmiyeNo ? `yev:${sanitizeString(row.yevmiyeNo, 40)}` : "",
    row.hesapKodu ? `hk:${sanitizeString(row.hesapKodu, 40)}` : "",
    row.belgeNo ? `blg:${sanitizeString(row.belgeNo, 40)}` : "",
    row.belgeNo || row.fisNo || row.hesapKodu ? "" : sanitizeString(row.code || row.belgeNo || "", 40),
  ].filter(Boolean);
  return parts.join("|").slice(0, 160);
}

function buildFindingSummary(row = {}) {
  const issues = Array.isArray(row.issues) ? row.issues : [];
  const base =
    issues[0] ||
    row.aciklama ||
    row.message ||
    row.smartExplanation ||
    row.code ||
    "Bulgu";
  // Açıklama alanından ham satır metnini kısalt; IBAN/VKN benzeri kalıpları maskele
  return sanitizeString(base, 280)
    .replace(/\bTR\d{2}\s?\d{4}[\d\s]{10,}\b/gi, "TR**")
    .replace(/\b\d{10,11}\b/g, (m) => `${m.slice(0, 2)}****${m.slice(-2)}`);
}

/**
 * Analiz sonucundan sunucuya gönderilecek güvenli kayıt gövdesi.
 */
export function buildSafeEdefterPersistPayload({
  companyId = "",
  period = "",
  engineVersion = E_DEFTER_ENGINE_VERSION,
  fingerprints = {},
  summary = {},
  rows = [],
  journalLedger = null,
  documentTypes = [],
  documentCount = 0,
  startedAt = null,
  completedAt = null,
  retry = false,
} = {}) {
  const findingRows = (Array.isArray(rows) ? rows : []).filter(
    (row) => row && row.grup && String(row.grup) !== "Hatasız kayıtlar"
  );

  const severityCounts = {
    critical: sanitizeNumber(summary.kritikHata),
    warning: sanitizeNumber(summary.uyariSayisi),
    technical: sanitizeNumber(summary.teknikHata),
    tax: sanitizeNumber(summary.vergiselRisk),
    high: sanitizeNumber(summary.yuksekRisk),
    duplicate: sanitizeNumber(summary.mukerrerRisk),
    reverse_balance: sanitizeNumber(summary.tersBakiye),
    missing: sanitizeNumber(summary.eksikBilgi),
    total_findings: findingRows.length,
  };

  let reconciliationStatus = "skipped";
  let reconciliationSummary = {};
  if (journalLedger && !journalLedger.skipped) {
    reconciliationStatus = journalLedger.matched ? "matched" : "mismatched";
    reconciliationSummary = {
      matched: Boolean(journalLedger.matched),
      finding_count: Array.isArray(journalLedger.findings)
        ? journalLedger.findings.length
        : 0,
      y_borc: sanitizeNumber(journalLedger.yTotals?.borc),
      y_alacak: sanitizeNumber(journalLedger.yTotals?.alacak),
      k_borc: sanitizeNumber(journalLedger.kTotals?.borc),
      k_alacak: sanitizeNumber(journalLedger.kTotals?.alacak),
    };
  }

  const opening = sanitizeJsonObject({
    toplam_satir: sanitizeNumber(summary.toplamSatir),
    toplam_fis: sanitizeNumber(summary.toplamFis),
  });
  const closing = sanitizeJsonObject({
    overall_sonuc: sanitizeString(summary.overallSonuc, 64),
    edefter_uygun: Boolean(summary.edefterUygun),
    can_approve_export: Boolean(summary.canApproveExport),
  });

  const aggregated = new Map();
  for (const row of findingRows) {
    const code = sanitizeString(row.code || row.belgeNo || row.grup || "FINDING", 80);
    const severity = mapSeverity(row.sonucSeviye || row.riskLevel || row.level);
    const category = sanitizeString(row.hataTuru || row.grup || row.kaynak || "", 80);
    const key = `${code}|${severity}|${category}|${buildSafeReference(row)}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.occurrence_count += 1;
      continue;
    }
    aggregated.set(key, {
      code,
      severity,
      category,
      safe_reference: buildSafeReference(row),
      summary: buildFindingSummary(row),
      occurrence_count: 1,
      resolution_status: mapResolution(row.cozumDurumu),
    });
  }

  return {
    company_id: sanitizeString(companyId, 120),
    period: sanitizeString(period, 32),
    status: "completed",
    engine_version: sanitizeString(engineVersion, 40),
    source_fingerprint: sanitizeString(fingerprints.source || fingerprints.source_fingerprint || "", 128),
    journal_fingerprint: sanitizeString(
      fingerprints.journal || fingerprints.journal_fingerprint || "",
      128
    ),
    ledger_fingerprint: sanitizeString(
      fingerprints.ledger || fingerprints.ledger_fingerprint || "",
      128
    ),
    document_types: (Array.isArray(documentTypes) ? documentTypes : [])
      .map((t) => sanitizeString(t, 40))
      .filter(Boolean)
      .slice(0, 20),
    document_count: sanitizeNumber(documentCount || summary.yuklenenDefterSayisi),
    row_count: sanitizeNumber(summary.toplamSatir || rows.length),
    opening_balance_summary: opening,
    closing_balance_summary: closing,
    reconciliation_status: reconciliationStatus,
    reconciliation_summary: reconciliationSummary,
    severity_counts: severityCounts,
    result_summary: sanitizeJsonObject({
      overall_sonuc: sanitizeString(summary.overallSonuc, 64),
      edefter_uygun: Boolean(summary.edefterUygun),
      can_approve_export: Boolean(summary.canApproveExport),
      yuklenen_defter: sanitizeNumber(summary.yuklenenDefterSayisi),
      retry: Boolean(retry),
    }),
    started_at: startedAt || null,
    completed_at: completedAt || new Date().toISOString(),
    findings: [...aggregated.values()].slice(0, 500),
    retry: Boolean(retry),
  };
}

export function assertNoRawDocumentLeak(payload = {}) {
  const serialized = JSON.stringify(payload || {});
  const forbidden = [
    /<\?xml/i,
    /<!DOCTYPE/i,
    /PK\u0003\u0004/,
    /JournalEntries/i,
    /GeneralLedgerEntries/i,
    /SUPABASE_SERVICE_ROLE/i,
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  ];
  for (const re of forbidden) {
    if (re.test(serialized)) {
      const err = new Error("Ham belge veya gizli veri kalıcı kayda yazılamaz.");
      err.code = "RAW_PAYLOAD_FORBIDDEN";
      throw err;
    }
  }
  return true;
}

export function publicEdefterRunView(row = {}) {
  if (!row) return null;
  return {
    id: row.id,
    company_id: row.company_id,
    period: row.period,
    status: row.status,
    engine_version: row.engine_version,
    source_fingerprint: row.source_fingerprint,
    journal_fingerprint: row.journal_fingerprint,
    ledger_fingerprint: row.ledger_fingerprint,
    document_types: row.document_types,
    document_count: row.document_count,
    row_count: row.row_count,
    opening_balance_summary: row.opening_balance_summary,
    closing_balance_summary: row.closing_balance_summary,
    reconciliation_status: row.reconciliation_status,
    reconciliation_summary: row.reconciliation_summary,
    severity_counts: row.severity_counts,
    result_summary: row.result_summary,
    revision: row.revision,
    supersedes_run_id: row.supersedes_run_id,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    idempotent: Boolean(row.idempotent),
  };
}

export function publicEdefterFindingView(row = {}) {
  if (!row) return null;
  return {
    id: row.id,
    run_id: row.run_id,
    company_id: row.company_id,
    code: row.code,
    severity: row.severity,
    category: row.category,
    safe_reference: row.safe_reference,
    summary: row.summary,
    occurrence_count: row.occurrence_count,
    resolution_status: row.resolution_status,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
  };
}
