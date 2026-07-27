/**
 * Supabase auth callback akış testleri.
 * Çalıştır: node --import ./scripts/_alias-loader.mjs ./scripts/test-auth-callback.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_CALLBACK_ERROR_CODES,
  buildLoginErrorRedirect,
  detectAuthCallbackMode,
  getAuthCallbackErrorMessage,
  parseHashParams,
  requiresPasswordSetup,
  resolvePostAuthPath,
  stripSensitiveAuthParamsFromUrl,
  urlHasSensitiveAuthTokens,
} from "../src/lib/auth/authCallback.js";
import { getSafeNextPath } from "../src/utils/authRedirect.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test("PKCE code callback mode", () => {
  const params = new URLSearchParams("code=abc123&type=invite");
  const mode = detectAuthCallbackMode(params, new URLSearchParams());
  assert.equal(mode.mode, "pkce");
  assert.equal(mode.code, "abc123");
  assert.equal(mode.type, "invite");
});

test("token_hash invite callback mode", () => {
  const params = new URLSearchParams("token_hash=hash123&type=invite");
  const mode = detectAuthCallbackMode(params, new URLSearchParams());
  assert.equal(mode.mode, "token_hash");
  assert.equal(mode.tokenHash, "hash123");
  assert.equal(mode.type, "invite");
});

test("fragment invite callback mode", () => {
  const hash = parseHashParams(
    "#access_token=at&refresh_token=rt&type=invite&expires_in=3600"
  );
  const mode = detectAuthCallbackMode(new URLSearchParams(), hash);
  assert.equal(mode.mode, "fragment");
  assert.equal(mode.accessToken, "at");
  assert.equal(mode.refreshToken, "rt");
  assert.equal(mode.type, "invite");
});

test("fragment URL stripped immediately after read", () => {
  const href =
    "https://annvero-staging.example/auth/callback#access_token=secret&refresh_token=secret2&type=invite";
  assert.equal(urlHasSensitiveAuthTokens(href), true);
  const cleaned = stripSensitiveAuthParamsFromUrl(href);
  assert.equal(urlHasSensitiveAuthTokens(cleaned), false);
  assert.equal(cleaned.includes("access_token"), false);
  assert.equal(cleaned.includes("refresh_token"), false);
  assert.match(cleaned, /\/auth\/callback$/);
});

test("callback client uses three Supabase session methods", () => {
  const src = read("app/auth/callback/AuthCallbackClient.tsx");
  assert.match(src, /exchangeCodeForSession/);
  assert.match(src, /verifyOtp/);
  assert.match(src, /setSession/);
  assert.match(src, /replaceState/);
  assert.match(src, /stripSensitiveAuthParamsFromUrl/);
  assert.doesNotMatch(
    src,
    /console\.(log|info|warn|error)[\s\S]{0,200}(access_token|refresh_token)/i
  );
});

test("server callback route removed — fragment never hits server-only PKCE", () => {
  assert.equal(
    fs.existsSync(path.join(root, "app/auth/callback/route.js")),
    false
  );
  assert.equal(
    fs.existsSync(path.join(root, "app/auth/callback/page.tsx")),
    true
  );
});

test("missing/expired token errors are Turkish and tokenless", () => {
  const missing = getAuthCallbackErrorMessage(
    AUTH_CALLBACK_ERROR_CODES.MISSING_TOKEN
  );
  const expired = getAuthCallbackErrorMessage(AUTH_CALLBACK_ERROR_CODES.EXPIRED);
  assert.match(missing, /geçersiz|eksik/i);
  assert.match(expired, /süresi doldu/i);
  assert.doesNotMatch(missing, /access_token|refresh_token|eyJ/i);
  assert.doesNotMatch(expired, /access_token|refresh_token|eyJ/i);
});

test("open redirect rejected for post-auth next path", () => {
  assert.equal(
    resolvePostAuthPath({ nextPath: "https://evil.com" }),
    "/dashboard"
  );
  assert.equal(
    resolvePostAuthPath({ nextPath: "//evil.com/dashboard" }),
    "/dashboard"
  );
  assert.equal(
    getSafeNextPath("javascript:alert(1)", "/dashboard"),
    "/dashboard"
  );
});

test("invite requires password setup then dashboard path", () => {
  assert.equal(requiresPasswordSetup("invite", null), true);
  assert.equal(
    resolvePostAuthPath({ authType: "invite", nextPath: "/dashboard" }),
    "/auth/set-password"
  );
  assert.equal(
    resolvePostAuthPath({ authType: "", nextPath: "/dashboard" }),
    "/dashboard"
  );
});

test("set-password flow updates user and refreshes session", () => {
  const src = read("app/auth/set-password/SetPasswordForm.tsx");
  assert.match(src, /updateUser\(\{\s*password/);
  assert.match(src, /refreshSession/);
  assert.match(src, /Şifre Belirle/);
  assert.doesNotMatch(src, /router\.replace\(["']https?:\/\//);
});

test("login shows Turkish callback errors without token leakage", () => {
  const login = read("app/login/LoginForm.tsx");
  assert.match(login, /getAuthCallbackErrorMessage/);
  assert.doesNotMatch(
    login,
    /params\.get\("error"\)[\s\S]{0,120}setError\(params/
  );
});

test("buildLoginErrorRedirect encodes safe error codes only", () => {
  assert.equal(
    buildLoginErrorRedirect(AUTH_CALLBACK_ERROR_CODES.FAILED),
    "/login?error=auth_callback_failed"
  );
  assert.doesNotMatch(
    buildLoginErrorRedirect(AUTH_CALLBACK_ERROR_CODES.FAILED),
    /access_token/
  );
});

if (!process.exitCode) {
  console.log("\nAll auth callback tests passed.");
}
