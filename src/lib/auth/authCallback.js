/**
 * Supabase auth callback yardımcıları — PKCE, token_hash ve fragment akışları.
 * Token değerleri loglanmaz; yalnız mod/tür bilgisi işlenir.
 */

import { resolveAuthHomePathForUser } from "@/src/config/annveroTaxpayerPortal";
import { getSafeNextPath } from "@/src/utils/authRedirect";

export const AUTH_CALLBACK_OTP_TYPES = Object.freeze([
  "invite",
  "recovery",
  "signup",
  "email",
  "magiclink",
]);

export const AUTH_CALLBACK_ERROR_CODES = Object.freeze({
  MISSING_TOKEN: "auth_callback_missing_token",
  EXPIRED: "auth_callback_expired",
  FAILED: "auth_callback_failed",
  CONFIG_MISSING: "supabase_config_missing",
  /** @deprecated Eski kod; yeni akışta kullanılmaz */
  MISSING_CODE: "auth_callback_missing_code",
});

const AUTH_CALLBACK_ERROR_MESSAGES = Object.freeze({
  [AUTH_CALLBACK_ERROR_CODES.MISSING_TOKEN]:
    "Oturum bağlantısı geçersiz veya eksik. Lütfen e-postanızdaki davet bağlantısını yeniden kullanın.",
  [AUTH_CALLBACK_ERROR_CODES.MISSING_CODE]:
    "Oturum bağlantısı geçersiz veya eksik. Lütfen e-postanızdaki davet bağlantısını yeniden kullanın.",
  [AUTH_CALLBACK_ERROR_CODES.EXPIRED]:
    "Bağlantının süresi doldu. Lütfen yeni bir davet isteyin.",
  [AUTH_CALLBACK_ERROR_CODES.FAILED]:
    "Giriş tamamlanamadı. Lütfen tekrar deneyin veya yeni bir davet isteyin.",
  [AUTH_CALLBACK_ERROR_CODES.CONFIG_MISSING]:
    "Kimlik doğrulama yapılandırması eksik. Lütfen daha sonra tekrar deneyin.",
});

export function parseHashParams(hash = "") {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw) return new URLSearchParams();
  return new URLSearchParams(raw);
}

export function isSupportedOtpType(type = "") {
  const normalized = String(type || "").trim().toLowerCase();
  return AUTH_CALLBACK_OTP_TYPES.includes(normalized);
}

/**
 * @returns {{
 *   mode: "pkce" | "token_hash" | "fragment" | "none",
 *   code?: string,
 *   tokenHash?: string,
 *   type?: string,
 *   accessToken?: string,
 *   refreshToken?: string,
 * }}
 */
export function detectAuthCallbackMode(searchParams, hashParams) {
  const code = searchParams?.get?.("code");
  if (code) {
    return {
      mode: "pkce",
      code,
      type: String(searchParams.get("type") || "").toLowerCase(),
    };
  }

  const tokenHash = searchParams?.get?.("token_hash");
  const queryType = String(searchParams.get("type") || "").toLowerCase();
  if (tokenHash && isSupportedOtpType(queryType)) {
    return { mode: "token_hash", tokenHash, type: queryType };
  }

  const hashAccess = hashParams?.get?.("access_token");
  const hashRefresh = hashParams?.get?.("refresh_token");
  const hashType = String(hashParams?.get?.("type") || "").toLowerCase();
  if (hashAccess && hashRefresh) {
    return {
      mode: "fragment",
      accessToken: hashAccess,
      refreshToken: hashRefresh,
      type: hashType,
    };
  }

  const queryAccess = searchParams?.get?.("access_token");
  const queryRefresh = searchParams?.get?.("refresh_token");
  if (queryAccess && queryRefresh) {
    return {
      mode: "fragment",
      accessToken: queryAccess,
      refreshToken: queryRefresh,
      type: queryType,
    };
  }

  return { mode: "none" };
}

export function urlHasSensitiveAuthTokens(url) {
  try {
    const parsed = typeof url === "string" ? new URL(url) : url;
    const hashParams = parseHashParams(parsed.hash);
    if (hashParams.has("access_token") || hashParams.has("refresh_token")) {
      return true;
    }
    if (
      parsed.searchParams.has("access_token") ||
      parsed.searchParams.has("refresh_token")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Fragment/query içindeki token parametrelerini temizler.
 * code ve token_hash tüketim sonrası ayrıca silinir.
 */
export function stripSensitiveAuthParamsFromUrl(href, { stripCode = false, stripOtp = false } = {}) {
  const url = new URL(href);
  const hashParams = parseHashParams(url.hash);

  if (
    hashParams.has("access_token") ||
    hashParams.has("refresh_token") ||
    hashParams.has("expires_in") ||
    hashParams.has("token_type")
  ) {
    url.hash = "";
  }

  url.searchParams.delete("access_token");
  url.searchParams.delete("refresh_token");
  url.searchParams.delete("expires_in");
  url.searchParams.delete("token_type");

  if (stripCode) url.searchParams.delete("code");
  if (stripOtp) {
    url.searchParams.delete("token_hash");
    url.searchParams.delete("type");
  }

  url.search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : "";
  return url.toString();
}

export function isInviteCallbackType(type = "") {
  const normalized = String(type || "").trim().toLowerCase();
  return normalized === "invite" || normalized === "signup";
}

export function isRecoveryCallbackType(type = "") {
  return String(type || "").trim().toLowerCase() === "recovery";
}

/**
 * @param {string} [authType]
 * @param {{ invited_at?: string | null } | null | undefined} [user]
 */
export function requiresPasswordSetup(authType = "", user = null) {
  if (isInviteCallbackType(authType) || isRecoveryCallbackType(authType)) {
    return true;
  }
  if (user?.invited_at) return true;
  return false;
}

/**
 * @param {{
 *   authType?: string,
 *   user?: { invited_at?: string | null } | null,
 *   nextPath?: string,
 * }} [options]
 */
export function resolvePostAuthPath({
  authType = "",
  user = null,
  nextPath = "",
} = {}) {
  if (requiresPasswordSetup(authType, user)) {
    return "/auth/set-password";
  }
  const defaultHome = resolveAuthHomePathForUser(user);
  return getSafeNextPath(nextPath, defaultHome);
}

export function getAuthCallbackErrorMessage(errorCode = "") {
  const key = String(errorCode || "").trim();
  return (
    AUTH_CALLBACK_ERROR_MESSAGES[key] ||
    AUTH_CALLBACK_ERROR_MESSAGES[AUTH_CALLBACK_ERROR_CODES.FAILED]
  );
}

export function mapSupabaseAuthErrorToCode(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (
    message.includes("expired") ||
    (message.includes("invalid") && message.includes("token")) ||
    message.includes("otp")
  ) {
    return AUTH_CALLBACK_ERROR_CODES.EXPIRED;
  }
  return AUTH_CALLBACK_ERROR_CODES.FAILED;
}

export function buildLoginErrorRedirect(errorCode) {
  const code = String(errorCode || AUTH_CALLBACK_ERROR_CODES.FAILED);
  return `/login?error=${encodeURIComponent(code)}`;
}
