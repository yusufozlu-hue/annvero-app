import crypto from "crypto";
import {
  getGibEncryptionKey,
  hasGibEncryptionKeyConfigured,
} from "@/src/lib/gibCredentialsEnv";

const ALGORITHM = "aes-256-gcm";

export function encryptSecret(plainText = "") {
  const value = String(plainText || "");
  if (!value) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getGibEncryptionKey(), iv);
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
    getGibEncryptionKey(),
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
  return hasGibEncryptionKeyConfigured();
}
