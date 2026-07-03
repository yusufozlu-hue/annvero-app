import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey() {
  const raw = process.env.GIB_CREDENTIALS_ENCRYPTION_KEY || "";
  if (!raw) {
    throw new Error("GIB_CREDENTIALS_ENCRYPTION_KEY yapılandırılmamış.");
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("GIB_CREDENTIALS_ENCRYPTION_KEY 32 bayt base64 olmalıdır.");
  }

  return key;
}

export function encryptSecret(plainText = "") {
  const value = String(plainText || "");
  if (!value) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(payload = "") {
  if (!payload) return "";

  const [ivB64, tagB64, dataB64] = String(payload).split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Şifreli veri formatı geçersiz.");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function maskSecret(value = "") {
  if (!value) return "";
  return "••••••••";
}

export function hasEncryptionKeyConfigured() {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}
