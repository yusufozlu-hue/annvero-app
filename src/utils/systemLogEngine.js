import {
  N8N_AUTOMATION_ERRORS_STORAGE_KEY,
  N8N_AUTOMATION_LOGS_STORAGE_KEY,
} from "@/src/config/n8nOtomasyonDefaults";
import { AI_OFIS_HISTORY_STORAGE_KEY } from "@/src/config/aiOfisAsistaniDefaults";

export const SYSTEM_LOG_STORAGE_KEY = "annvero_system_logs_v1";
export const SYSTEM_LOG_DEDUPE_STORAGE_KEY = "annvero_system_log_dedupe_v1";

const LOG_LEVELS = ["info", "warning", "error", "critical"];
const LOG_STATUSES = ["open", "resolved"];
const DEFAULT_DEDUPE_WINDOW_MS = 60_000;
const DEFAULT_THROTTLE_MS = 5_000;
const MAX_GROUPED_COUNT = 9999;

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeDetail(detail) {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function buildLogRecord(entry = {}) {
  return {
    id: entry.id || `syslog-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: entry.createdAt || new Date().toISOString(),
    level: entry.level || "info",
    module: entry.module || "Sistem",
    companyId: entry.companyId || "",
    companyName: entry.companyName || "",
    fileName: entry.fileName || "",
    message: entry.message || "",
    detail: normalizeDetail(entry.detail),
    technicalDetail: normalizeDetail(entry.technicalDetail || entry.detail),
    suggestion: entry.suggestion || "",
    source: entry.source || "app",
    durationMs: entry.durationMs || 0,
    userId: entry.userId || "",
    errorType: entry.errorType || "",
    retryable: Boolean(entry.retryable),
    status: LOG_STATUSES.includes(entry.status) ? entry.status : "open",
    groupedCount: entry.groupedCount || 1,
    severityGroup: entry.severityGroup || entry.level || "info",
    lastOccurredAt: entry.lastOccurredAt || entry.createdAt || new Date().toISOString(),
    ...entry,
    detail: normalizeDetail(entry.detail),
    technicalDetail: normalizeDetail(entry.technicalDetail || entry.detail),
  };
}

function buildDedupeKey(entry = {}) {
  return [
    entry.module || "",
    entry.errorType || "",
    entry.message || "",
    entry.companyId || "",
    entry.fileName || "",
  ]
    .join("|")
    .toLowerCase();
}

function loadDedupeState() {
  if (typeof window === "undefined") return {};
  return safeParseJson(localStorage.getItem(SYSTEM_LOG_DEDUPE_STORAGE_KEY) || "{}", {});
}

function saveDedupeState(state = {}) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SYSTEM_LOG_DEDUPE_STORAGE_KEY, JSON.stringify(state));
}

function shouldThrottleOrGroup(entry = {}, options = {}) {
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const key = buildDedupeKey(entry);
  const now = Date.now();
  const state = loadDedupeState();
  const current = state[key];

  if (!current) {
    state[key] = { count: 1, firstAt: now, lastAt: now, logId: "" };
    saveDedupeState(state);
    return { action: "append", groupedCount: 1 };
  }

  if (now - current.lastAt < throttleMs) {
    current.count += 1;
    current.lastAt = now;
    state[key] = current;
    saveDedupeState(state);
    return { action: "skip", groupedCount: current.count };
  }

  if (now - current.firstAt <= dedupeWindowMs && current.logId) {
    current.count += 1;
    current.lastAt = now;
    state[key] = current;
    saveDedupeState(state);
    return { action: "group", groupedCount: current.count, logId: current.logId };
  }

  state[key] = { count: 1, firstAt: now, lastAt: now, logId: "" };
  saveDedupeState(state);
  return { action: "append", groupedCount: 1 };
}

function applyGroupedLogUpdate(logId, groupedCount, entry = {}) {
  if (!logId || typeof window === "undefined") return null;
  const logs = loadSystemLogs();
  const index = logs.findIndex((log) => log.id === logId);
  if (index < 0) return null;

  const countLabel = groupedCount > MAX_GROUPED_COUNT ? `${MAX_GROUPED_COUNT}+` : groupedCount;
  logs[index] = {
    ...logs[index],
    groupedCount,
    lastOccurredAt: new Date().toISOString(),
    message: `${entry.message} (${countLabel} kez)`,
    technicalDetail: normalizeDetail({
      grouped: true,
      count: groupedCount,
      sample: entry.technicalDetail || entry.detail,
    }),
  };
  localStorage.setItem(SYSTEM_LOG_STORAGE_KEY, JSON.stringify(logs));
  return logs[index];
}

export function appendSystemLog(entry = {}, options = {}) {
  if (typeof window === "undefined") return null;

  const dedupe = shouldThrottleOrGroup(entry, options);
  if (dedupe.action === "skip") {
    return { throttled: true, groupedCount: dedupe.groupedCount };
  }

  if (dedupe.action === "group" && dedupe.logId) {
    return applyGroupedLogUpdate(dedupe.logId, dedupe.groupedCount, entry);
  }

  const logs = safeParseJson(localStorage.getItem(SYSTEM_LOG_STORAGE_KEY) || "[]", []);
  const record = buildLogRecord({
    ...entry,
    groupedCount: dedupe.groupedCount || 1,
    severityGroup: entry.level || "info",
  });
  const next = [record, ...logs].slice(0, 2000);
  localStorage.setItem(SYSTEM_LOG_STORAGE_KEY, JSON.stringify(next));

  const state = loadDedupeState();
  const key = buildDedupeKey(entry);
  state[key] = {
    count: dedupe.groupedCount || 1,
    firstAt: Date.now(),
    lastAt: Date.now(),
    logId: record.id,
  };
  saveDedupeState(state);

  return record;
}

export function loadSystemLogs() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(SYSTEM_LOG_STORAGE_KEY) || "[]", []);
}

export function updateSystemLogStatus(logId, status = "resolved") {
  if (typeof window === "undefined" || !logId) return false;
  const logs = loadSystemLogs();
  const index = logs.findIndex((log) => log.id === logId);
  if (index < 0) return false;
  logs[index] = { ...logs[index], status, resolvedAt: new Date().toISOString() };
  localStorage.setItem(SYSTEM_LOG_STORAGE_KEY, JSON.stringify(logs));
  return true;
}

export function collectAggregatedSystemLogs() {
  const systemLogs = loadSystemLogs().map((item) => ({
    ...item,
    retryable: Boolean(item.retryable),
    status: item.status || "open",
  }));

  const automationLogs = safeParseJson(
    localStorage.getItem(N8N_AUTOMATION_LOGS_STORAGE_KEY) || "[]",
    []
  ).map((item) => ({
    id: `auto-${item.id}`,
    createdAt: item.createdAt,
    level: item.hasError ? "error" : "info",
    module: "Otomasyon Merkezi",
    companyId: item.companyId || "",
    companyName: item.companyName || "",
    fileName: item.fileName || "",
    message: item.message || item.action,
    detail: item.flowId || "",
    technicalDetail: item.errorMessage || "",
    suggestion: item.hasError ? "Akışı yeniden çalıştırın veya retry kullanın." : "",
    source: "otomasyon",
    durationMs: item.durationMs || 0,
    userId: item.userId || "sistem",
    errorType: item.hasError ? "automation_error" : "",
    retryable: Boolean(item.hasError),
    status: item.hasError ? "open" : "resolved",
  }));

  const automationErrors = safeParseJson(
    localStorage.getItem(N8N_AUTOMATION_ERRORS_STORAGE_KEY) || "[]",
    []
  ).map((item) => ({
    id: `auto-err-${item.id}`,
    createdAt: item.createdAt,
    level: "error",
    module: "Otomasyon Merkezi",
    message: item.message,
    detail: item.flowId,
    technicalDetail: item.stack || item.message,
    suggestion: "Retry ile yeniden deneyin.",
    source: "otomasyon",
    errorType: "automation_error",
    retryable: true,
    status: "open",
  }));

  const aiHistory = safeParseJson(
    localStorage.getItem(AI_OFIS_HISTORY_STORAGE_KEY) || "[]",
    []
  ).map((item) => ({
    id: `ai-${item.id}`,
    createdAt: item.createdAt,
    level: item.hasError ? "error" : "info",
    module: "AI Ofis Asistanı",
    message: item.message || item.action,
    fileName: item.fileName || "",
    detail: item.moduleTarget || "",
    technicalDetail: item.detail || "",
    suggestion: item.hasError ? "Dosyayı yeniden yükleyin veya manuel sınıflandırın." : "",
    source: "ai-ofis",
    errorType: item.errorType || "",
    retryable: Boolean(item.hasError),
    status: item.hasError ? "open" : "resolved",
  }));

  return [...systemLogs, ...automationLogs, ...automationErrors, ...aiHistory].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );
}

export function filterSystemLogs(
  logs = [],
  {
    module = "",
    companyId = "",
    level = "",
    status = "",
    dateFrom = "",
    dateTo = "",
    search = "",
  } = {}
) {
  return logs.filter((log) => {
    if (module && module !== "Tümü" && log.module !== module) return false;
    if (companyId && log.companyId !== companyId) return false;
    if (level && level !== "Tümü" && log.level !== level) return false;
    if (status && status !== "Tümü" && (log.status || "open") !== status) return false;
    const date = String(log.createdAt || "").slice(0, 10);
    if (dateFrom && date && date < dateFrom) return false;
    if (dateTo && date && date > dateTo) return false;
    if (search.trim()) {
      const haystack = `${log.message} ${log.detail} ${log.module} ${log.fileName} ${log.suggestion}`.toLowerCase();
      if (!haystack.includes(search.trim().toLowerCase())) return false;
    }
    return true;
  });
}

export function buildSystemLogStats(logs = []) {
  return {
    total: logs.length,
    errors: logs.filter((log) => log.level === "error" || log.level === "critical").length,
    warnings: logs.filter((log) => log.level === "warning").length,
    open: logs.filter((log) => (log.status || "open") === "open").length,
    parserErrors: logs.filter((log) => /parser|banka/i.test(`${log.module} ${log.message}`)).length,
    xmlErrors: logs.filter((log) => /xml|zip|edefter/i.test(`${log.message} ${log.module}`)).length,
    retryCount: logs.filter((log) => log.retryable || /retry/i.test(log.message)).length,
  };
}

export function logSystemError({
  module = "Sistem",
  message = "",
  level = "error",
  companyId = "",
  companyName = "",
  fileName = "",
  detail = "",
  technicalDetail = "",
  suggestion = "",
  source = "app",
  userId = "",
  errorType = "unexpected_error",
  retryable = false,
  durationMs = 0,
} = {}) {
  return appendSystemLog({
    level,
    module,
    message,
    companyId,
    companyName,
    fileName,
    detail,
    technicalDetail,
    suggestion,
    source,
    userId,
    errorType,
    retryable,
    durationMs,
    status: "open",
  });
}

export function logParserError(message, detail = {}, companyId = "", extra = {}) {
  return logSystemError({
    module: extra.module || "Banka Parser",
    message,
    detail,
    technicalDetail: detail,
    companyId,
    companyName: extra.companyName || "",
    fileName: extra.fileName || "",
    source: extra.source || "parser",
    userId: extra.userId || "",
    errorType: extra.errorType || "parser_error",
    suggestion:
      extra.suggestion ||
      "Dosya formatını, kolon başlıklarını ve banka seçimini kontrol edin.",
    retryable: extra.retryable ?? true,
    ...extra,
  });
}

export function logXmlError(message, detail = {}, companyId = "", extra = {}) {
  return logSystemError({
    module: extra.module || "XML / e-Defter",
    message,
    detail,
    technicalDetail: detail,
    companyId,
    companyName: extra.companyName || "",
    fileName: extra.fileName || "",
    source: extra.source || "xml",
    errorType: extra.errorType || "xml_error",
    suggestion:
      extra.suggestion || "XML/ZIP dosyasının geçerli e-defter formatında olduğunu doğrulayın.",
    retryable: extra.retryable ?? true,
    ...extra,
  });
}

export function logExcelError(message, detail = {}, companyId = "", extra = {}) {
  return logSystemError({
    module: extra.module || "Excel İşleme",
    message,
    detail,
    technicalDetail: detail,
    companyId,
    companyName: extra.companyName || "",
    fileName: extra.fileName || "",
    source: extra.source || "excel",
    errorType: extra.errorType || "excel_error",
    suggestion:
      extra.suggestion ||
      "Excel dosyasının bozuk olmadığını ve beklenen kolonları içerdiğini kontrol edin.",
    retryable: extra.retryable ?? true,
    ...extra,
  });
}

export const SYSTEM_LOG_LEVELS = ["Tümü", ...LOG_LEVELS];
export const SYSTEM_LOG_STATUSES = ["Tümü", ...LOG_STATUSES];

export const SYSTEM_ERROR_TYPES = {
  MISSING_COLUMN: "missing_column",
  INVALID_FILE_TYPE: "invalid_file_type",
  CORRUPT_EXCEL: "corrupt_excel",
  CORRUPT_XML: "corrupt_xml",
  EMPTY_DATA: "empty_data",
  INVALID_DATE: "invalid_date",
  INVALID_AMOUNT: "invalid_amount",
  ACCOUNT_MATCH: "account_match_error",
  TIMEOUT: "timeout",
  DUPLICATE: "duplicate_transaction",
  UNEXPECTED: "unexpected_error",
  AI_MATCH: "ai_match_error",
  LOW_CONFIDENCE: "low_confidence",
  COMPANY_NOT_FOUND: "company_not_found",
  TAHAKKUK_MISMATCH: "tahakkuk_mismatch",
  DUPLICATE_DOCUMENT: "duplicate_document",
  AI_OVERRIDE: "ai_override",
  LEARN_SUCCESS: "learn_success",
  LEARN_FAILED: "learn_failed",
  RISK_FLAG: "risk_flag",
};

export function logOperationalEvent({
  module = "Sistem",
  message = "",
  level = "info",
  companyId = "",
  companyName = "",
  fileName = "",
  userId = "",
  operationType = "",
  detail = "",
  technicalDetail = "",
  suggestion = "",
  source = "app",
  errorType = "",
  retryable = false,
} = {}) {
  return logSystemError({
    module,
    message,
    level,
    companyId,
    companyName,
    fileName,
    userId,
    detail,
    technicalDetail,
    suggestion,
    source,
    errorType,
    retryable,
    durationMs: 0,
  });
}
