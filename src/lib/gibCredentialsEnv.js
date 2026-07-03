const ENV_KEY_NAME = "GIB_CREDENTIALS_ENCRYPTION_KEY";

function normalizeEnvValue(value = "") {
  return String(value).trim().replace(/^['"]|['"]$/g, "");
}

function readServerEnv(name) {
  // Dynamic access keeps Vercel/runtime env vars from being inlined at build time.
  return normalizeEnvValue(process.env[name] ?? "");
}

function parseEncryptionKey(raw) {
  if (!raw) {
    return { ok: false, code: "missing" };
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return { ok: true, key: Buffer.from(raw, "hex") };
  }

  const utf8Key = Buffer.from(raw, "utf8");
  if (utf8Key.length === 32) {
    return { ok: true, key: utf8Key };
  }

  try {
    const base64Key = Buffer.from(raw, "base64");
    if (base64Key.length === 32) {
      return { ok: true, key: base64Key };
    }
  } catch {
    // fall through to invalid format
  }

  return { ok: false, code: "invalid_format" };
}

export function getGibEncryptionKeyEnvName() {
  return ENV_KEY_NAME;
}

export function getGibEncryptionKeyStatus() {
  const raw = readServerEnv(ENV_KEY_NAME);

  if (!raw) {
    return {
      configured: false,
      code: "missing",
      message: `${ENV_KEY_NAME} yapılandırılmamış.`,
    };
  }

  const parsed = parseEncryptionKey(raw);
  if (!parsed.ok) {
    return {
      configured: false,
      code: parsed.code,
      message: `${ENV_KEY_NAME} geçersiz. 32 bayt base64, 64 karakter hex veya 32 bayt ham anahtar olmalıdır.`,
    };
  }

  return { configured: true, key: parsed.key };
}

export function getGibEncryptionKey() {
  const status = getGibEncryptionKeyStatus();
  if (!status.configured) {
    throw new Error(status.message);
  }

  return status.key;
}

export function hasGibEncryptionKeyConfigured() {
  return getGibEncryptionKeyStatus().configured;
}

export function getGibEncryptionKeyErrorMessage() {
  const status = getGibEncryptionKeyStatus();
  return status.configured ? null : status.message;
}
