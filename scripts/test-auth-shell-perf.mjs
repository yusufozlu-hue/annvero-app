/**
 * AuthGate / shell boyama varsayımları — performans kabul kontrolü.
 * Çalıştır: node scripts/test-auth-shell-perf.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

test("AuthGate cookie ile iyimser authenticated başlar", () => {
  const src = read("src/components/AuthGate.jsx");
  assert.match(src, /hasAuthCookie/);
  assert.match(src, /if \(hasAuthCookie\) return "authenticated"/);
  assert.match(src, /SESSION_CHECK_TIMEOUT_MS/);
  assert.doesNotMatch(src, /testSupabaseAuthConnection/);
});

test("annvero layout cookie ipucu verir (getUser çağırmaz)", () => {
  const src = read("app/(annvero)/layout.jsx");
  assert.match(src, /hasAuthCookie/);
  assert.match(src, /cookies\(\)/);
  assert.doesNotMatch(src, /getServerSupabaseUser|getUser\(/);
});

test("UserRoleProvider tek auth/me paylaşır", () => {
  const role = read("src/hooks/useUserRole.js");
  const shell = read("src/components/AnnveroAppShell.jsx");
  assert.match(role, /UserRoleProvider/);
  assert.match(role, /peekAuthMeCache/);
  assert.match(shell, /UserRoleProvider/);
});

test("useAdminAccess ayrı admin endpoint fetch etmez", () => {
  const src = read("src/hooks/useAdminAccess.js");
  assert.doesNotMatch(src, /fetch\(["'`]\/api\/admin\/me/);
  assert.match(src, /useUserRole/);
});

test("auth/me touchLastLogin yanıtı bloke etmez", () => {
  const src = read("app/api/auth/me/route.js");
  assert.match(src, /void touchLastLogin/);
});

if (!process.exitCode) {
  console.log("\nAll auth shell perf checks passed.");
}
