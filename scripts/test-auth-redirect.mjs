/**
 * Auth redirect / return-to güvenlik testleri.
 * Çalıştır: node scripts/test-auth-redirect.mjs
 */

import assert from "node:assert/strict";
import {
  ANNVERO_RETURN_TO_COOKIE,
  RETURN_TO_COOKIE_MAX_AGE_SEC,
  buildLoginUrl,
  getReturnToCookieOptions,
  getSafeNextPath,
} from "../src/utils/authRedirect.js";

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

if (!process.exitCode) {
  console.log("\nAll auth redirect tests passed.");
}
