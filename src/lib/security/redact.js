/**
 * Log ve response redaksiyon yardımcıları.
 * Export: hassas alanlar nesneden tamamen çıkarılır (maskeleme değil).
 * Operational log: allowlist dışı alanlar drop edilir (fail-closed).
 */

const SENSITIVE_KEY_PATTERN =
  /(password|parola|passwd|sifre|şifre|secret|token|authorization|api[_-]?key|service[_-]?role|cookie|set-cookie|encrypted_?(value|password|parola)?|private[_-]?key|credential|session|gib_password|sgk_password|access_token|refresh_token|id_token)/i;

/** Finansal / kimlik PII — operational allowlist dışı; redactDeep bunları maskelemez (audit/export uyumu). */
const FINANCIAL_PII_KEY_PATTERN =
  /(description|aciklama|açıklama|iban|vkn|tckn|hesap|account|amount|tutar|borc|borç|alacak|bakiye|balance|rows|payload|raw[_-]?row|raw[_-]?description|company[_-]?id|company[_-]?name|user[_-]?id|auth[_-]?user|run[_-]?id|source[_-]?id|file[_-]?name|filename|stack|cause|message|errorMessage|errorStack)/i;

const SENSITIVE_VALUE_PATTERN =
  /\b(sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,})\b/gi;

export const REDACTED = "[REDACTED]";

export const EXPORT_SECRET_FIELD_NAMES = Object.freeze([
  "encrypted_password",
  "encrypted_parola",
  "encrypted_value",
  "password",
  "parola",
  "sifre",
  "şifre",
  "gib_password",
  "sgk_password",
  "access_token",
  "refresh_token",
  "id_token",
  "token",
  "secret",
  "api_key",
  "service_role",
  "service_role_key",
  "authorization",
  "cookie",
  "set-cookie",
]);

/** Operational detail / worker / parser kod allowlist. */
export const SAFE_OPERATIONAL_CODES = Object.freeze(
  new Set([
    "SAFE_ERROR",
    "UNEXPECTED_ERROR",
    "ABORTED",
    "WORKER_ONERROR",
    "WORKER_CONSTRUCT_FAILED",
    "WORKER_UNAVAILABLE",
    "WORKER_MESSAGE_ERROR",
    "WORKER_POSTMESSAGE_FAILED",
    "WORKER_SCRIPT_HTML",
    "WORKER_SCRIPT_INVALID",
    "WORKER_SCRIPT_FETCH_FAILED",
    "WORKER_CLONE_FAILED",
    "WORKER_DUPLICATE_REQUEST",
    "WORKER_CANCELLED",
    "WORKER_STALE",
    "WORKER_TIMEOUT",
    "WORKER_PARSE_FAILED",
    "WORKER_PROTOCOL_ERROR",
    "WORKER_FAILED",
    "FIS_KONTROL_CANCELLED",
    "FIS_KONTROL_STALE",
    "FIS_KONTROL_TIMEOUT",
    "FIS_KONTROL_ANALYZE_FAILED",
    "FIS_KONTROL_WORKER_EMPTY",
    "FIS_KONTROL_WORKER_SCHEMA",
    "FIS_KONTROL_IN_FLIGHT",
    "FIS_KONTROL_REQUEST_ID_MISMATCH",
    "FIS_KONTROL_RISK_SUMMARY",
    "LEARNING_MEMORY_FETCH_FAILED",
    "LEARNING_MEMORY_CREATE_FAILED",
    "LEARNING_MEMORY_UPDATE_FAILED",
    "LEARNING_MEMORY_DELETE_FAILED",
    "LEARNING_MEMORY_USAGE_FAILED",
    "LEARNING_MEMORY_SCHEMA",
    "BANK_ROW_MAP_FAILED",
    "PARSER_CANCELLED",
    "PARSER_TIMEOUT",
    "PARSER_FAILED",
    "CORRUPT_XML",
    "CORRUPT_EXCEL",
    "ERROR",
    // e-Defter / Genel Muhasebe analyze bridge routing codes
    "ANALYZE_WORKER_EMPTY",
    "ANALYZE_WORKER_SCHEMA",
    "ANALYZE_WORKER_FAILED",
    "ANALYZE_REQUEST_ID_MISMATCH",
    "ANALYZE_REQUEST_ID_MISSING",
    "ANALYZE_PROTOCOL_MISMATCH",
    "ANALYZE_PAYLOAD_MISSING",
    "ANALYZE_TIMEOUT",
    "ANALYZE_IN_FLIGHT",
    "ANALYZE_STALE",
    "ANALYZE_CANCELLED",
  ])
);

const SAFE_DETAIL_KEYS = Object.freeze(
  new Set([
    "code",
    "stage",
    "module",
    "errorType",
    "jobType",
    "reason",
    "source",
    "hataCount",
    "issueCount",
    "rowCount",
    "uyariCount",
    "count",
    "grouped",
    "workerFallback",
    "fallbackReasonCode",
    "durationMs",
    "durationBucket",
    "generation",
    "requestId",
    "issueType",
    "issueTypes",
  ])
);

const SAFE_STAGES = Object.freeze(
  new Set([
    "ANALYZING",
    "HYDRATE",
    "EXPORT",
    "LEARN",
    "TRANSFER",
    "PARSER",
    "WORKER",
    "FALLBACK",
    "IDLE",
  ])
);

const SAFE_UI_MESSAGES = Object.freeze({
  WORKER_ONERROR: "Arka plan işçisi yüklenemedi. Ana işlem yolu denenecek.",
  WORKER_UNAVAILABLE: "Arka plan işçisi kullanılamıyor. Ana işlem yolu denenecek.",
  WORKER_TIMEOUT: "İşlem zaman aşımına uğradı. Lütfen tekrar deneyin.",
  WORKER_CANCELLED: "İşlem iptal edildi.",
  WORKER_STALE: "İşlem güncellendi; önceki sonuç yok sayıldı.",
  WORKER_PARSE_FAILED: "Analiz tamamlanamadı. Lütfen tekrar deneyin.",
  WORKER_PROTOCOL_ERROR: "Analiz tamamlanamadı. Lütfen tekrar deneyin.",
  WORKER_FAILED: "Analiz tamamlanamadı. Lütfen tekrar deneyin.",
  FIS_KONTROL_CANCELLED: "Fiş kontrolü iptal edildi.",
  FIS_KONTROL_STALE: "Fiş kontrolü güncellendi; önceki sonuç yok sayıldı.",
  FIS_KONTROL_TIMEOUT: "Fiş kontrolü zaman aşımına uğradı. Lütfen tekrar deneyin.",
  FIS_KONTROL_ANALYZE_FAILED: "Fiş kontrolü tamamlanamadı. Lütfen tekrar deneyin.",
  PARSER_TIMEOUT: "İşlem zaman aşımına uğradı. Lütfen tekrar deneyin.",
  PARSER_CANCELLED: "İşlem iptal edildi.",
  PARSER_FAILED: "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
  CORRUPT_XML: "Dosya okunamadı. Geçerli bir XML/ZIP yükleyin.",
  CORRUPT_EXCEL: "Dosya okunamadı. Geçerli bir Excel yükleyin.",
  LEARNING_MEMORY_SCHEMA: "Öğrenen hafıza şeması güncel değil.",
  UNEXPECTED_ERROR: "İşlem başarısız.",
  SAFE_ERROR: "İşlem başarısız.",
  BANK_ROW_MAP_FAILED: "Bazı satırlar eşleştirilemedi.",
});

export function isSensitiveKey(key = "") {
  const k = String(key || "");
  if (SENSITIVE_KEY_PATTERN.test(k)) return true;
  return EXPORT_SECRET_FIELD_NAMES.some((n) => n.toLowerCase() === k.toLowerCase());
}

export function isFinancialPiiKey(key = "") {
  return FINANCIAL_PII_KEY_PATTERN.test(String(key || ""));
}

export function redactString(value = "", { maxLength = 500 } = {}) {
  let text = String(value ?? "");
  if (!text) return "";
  text = text.replace(SENSITIVE_VALUE_PATTERN, REDACTED);
  if (text.length > maxLength) {
    return `${text.slice(0, maxLength)}…`;
  }
  return text;
}

function redactDeepInner(value, depth, maxDepth, seen) {
  if (value == null) return value;
  if (depth > maxDepth) return "[TRUNCATED]";

  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value
      .slice(0, 50)
      .map((item) => redactDeepInner(item, depth + 1, maxDepth, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out = {};
    // Error ve benzeri: yalnız enumerable own keys (base ile aynı semantik).
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactDeepInner(child, depth + 1, maxDepth, seen);
    }
    return out;
  }

  return String(value);
}

/**
 * Secret/JWT redaksiyonu — audit/export/state serialization için.
 * Finansal PII burada maskelenmez; operational sink için toSafeOperationalDetail kullanın.
 */
export function redactDeep(value, { depth = 0, maxDepth = 6 } = {}) {
  try {
    return redactDeepInner(value, depth, maxDepth, new WeakSet());
  } catch {
    // Base: throw; fail-closed boş obje yerine güvenli truncation
    return "[TRUNCATED]";
  }
}

/**
 * Export satırı: hassas anahtarları tamamen çıkarır (değer bırakmaz).
 * Nested objelerde de aynı kural uygulanır.
 */
export function stripSecretsFromExportValue(value, { depth = 0, maxDepth = 8 } = {}) {
  if (value == null) return value;
  if (depth > maxDepth) return undefined;

  if (Array.isArray(value)) {
    return value
      .map((item) => stripSecretsFromExportValue(item, { depth: depth + 1, maxDepth }))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        out[`${key}_was_present`] = child != null && child !== "";
        continue;
      }
      const cleaned = stripSecretsFromExportValue(child, { depth: depth + 1, maxDepth });
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }

  if (typeof value === "string" && SENSITIVE_VALUE_PATTERN.test(value)) {
    return undefined;
  }

  return value;
}

/** @deprecated maskeleme yerine strip kullanın — geriye uyumluluk */
export function redactExportRow(row = {}) {
  return stripSecretsFromExportValue(row) || {};
}

export function redactExportRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => stripSecretsFromExportValue(row) || {});
}

/**
 * CSV/Excel formula injection: hücre =+@- ile başlıyorsa önüne ' koy.
 */
export function sanitizeSpreadsheetCell(value) {
  if (value == null) return "";
  const text = String(value);
  if (/^[=+\-@]/.test(text)) {
    return `'${text}`;
  }
  return text;
}

export function isSafeOperationalCode(code = "") {
  const c = String(code || "").trim();
  return Boolean(c) && SAFE_OPERATIONAL_CODES.has(c);
}

/** Worker/bridge routing: allowlist veya iyi biçimli UPPER_SNAKE kod; ham metin değil. */
export function resolveWorkerProtocolCode(rawCode = "", fallback = "WORKER_PARSE_FAILED") {
  const code = String(rawCode || "").trim();
  if (!code) return fallback;
  if (isSafeOperationalCode(code)) return code;
  if (/^[A-Z][A-Z0-9_]{1,64}$/.test(code)) return code;
  return fallback;
}

export function resolveSafeErrorCode(error = null, fallback = "UNEXPECTED_ERROR") {
  if (!error) return fallback;
  if (error?.name === "AbortError") return "ABORTED";
  const raw = String(error?.code || "").trim();
  if (isSafeOperationalCode(raw)) return raw;
  const name = String(error?.name || "").trim().toUpperCase();
  if (name === "ABORTERROR") return "ABORTED";
  return fallback;
}

export function safeUiMessageForCode(code = "", fallback = "İşlem başarısız.") {
  const resolved = isSafeOperationalCode(code) ? code : "UNEXPECTED_ERROR";
  return SAFE_UI_MESSAGES[resolved] || fallback;
}

function sanitizeAllowlistedScalar(key, value) {
  if (value == null) return undefined;
  if (typeof value === "boolean") {
    if (key === "grouped" || key === "workerFallback" || key === "retryable") {
      return value;
    }
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (!Number.isInteger(value)) return Math.round(value);
    return value;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    if (key === "code" || key === "fallbackReasonCode" || key === "issueType") {
      return isSafeOperationalCode(text) ? text : undefined;
    }
    if (key === "stage") {
      const stage = text.toUpperCase();
      return SAFE_STAGES.has(stage) ? stage : undefined;
    }
    if (key === "module" || key === "errorType" || key === "jobType" || key === "reason" || key === "source") {
      if (text.length > 64) return undefined;
      if (!/^[A-Za-z0-9._:\- ]+$/.test(text)) return undefined;
      return text.slice(0, 64);
    }
    if (key === "requestId" || key === "generation") {
      if (text.length > 80) return undefined;
      if (!/^[A-Za-z0-9._:\-]+$/.test(text)) return undefined;
      return text.slice(0, 80);
    }
    if (key === "durationBucket") {
      if (!/^[0-9]+ms|[0-9]+s$/.test(text)) return undefined;
      return text;
    }
    return undefined;
  }
  if (key === "issueTypes" && Array.isArray(value)) {
    return value
      .slice(0, 8)
      .map((item) => String(item || "").trim())
      .filter((item) => /^[A-Z][A-Z0-9_]{1,48}$/.test(item));
  }
  return undefined;
}

/**
 * Fail-closed operational detail — yalnız allowlist alanlar.
 * Redaksiyon hatasında ham payload yazılmaz.
 */
export function toSafeOperationalDetail(value) {
  try {
    if (value == null || value === "") return "";
    if (typeof value === "string") {
      const text = value.trim();
      if (isSafeOperationalCode(text)) return { code: text };
      return { code: "UNEXPECTED_ERROR" };
    }
    if (value instanceof Error) {
      return { code: resolveSafeErrorCode(value) };
    }
    if (typeof value !== "object") {
      return { code: "UNEXPECTED_ERROR" };
    }
    const out = {};
    for (const key of Object.keys(value)) {
      if (!SAFE_DETAIL_KEYS.has(key)) continue;
      const cleaned = sanitizeAllowlistedScalar(key, value[key]);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    if (!out.code) out.code = "UNEXPECTED_ERROR";
    else if (!isSafeOperationalCode(out.code)) out.code = "UNEXPECTED_ERROR";
    return out;
  } catch {
    return { code: "UNEXPECTED_ERROR" };
  }
}

/** Browser/server console — ham Error/object yazılmaz. */
export function safeConsoleError(label = "error", error = null, extra = null) {
  const payload = {
    code: resolveSafeErrorCode(error),
  };
  if (extra && typeof extra === "object") {
    const safeExtra = toSafeOperationalDetail(extra);
    if (safeExtra && typeof safeExtra === "object") {
      Object.assign(payload, safeExtra);
    }
  }
  console.error(String(label || "error"), payload);
}

export function safeConsoleWarn(label = "warn", extra = null) {
  const payload =
    extra && typeof extra === "object"
      ? toSafeOperationalDetail(extra)
      : { code: "UNEXPECTED_ERROR" };
  console.warn(String(label || "warn"), payload);
}

export function safeErrorMessage(error, fallback = "İşlem başarısız.") {
  if (!error) return fallback;
  const code = resolveSafeErrorCode(error, "");
  if (code && SAFE_UI_MESSAGES[code]) return SAFE_UI_MESSAGES[code];
  const message = redactString(error?.message || String(error), { maxLength: 240 });
  if (!message) return fallback;
  if (
    /stack|supabase|postgres|password|secret|token|eyJ|sb_secret_|iban|vkn|tckn|açıklama|aciklama/i.test(
      message
    )
  ) {
    return fallback;
  }
  return message;
}

export function safeJsonError(error, fallback = "İşlem başarısız.", status = 500) {
  const code = resolveSafeErrorCode(error, "SAFE_ERROR");
  return {
    body: {
      error: safeErrorMessage(error, fallback),
      code: isSafeOperationalCode(code) ? code : "SAFE_ERROR",
    },
    status,
  };
}
