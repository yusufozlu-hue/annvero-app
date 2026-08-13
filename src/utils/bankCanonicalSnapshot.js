/**
 * Banka ekstresi — canonical hareket snapshot (PDF/Excel ortak).
 * Ham PDF/XLS baytı, base64, Drive file ID, token YASAK.
 * localStorage'a ham belge yazılmaz; yalnız sunucu + RLS.
 */

import { BANK_PARSER_VERSION } from "@/src/utils/bankCanonicalTransaction";

export const BANK_CANONICAL_SCHEMA_VERSION = BANK_PARSER_VERSION;

export const BANK_SNAPSHOT_SOURCE_TYPES = Object.freeze({
  PDF: "pdf",
  EXCEL: "excel",
  CSV: "csv",
  UNKNOWN: "unknown",
});

const FORBIDDEN_KEY_RE =
  /xml|zip|token|secret|password|raw|base64|arraybuffer|drive.?file|file.?id|access_token|refresh_token|cookie|payload|document.?bytes|uint8/i;

function sanitizeText(value, max = 480) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\bTR\d{2}\s?\d{4}[\d\s]{10,}\b/gi, "TR**")
    .trim()
    .slice(0, max);
}

function sanitizeNumber(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeNullableNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function empty(value) {
  return value == null ? "" : String(value).trim();
}

export function assertNoRawBankSnapshotLeak(payload) {
  const text = JSON.stringify(payload || {});
  const hits = [];
  if (/"fileId"|"file_id"|"access_token"|"refresh_token"/i.test(text)) {
    hits.push("token_or_file_id");
  }
  if (/data:application\/|base64,/i.test(text)) hits.push("binary_payload");
  if (/"uint8Bytes"|"arrayBuffer"|"rawPdf"|"pdfBytes"/i.test(text)) {
    hits.push("raw_bytes");
  }
  if (hits.length) {
    const err = new Error(
      `Canonical snapshot sızıntı riski: ${hits.join(",")}`
    );
    err.code = "BANK_SNAPSHOT_RAW_LEAK";
    throw err;
  }
  return true;
}

export function detectSnapshotSourceType({
  fileName = "",
  mimeType = "",
  sourceType = "",
} = {}) {
  const explicit = empty(sourceType).toLowerCase();
  if (
    explicit === "pdf" ||
    explicit === "excel" ||
    explicit === "csv" ||
    explicit === "unknown"
  ) {
    return explicit;
  }
  const name = empty(fileName).toLowerCase();
  const mime = empty(mimeType).toLowerCase();
  if (name.endsWith(".pdf") || mime.includes("pdf")) {
    return BANK_SNAPSHOT_SOURCE_TYPES.PDF;
  }
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    mime.includes("spreadsheet") ||
    mime.includes("excel")
  ) {
    return BANK_SNAPSHOT_SOURCE_TYPES.EXCEL;
  }
  if (name.endsWith(".csv") || mime.includes("csv")) {
    return BANK_SNAPSHOT_SOURCE_TYPES.CSV;
  }
  return BANK_SNAPSHOT_SOURCE_TYPES.UNKNOWN;
}

/**
 * UI/parser hareket satırı → kalıcı canonical satır (istemci + API ortak).
 */
export function movementRowToSnapshotMovement(row = {}, index = 0) {
  const debit = sanitizeNumber(
    row.borc ?? row.debit ?? (row.direction === "GIRIS" ? row.amount : 0)
  );
  const credit = sanitizeNumber(
    row.alacak ?? row.credit ?? (row.direction === "CIKIS" ? Math.abs(row.amount || 0) : 0)
  );
  const amountAbs = Math.abs(
    sanitizeNumber(row.amount ?? row.tutar ?? (debit || credit))
  );
  const direction = empty(row.direction || row.yon).toUpperCase();
  const sourceMovementId =
    empty(
      row.sourceMovementId ||
        row.sourceRowId ||
        row.id ||
        row.transactionId ||
        row._movementId
    ) || `mov-${index + 1}`;

  return {
    sourceMovementId,
    sortIndex: Math.max(0, Number(row.sortIndex ?? index) || index),
    transactionDate: sanitizeText(
      row.date || row.tarih || row.transactionDate || "",
      40
    ),
    valueDate: sanitizeText(
      row.valueDate || row.valor || row.date || row.tarih || "",
      40
    ),
    description: sanitizeText(row.description || row.aciklama || "", 800),
    amount: direction === "CIKIS" ? -amountAbs : amountAbs,
    debit: debit > 0 ? debit : direction === "GIRIS" ? amountAbs : 0,
    credit: credit > 0 ? credit : direction === "CIKIS" ? amountAbs : 0,
    balance: sanitizeNullableNumber(
      row.balance ??
        row.bakiye ??
        row.rawRow?.balance ??
        row.rawRow?.bakiye
    ),
    currency: sanitizeText(row.currency || "TRY", 8).toUpperCase() || "TRY",
    direction:
      direction === "CIKIS" ||
      direction === "GIRIS" ||
      direction === "BORC" ||
      direction === "ALACAK"
        ? direction
        : "",
    movementType: sanitizeText(
      row.transactionType || row.movementType || row.documentType || "",
      80
    ),
    classification: sanitizeText(row.classification || "", 80),
    sourcePage: sanitizeNullableNumber(row.sourcePage ?? row.page),
    sourceRow: sanitizeNullableNumber(
      row.sourceRow ?? row.excelRowNumber ?? row.source_row
    ),
    sourceSheet: sanitizeText(row.sourceSheet || row.sheetName || "", 80),
    confidence: sanitizeNullableNumber(
      row.confidence ?? row.ocrConfidence ?? row.cariMatchConfidence
    ),
    lowConfidence: Boolean(row.lowConfidence || row.lowOcrConfidence),
    reviewRequired: Boolean(row.reviewRequired || row.accountPlanMissing),
    status: sanitizeText(row.status || "ok", 32) || "ok",
    schemaVersion: sanitizeText(
      row.schemaVersion || row.parserVersion || BANK_CANONICAL_SCHEMA_VERSION,
      40
    ),
    safeExtra: {
      bankName: sanitizeText(row.bankName || row.banka || "", 64),
      documentType: sanitizeText(row.documentType || "", 40),
      accountingScenario: sanitizeText(row.accountingScenario || "", 64),
    },
  };
}

export function buildSnapshotMovementsFromRows(rows = []) {
  return (rows || []).map((row, index) =>
    movementRowToSnapshotMovement(row, index)
  );
}

/**
 * Persist edilmiş hareket → workbench legacy movement (yeniden analiz girişi).
 */
export function snapshotMovementToLegacyRow(row = {}) {
  const direction = empty(row.direction || row.yon).toUpperCase();
  const amountAbs = Math.abs(
    sanitizeNumber(row.amount ?? row.debit ?? row.credit)
  );
  const isIn = direction !== "CIKIS" && direction !== "ALACAK";
  const sourceMovementId = empty(
    row.sourceMovementId || row.source_movement_id || row.id
  );
  const extra =
    row.safeExtra && typeof row.safeExtra === "object"
      ? row.safeExtra
      : row.safe_extra && typeof row.safe_extra === "object"
        ? row.safe_extra
        : {};

  const legacy = {
    id: sourceMovementId,
    sourceRowId: sourceMovementId,
    sourceMovementId,
    date: empty(row.transactionDate || row.transaction_date || row.date),
    description: empty(row.description || row.aciklama),
    amount: isIn ? amountAbs : -amountAbs,
    direction: direction || (isIn ? "GIRIS" : "CIKIS"),
    bankName: empty(extra.bankName || row.bankName || ""),
    borc: sanitizeNumber(row.debit ?? (isIn ? amountAbs : 0)),
    alacak: sanitizeNumber(row.credit ?? (isIn ? 0 : amountAbs)),
    bakiye: sanitizeNullableNumber(row.balance ?? row.bakiye),
    balance: sanitizeNullableNumber(row.balance ?? row.bakiye),
    currency: empty(row.currency) || "TRY",
    excelRowNumber: sanitizeNullableNumber(row.sourceRow ?? row.source_row),
    sourcePage: sanitizeNullableNumber(row.sourcePage ?? row.source_page),
    sheetName: empty(row.sourceSheet || row.source_sheet),
    transactionType: empty(row.movementType || row.movement_type),
    classification: empty(row.classification),
    confidence: sanitizeNullableNumber(row.confidence),
    lowConfidence: Boolean(row.lowConfidence ?? row.low_confidence),
    reviewRequired: Boolean(row.reviewRequired ?? row.review_required),
    status: empty(row.status) || "ok",
    documentType: empty(extra.documentType),
    accountingScenario: empty(extra.accountingScenario),
    fromCanonicalSnapshot: true,
  };
  // Dosyasız muhasebe analizi için rawRow — sourceMovementId korunur
  legacy.rawRow = {
    ...legacy,
    aciklama: legacy.description,
    tutar: amountAbs,
    yon: legacy.direction,
    tarih: legacy.date,
  };
  return legacy;
}

export function snapshotMovementsToLegacyRows(rows = []) {
  return (rows || []).map(snapshotMovementToLegacyRow);
}

export function publicBankSnapshotSourceView(row = {}) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id || row.companyId,
    contentHash: sanitizeText(row.content_hash || row.contentHash || "", 128),
    fileName: sanitizeText(row.file_name || row.fileName || "", 240),
    mimeType: sanitizeText(row.mime_type || row.mimeType || "", 120),
    byteLength: Math.max(0, Number(row.byte_length ?? row.byteLength) || 0),
    detectedBank: sanitizeText(
      row.detected_bank || row.detectedBank || "",
      64
    ),
    sourceType: detectSnapshotSourceType({
      sourceType: row.source_type || row.sourceType,
      fileName: row.file_name || row.fileName,
      mimeType: row.mime_type || row.mimeType,
    }),
    schemaVersion: sanitizeText(
      row.schema_version || row.schemaVersion || BANK_CANONICAL_SCHEMA_VERSION,
      40
    ),
    planContentFingerprint: sanitizeText(
      row.plan_content_fingerprint || row.planContentFingerprint || "",
      128
    ),
    planAccountCount: Math.max(
      0,
      Number(row.plan_account_count ?? row.planAccountCount) || 0
    ),
    movementCount: Math.max(
      0,
      Number(row.movement_count ?? row.movementCount) || 0
    ),
    status: sanitizeText(row.status || "active", 32),
    revision: Math.max(1, Number(row.revision) || 1),
    supersedesSourceId:
      row.supersedes_source_id || row.supersedesSourceId || null,
    v1AuditEntityId: sanitizeText(
      row.v1_audit_entity_id || row.v1AuditEntityId || "",
      80
    ),
    safeSummary:
      row.safe_summary && typeof row.safe_summary === "object"
        ? sanitizeSafeSummary(row.safe_summary)
        : row.safeSummary && typeof row.safeSummary === "object"
          ? sanitizeSafeSummary(row.safeSummary)
          : {},
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

export function publicBankSnapshotMovementView(row = {}) {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id || row.sourceId,
    companyId: row.company_id || row.companyId,
    sourceMovementId: sanitizeText(
      row.source_movement_id || row.sourceMovementId || "",
      120
    ),
    sortIndex: Math.max(0, Number(row.sort_index ?? row.sortIndex) || 0),
    transactionDate: sanitizeText(
      row.transaction_date || row.transactionDate || "",
      40
    ),
    valueDate: sanitizeText(row.value_date || row.valueDate || "", 40),
    description: sanitizeText(row.description || "", 800),
    amount: sanitizeNumber(row.amount),
    debit: sanitizeNumber(row.debit),
    credit: sanitizeNumber(row.credit),
    balance: sanitizeNullableNumber(row.balance),
    currency: sanitizeText(row.currency || "TRY", 8) || "TRY",
    direction: sanitizeText(row.direction || "", 16),
    movementType: sanitizeText(
      row.movement_type || row.movementType || "",
      80
    ),
    classification: sanitizeText(row.classification || "", 80),
    sourcePage: sanitizeNullableNumber(row.source_page ?? row.sourcePage),
    sourceRow: sanitizeNullableNumber(row.source_row ?? row.sourceRow),
    sourceSheet: sanitizeText(
      row.source_sheet || row.sourceSheet || "",
      80
    ),
    confidence: sanitizeNullableNumber(row.confidence),
    lowConfidence: Boolean(row.low_confidence ?? row.lowConfidence),
    reviewRequired: Boolean(row.review_required ?? row.reviewRequired),
    status: sanitizeText(row.status || "ok", 32),
    schemaVersion: sanitizeText(
      row.schema_version || row.schemaVersion || BANK_CANONICAL_SCHEMA_VERSION,
      40
    ),
    safeExtra:
      row.safe_extra && typeof row.safe_extra === "object"
        ? sanitizeSafeSummary(row.safe_extra)
        : row.safeExtra && typeof row.safeExtra === "object"
          ? sanitizeSafeSummary(row.safeExtra)
          : {},
  };
}

function sanitizeSafeSummary(value, depth = 0) {
  if (depth > 3) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (FORBIDDEN_KEY_RE.test(key)) continue;
    const safeKey = sanitizeText(key, 64);
    if (!safeKey) continue;
    if (typeof raw === "string") out[safeKey] = sanitizeText(raw, 240);
    else if (typeof raw === "number" && Number.isFinite(raw)) out[safeKey] = raw;
    else if (typeof raw === "boolean") out[safeKey] = raw;
    else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      out[safeKey] = sanitizeSafeSummary(raw, depth + 1);
    }
  }
  return out;
}

export function sanitizeIncomingSnapshotBody(body = {}) {
  // Ham sızıntı anahtarlarını önce düşür, sonra kalan gövdeyi doğrula
  const scrubbed = JSON.parse(
    JSON.stringify(body || {}, (key, value) => {
      if (FORBIDDEN_KEY_RE.test(String(key || ""))) return undefined;
      return value;
    })
  );
  assertNoRawBankSnapshotLeak(scrubbed);
  const movementsIn = Array.isArray(scrubbed.movements) ? scrubbed.movements : [];
  const sourceType = detectSnapshotSourceType({
    fileName: scrubbed.fileName || scrubbed.file_name,
    mimeType: scrubbed.mimeType || scrubbed.mime_type,
    sourceType: scrubbed.sourceType || scrubbed.source_type,
  });

  const source = {
    company_id: empty(scrubbed.companyId || scrubbed.company_id),
    content_hash: sanitizeText(
      scrubbed.contentHash || scrubbed.content_hash || "",
      128
    ),
    file_name: sanitizeText(scrubbed.fileName || scrubbed.file_name || "", 240),
    mime_type: sanitizeText(scrubbed.mimeType || scrubbed.mime_type || "", 120),
    byte_length: Math.max(
      0,
      Number(scrubbed.byteLength ?? scrubbed.byte_length) || 0
    ),
    detected_bank: sanitizeText(
      scrubbed.detectedBank || scrubbed.detected_bank || "",
      64
    ).toUpperCase(),
    source_type: sourceType,
    schema_version: sanitizeText(
      scrubbed.schemaVersion ||
        scrubbed.schema_version ||
        BANK_CANONICAL_SCHEMA_VERSION,
      40
    ),
    plan_content_fingerprint: sanitizeText(
      scrubbed.planContentFingerprint ||
        scrubbed.plan_content_fingerprint ||
        "",
      128
    ),
    plan_account_count: Math.max(
      0,
      Number(scrubbed.planAccountCount ?? scrubbed.plan_account_count) || 0
    ),
    movement_count: Math.max(0, movementsIn.length),
    status: "active",
    revision: Math.max(1, Number(scrubbed.revision) || 1),
    supersedes_source_id:
      scrubbed.supersedesSourceId || scrubbed.supersedes_source_id || null,
    v1_audit_entity_id: sanitizeText(
      scrubbed.v1AuditEntityId || scrubbed.v1_audit_entity_id || "",
      80
    ),
    safe_summary: sanitizeSafeSummary(
      scrubbed.safeSummary || scrubbed.safe_summary || {}
    ),
  };

  const movements = movementsIn.slice(0, 5000).map((item, index) => {
    const normalized = movementRowToSnapshotMovement(
      {
        ...item,
        sourceMovementId:
          item.sourceMovementId ||
          item.source_movement_id ||
          item.id,
        date: item.transactionDate || item.transaction_date || item.date,
        description: item.description,
        amount: item.amount,
        debit: item.debit,
        credit: item.credit,
        balance: item.balance,
        currency: item.currency,
        direction: item.direction,
        movementType: item.movementType || item.movement_type,
        classification: item.classification,
        sourcePage: item.sourcePage ?? item.source_page,
        sourceRow: item.sourceRow ?? item.source_row,
        sourceSheet: item.sourceSheet || item.source_sheet,
        confidence: item.confidence,
        lowConfidence: item.lowConfidence ?? item.low_confidence,
        reviewRequired: item.reviewRequired ?? item.review_required,
        status: item.status,
        schemaVersion: item.schemaVersion || item.schema_version,
        safeExtra: item.safeExtra || item.safe_extra,
      },
      index
    );
    return {
      source_movement_id: normalized.sourceMovementId,
      sort_index: normalized.sortIndex,
      transaction_date: normalized.transactionDate,
      value_date: normalized.valueDate,
      description: normalized.description,
      amount: normalized.amount,
      debit: normalized.debit,
      credit: normalized.credit,
      balance: normalized.balance,
      currency: normalized.currency,
      direction: normalized.direction,
      movement_type: normalized.movementType,
      classification: normalized.classification,
      source_page: normalized.sourcePage,
      source_row: normalized.sourceRow,
      source_sheet: normalized.sourceSheet,
      confidence: normalized.confidence,
      low_confidence: normalized.lowConfidence,
      review_required: normalized.reviewRequired,
      status: normalized.status,
      schema_version: normalized.schemaVersion,
      safe_extra: normalized.safeExtra,
    };
  });

  return {
    action: sanitizeText(scrubbed.action || "upsert", 32) || "upsert",
    sourceId: empty(scrubbed.sourceId || scrubbed.source_id),
    source,
    movements,
  };
}

/**
 * Dosyasız reanalysis için kaynak uygunluğu.
 */
export function canReanalyzeFromCanonicalSnapshot({
  source = null,
  movementCount = 0,
  movements = null,
} = {}) {
  if (!source || source.status === "deleted" || source.deleted_at) {
    return {
      ok: false,
      code: "SOURCE_UNAVAILABLE",
      message: "Kaynak snapshot yok veya silindi; dosyasız yeniden analiz yapılamaz.",
    };
  }
  const count =
    Number(movementCount) ||
    Number(source.movementCount || source.movement_count) ||
    (Array.isArray(movements) ? movements.length : 0);
  if (count <= 0) {
    return {
      ok: false,
      code: "NO_CANONICAL_MOVEMENTS",
      message:
        "Bu işte kalıcı canonical hareket yok. Eski kayıtlar backfill edilmez; bir kez dosya seçilerek yeni snapshot gerekir.",
    };
  }
  return { ok: true, movementCount: count };
}

/**
 * PDF / Excel parity — aynı şema alanları.
 */
export function assertPdfExcelSnapshotParity(pdfMovements = [], excelMovements = []) {
  const required = [
    "sourceMovementId",
    "transactionDate",
    "description",
    "amount",
    "debit",
    "credit",
    "currency",
    "direction",
    "schemaVersion",
  ];
  for (const row of [...pdfMovements, ...excelMovements]) {
    for (const key of required) {
      if (row[key] === undefined || row[key] === null) {
        throw new Error(`parity_missing_field:${key}`);
      }
    }
    if (!String(row.schemaVersion || "").startsWith("bank-canon")) {
      throw new Error("parity_schema_version");
    }
  }
  return true;
}
