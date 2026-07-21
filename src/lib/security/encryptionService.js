/**
 * Server-only şifreleme servis arayüzü.
 * Anahtar yoksa hassas veriyi düz metin kaydetmez (fail-closed).
 */

import "server-only";
import crypto from "crypto";
import { redactDeep } from "@/src/lib/security/redact";

const ALGORITHM = "aes-256-gcm";

function readEnv(name) {
  return String(process.env[name] ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function parseKey(raw) {
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) return utf8;
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
  } catch {
    // ignore
  }
  return null;
}

export function getFieldEncryptionKeyStatus(envName = "ANNVERO_FIELD_ENCRYPTION_KEY") {
  const raw = readEnv(envName);
  if (!raw) {
    return { configured: false, code: "missing", envName, message: `${envName} yapılandırılmamış.` };
  }
  const key = parseKey(raw);
  if (!key) {
    return {
      configured: false,
      code: "invalid_format",
      envName,
      message: `${envName} geçersiz. 32 bayt base64/utf8 veya 64 hex karakter olmalı.`,
    };
  }
  return { configured: true, key, envName };
}

/**
 * Genel amaçlı alan şifreleme. Anahtar yoksa throw (fail-closed).
 */
export function encryptField(plainText, { envName = "ANNVERO_FIELD_ENCRYPTION_KEY" } = {}) {
  const status = getFieldEncryptionKeyStatus(envName);
  if (!status.configured) {
    throw new Error(status.message);
  }

  const value = String(plainText ?? "");
  if (!value) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, status.key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptField(payload, { envName = "ANNVERO_FIELD_ENCRYPTION_KEY" } = {}) {
  const status = getFieldEncryptionKeyStatus(envName);
  if (!status.configured) {
    throw new Error(status.message);
  }

  const parts = String(payload || "").split(":");
  if (parts.length === 4 && parts[0] === "v1") {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(ALGORITHM, status.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  // legacy GİB format (iv:tag:data) — aynı anahtar alanı kullanılmaz; caller ayrı crypto kullanmalı
  throw new Error("Şifreli alan formatı geçersiz.");
}

export function assertEncryptionReady(envName = "ANNVERO_FIELD_ENCRYPTION_KEY") {
  const status = getFieldEncryptionKeyStatus(envName);
  if (!status.configured) {
    return { ok: false, status };
  }
  return { ok: true, status };
}

/** Audit için güvenli metadata — secret yok */
export function buildCredentialAuditMetadata(partial = {}) {
  return redactDeep({
    companyId: partial.companyId || "",
    action: partial.action || "",
    hasPassword: Boolean(partial.hasPassword),
    hasParola: Boolean(partial.hasParola),
    result: partial.result || "unknown",
    requestId: partial.requestId || "",
  });
}
