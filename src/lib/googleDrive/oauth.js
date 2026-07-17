import crypto from "node:crypto";
import { GOOGLE_DRIVE_OAUTH_SCOPES } from "./tokenPolicy";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const STATE_TTL_MS = 10 * 60 * 1000;

function env(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} yapılandırılmamış.`);
  return value;
}

function stateKey() {
  return Buffer.from(env("GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY"), "base64");
}

export function createOAuthState({ userId, companyId }) {
  const payload = Buffer.from(JSON.stringify({
    userId: String(userId),
    companyId: String(companyId),
    nonce: crypto.randomBytes(24).toString("base64url"),
    exp: Date.now() + STATE_TTL_MS,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", stateKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state, expectedState) {
  if (!state || !expectedState || state !== expectedState) throw new Error("OAuth state doğrulanamadı.");
  const [payload, signature] = state.split(".");
  const expected = crypto.createHmac("sha256", stateKey()).update(payload).digest();
  const actual = Buffer.from(signature || "", "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error("OAuth state imzası geçersiz.");
  }
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!decoded.exp || decoded.exp < Date.now()) throw new Error("OAuth state süresi doldu.");
  return decoded;
}

export function buildGoogleAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: env("GOOGLE_DRIVE_CLIENT_ID"),
    redirect_uri: env("GOOGLE_DRIVE_REDIRECT_URI"),
    response_type: "code",
    scope: GOOGLE_DRIVE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function tokenRequest(params) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Google token işlemi başarısız (${body.error || response.status}).`);
  return body;
}

export function exchangeAuthorizationCode(code) {
  return tokenRequest({
    code,
    client_id: env("GOOGLE_DRIVE_CLIENT_ID"),
    client_secret: env("GOOGLE_DRIVE_CLIENT_SECRET"),
    redirect_uri: env("GOOGLE_DRIVE_REDIRECT_URI"),
    grant_type: "authorization_code",
  });
}

export function refreshGoogleAccessToken(refreshToken) {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: env("GOOGLE_DRIVE_CLIENT_ID"),
    client_secret: env("GOOGLE_DRIVE_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
}

export async function fetchGoogleAccountEmail(accessToken) {
  const response = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return "";
  const body = await response.json();
  return String(body?.user?.emailAddress || "");
}
