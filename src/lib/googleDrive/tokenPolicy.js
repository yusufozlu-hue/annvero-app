/**
 * Google Drive OAuth / token güvenlik politikası (V1).
 * Gerçek credential enjekte edilmez; yalnız kurallar ve env anahtar adları.
 */

export const GOOGLE_DRIVE_ENV_KEYS = Object.freeze({
  clientId: "GOOGLE_DRIVE_CLIENT_ID",
  clientSecret: "GOOGLE_DRIVE_CLIENT_SECRET",
  redirectUri: "GOOGLE_DRIVE_REDIRECT_URI",
  tokenEncryptionKey: "GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY",
  /** Opsiyonel: GİB anahtarı ile paylaşım yok; ayrı anahtar tercih edilir */
});

/** Minimum OAuth scope önerisi (en dar) */
export const GOOGLE_DRIVE_OAUTH_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/drive.file",
]);

export const TOKEN_STORAGE_RULES = Object.freeze({
  allowLocalStorage: false,
  allowSessionStorage: false,
  allowConsoleLog: false,
  allowUiDisplay: false,
  allowGitCommit: false,
  serverOnlyEncrypted: true,
  pattern: "gib_credentials_aes_gcm_sibling_table",
});

export function assertNoSecretInPayload(payload) {
  const text = JSON.stringify(payload || {});
  const banned = [
    /access_token/i,
    /refresh_token/i,
    /client_secret/i,
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  ];
  for (const re of banned) {
    if (re.test(text)) {
      throw new Error("Yanıt/payload içinde gizli token alanına izin yok.");
    }
  }
  return true;
}

export function sanitizeConnectionPublicView(connection = {}) {
  const {
    status = "disconnected",
    accountEmail = "",
    provider = "google_drive",
    connectedAt = null,
  } = connection;
  return {
    status,
    accountEmail,
    provider,
    connectedAt,
    // token alanları asla
  };
}

export function isGoogleDriveOAuthConfigured(env = process.env) {
  return Boolean(
    env?.[GOOGLE_DRIVE_ENV_KEYS.clientId] &&
      env?.[GOOGLE_DRIVE_ENV_KEYS.clientSecret] &&
      env?.[GOOGLE_DRIVE_ENV_KEYS.redirectUri] &&
      env?.[GOOGLE_DRIVE_ENV_KEYS.tokenEncryptionKey]
  );
}
