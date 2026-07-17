import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function getKey() {
  const raw = String(process.env.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY || "").trim();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY 32-byte base64 olmalıdır.");
  }
  return key;
}

export function encryptGoogleDriveTokens(tokens = {}) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptGoogleDriveTokens(payload = "") {
  const [version, iv, tag, data] = String(payload).split(".");
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error("Google Drive token kaydı geçersiz.");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString("utf8"));
}

export function hasGoogleDriveTokenKey() {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
