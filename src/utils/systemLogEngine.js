import {
  N8N_AUTOMATION_ERRORS_STORAGE_KEY,
  N8N_AUTOMATION_LOGS_STORAGE_KEY,
} from "@/src/config/n8nOtomasyonDefaults";
import { AI_OFIS_HISTORY_STORAGE_KEY } from "@/src/config/aiOfisAsistaniDefaults";

export const SYSTEM_LOG_STORAGE_KEY = "annvero_system_logs_v1";

const LOG_LEVELS = ["info", "warning", "error", "critical"];

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function appendSystemLog(entry = {}) {
  if (typeof window === "undefined") return null;
  const logs = safeParseJson(localStorage.getItem(SYSTEM_LOG_STORAGE_KEY) || "[]", []);
  const record = {
    id: `syslog-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    level: entry.level || "info",
    module: entry.module || "Sistem",
    companyId: entry.companyId || "",
    companyName: entry.companyName || "",
    message: entry.message || "",
    detail: entry.detail || "",
    source: entry.source || "app",
    durationMs: entry.durationMs || 0,
    ...entry,
  };
  const next = [record, ...logs].slice(0, 2000);
  localStorage.setItem(SYSTEM_LOG_STORAGE_KEY, JSON.stringify(next));
  return record;
}

export function loadSystemLogs() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(SYSTEM_LOG_STORAGE_KEY) || "[]", []);
}

export function collectAggregatedSystemLogs() {
  const systemLogs = loadSystemLogs();

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
    message: item.message || item.action,
    detail: item.flowId || "",
    source: "otomasyon",
    durationMs: item.durationMs || 0,
    userId: item.userId || "sistem",
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
    source: "otomasyon",
  }));

  const aiHistory = safeParseJson(
    localStorage.getItem(AI_OFIS_HISTORY_STORAGE_KEY) || "[]",
    []
  ).map((item) => ({
    id: `ai-${item.id}`,
    createdAt: item.createdAt,
    level: "info",
    module: "AI Ofis Asistanı",
    message: item.message || item.action,
    source: "ai-ofis",
  }));

  return [...systemLogs, ...automationLogs, ...automationErrors, ...aiHistory].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );
}

export function filterSystemLogs(
  logs = [],
  { module = "", companyId = "", level = "", dateFrom = "", dateTo = "", search = "" } = {}
) {
  return logs.filter((log) => {
    if (module && module !== "Tümü" && log.module !== module) return false;
    if (companyId && log.companyId !== companyId) return false;
    if (level && level !== "Tümü" && log.level !== level) return false;
    const date = String(log.createdAt || "").slice(0, 10);
    if (dateFrom && date && date < dateFrom) return false;
    if (dateTo && date && date > dateTo) return false;
    if (search.trim()) {
      const haystack = `${log.message} ${log.detail} ${log.module}`.toLowerCase();
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
    parserErrors: logs.filter((log) => /parser/i.test(log.message)).length,
    xmlErrors: logs.filter((log) => /xml|zip|edefter/i.test(log.message)).length,
    retryCount: logs.filter((log) => /retry/i.test(log.message)).length,
  };
}

export function logParserError(message, detail = {}, companyId = "") {
  return appendSystemLog({
    level: "error",
    module: "Banka Parser",
    message,
    detail: typeof detail === "string" ? detail : JSON.stringify(detail),
    companyId,
    source: "parser",
  });
}

export const SYSTEM_LOG_LEVELS = ["Tümü", ...LOG_LEVELS];
