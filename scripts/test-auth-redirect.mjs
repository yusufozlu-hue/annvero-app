/**
 * Auth redirect / return-to güvenlik testleri.
 * Çalıştır: node scripts/test-auth-redirect.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANNVERO_RETURN_TO_COOKIE,
  ANNVERO_RETURN_TO_HINT_COOKIE,
  RETURN_TO_COOKIE_MAX_AGE_SEC,
  buildLoginUrl,
  getReturnToCookieOptions,
  getReturnToHintCookieOptions,
  getSafeNextPath,
  hasReturnToHint,
} from "../src/utils/authRedirect.js";

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

test("buildLoginUrl returns clean /login", () => {
  assert.equal(buildLoginUrl("/platform/hesaplama-araclari"), "/login");
  assert.equal(buildLoginUrl(), "/login");
});

test("getSafeNextPath accepts allowed relative paths", () => {
  assert.equal(
    getSafeNextPath("/platform/hesaplama-araclari"),
    "/platform/hesaplama-araclari"
  );
  assert.equal(getSafeNextPath("/dashboard"), "/dashboard");
  assert.equal(getSafeNextPath("/muhasebe/fis-donusturme"), "/muhasebe/fis-donusturme");
});

test("getSafeNextPath rejects open redirects and localhost", () => {
  assert.equal(getSafeNextPath("https://evil.com"), "/dashboard");
  assert.equal(getSafeNextPath("//evil.com"), "/dashboard");
  assert.equal(getSafeNextPath("javascript:alert(1)"), "/dashboard");
  assert.equal(getSafeNextPath("http://localhost:3000/dashboard"), "/dashboard");
  assert.equal(getSafeNextPath("/login?next=http://localhost"), "/dashboard");
  assert.equal(getSafeNextPath("../etc/passwd"), "/dashboard");
  assert.equal(getSafeNextPath("/unknown-area"), "/dashboard");
  assert.equal(getSafeNextPath(""), "/dashboard");
  assert.equal(getSafeNextPath(null), "/dashboard");
});

test("getSafeNextPath uses custom fallback", () => {
  assert.equal(getSafeNextPath("//x", "/dashboard"), "/dashboard");
});

test("return-to cookie options", () => {
  assert.equal(ANNVERO_RETURN_TO_COOKIE, "annvero_return_to");
  assert.equal(RETURN_TO_COOKIE_MAX_AGE_SEC, 600);
  const opts = getReturnToCookieOptions();
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, "lax");
  assert.equal(opts.path, "/");
  assert.equal(opts.maxAge, 600);
  const cleared = getReturnToCookieOptions({ clear: true });
  assert.equal(cleared.maxAge, 0);
});

test("return-to proxy getUser atlar; yol guvenli sanitize", () => {
  const session = read("src/lib/supabase/updateSession.js");
  const route = read("app/api/auth/return-to/route.js");
  assert.match(session, /pathname === "\/api\/auth\/return-to"/);
  assert.match(route, /getSafeNextPath/);
  assert.equal(getSafeNextPath("javascript:alert(1)"), "/dashboard");
  assert.equal(getSafeNextPath("/dashboard/ofis-takip"), "/dashboard/ofis-takip");
});

test("return-to hint cookie yalnizca isaret tasir; yol tasimaz", () => {
  assert.equal(ANNVERO_RETURN_TO_HINT_COOKIE, "annvero_return_to_hint");
  const hint = getReturnToHintCookieOptions();
  assert.equal(hint.httpOnly, false);
  assert.equal(hint.sameSite, "lax");
  assert.equal(hint.path, "/");
  assert.equal(getReturnToHintCookieOptions({ clear: true }).maxAge, 0);

  const session = read("src/lib/supabase/updateSession.js");
  const route = read("app/api/auth/return-to/route.js");
  const callback = read("app/auth/callback/AuthCallbackClient.tsx");
  // Marker her zaman httpOnly yol cookie'siyle birlikte yazilir/silinir.
  assert.match(session, /ANNVERO_RETURN_TO_HINT_COOKIE,\s*\n\s*"1"/);
  assert.match(route, /ANNVERO_RETURN_TO_HINT_COOKIE,\s*\n\s*"1"/);
  assert.match(route, /clearReturnToCookies/);
  assert.match(callback, /consumeReturnToPathClient/);
  // Marker degeri hicbir yerde yol olarak kullanilmaz.
  assert.doesNotMatch(route, /getSafeNextPath\([^)]*HINT/);
});

test("hasReturnToHint yalnizca marker cookie varliginda true", () => {
  const originalDocument = globalThis.document;
  try {
    globalThis.document = { cookie: "" };
    assert.equal(hasReturnToHint(), false);
    globalThis.document = { cookie: "sb-access-token=x; other=1" };
    assert.equal(hasReturnToHint(), false);
    globalThis.document = { cookie: "annvero_return_to_hint_other=1" };
    assert.equal(hasReturnToHint(), false);
    globalThis.document = { cookie: "a=1; annvero_return_to_hint=1" };
    assert.equal(hasReturnToHint(), true);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("login: hint yoksa return-to endpoint cagrilmaz", () => {
  const form = read("app/login/LoginForm.tsx");
  const redirect = read("src/utils/authRedirect.js");
  assert.match(
    redirect,
    /if \(!hasReturnToHint\(\)\) return defaultPath;/
  );
  assert.match(redirect, /getSafeNextPath\(data\?\.path, defaultPath\)/);
  assert.match(form, /consumeReturnToPathClient/);
});

test("login prefetch: yalnizca oturum cerezi dogrulandiktan sonra", () => {
  const form = read("app/login/LoginForm.tsx");
  const cookieGateIndex = form.indexOf("if (!hasSupabaseAuthCookieHint())");
  const prefetchIndex = form.indexOf("router.prefetch(");
  assert.ok(cookieGateIndex > 0, "fail-closed cookie kontrolu bulunamadi");
  assert.ok(prefetchIndex > cookieGateIndex, "prefetch auth oncesinde calisiyor");
  // Prefetch beklenmez ve hata login'i durdurmaz.
  assert.doesNotMatch(form, /await router\.prefetch/);
  assert.match(form, /router\.prefetch\(defaultPath\)/);
  // Tek navigation: yalnizca router.replace.
  assert.equal(form.match(/router\.replace\(/g)?.length, 2);
  assert.doesNotMatch(form, /window\.location\.replace/);
  assert.doesNotMatch(form, /router\.refresh\(/);
});

if (!process.exitCode) {
  console.log("\nAll auth redirect tests passed.");
}
