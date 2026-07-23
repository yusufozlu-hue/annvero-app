/**
 * Log ve response redaksiyon yardımcıları.
 * Export: hassas alanlar nesneden tamamen çıkarılır (maskeleme değil).
 */

const SENSITIVE_KEY_PATTERN =
  /(password|parola|passwd|sifre|şifre|secret|token|authorization|api[_-]?key|service[_-]?role|cookie|set-cookie|encrypted_?(value|password|parola)?|private[_-]?key|credential|session|gib_password|sgk_password|access_token|refresh_token|id_token)/i;

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

export function isSensitiveKey(key = "") {
  const k = String(key || "");
  if (SENSITIVE_KEY_PATTERN.test(k)) return true;
  return EXPORT_SECRET_FIELD_NAMES.some((n) => n.toLowerCase() === k.toLowerCase());
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

export function redactDeep(value, { depth = 0, maxDepth = 6 } = {}) {
  if (value == null) return value;
  if (depth > maxDepth) return "[TRUNCATED]";

  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactDeep(item, { depth: depth + 1, maxDepth }));
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactDeep(child, { depth: depth + 1, maxDepth });
    }
    return out;
  }

  return String(value);
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

export function safeErrorMessage(error, fallback = "İşlem başarısız.") {
  if (!error) return fallback;
  const message = redactString(error?.message || String(error), { maxLength: 240 });
  if (!message) return fallback;
  if (/stack|supabase|postgres|password|secret|token|eyJ|sb_secret_/i.test(message)) {
    return fallback;
  }
  return message;
}

export function safeJsonError(error, fallback = "İşlem başarısız.", status = 500) {
  return {
    body: { error: safeErrorMessage(error, fallback), code: "SAFE_ERROR" },
    status,
  };
}
