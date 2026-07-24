/**
 * AUTH_TRANSPORT — browser/server cookie sözleşmesi regresyon testleri.
 * Çalıştır: node scripts/test-auth-cookie-transport.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getSupabaseSsrCookieOptions,
  hasSupabaseAuthCookieHint,
  shouldUseSecureAuthCookies,
} from "../src/lib/supabase/ssrCookies.js";

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

test("browser client createBrowserClient + cookieOptions (localStorage-only yok)", () => {
  const src = read("src/lib/supabase/client.ts");
  assert.match(src, /createBrowserClient/);
  assert.match(src, /cookieOptions:\s*getSupabaseSsrCookieOptions/);
  assert.match(src, /persistSession:\s*true/);
  assert.doesNotMatch(src, /auth:\s*\{[^}]*storage:\s*window\.localStorage/);
  assert.doesNotMatch(src, /document\.cookie\s*=\s*`[^`]*\$\{.*session/);
});

test("serverAuth createServerClient getAll/setAll — Bearer bypass yok", () => {
  const src = read("src/lib/supabase/serverAuth.js");
  assert.match(src, /createAnnveroServerSupabase|createServerClient/);
  assert.match(src, /getAll\(/);
  assert.match(src, /setAll\(/);
  assert.match(src, /cookieStore\.set/);
  assert.match(src, /getUser\(/);
  // Kod yolu: Authorization header / Bearer token okuma yok
  assert.doesNotMatch(src, /headers\.get\(\s*["']authorization["']\s*\)/i);
  assert.doesNotMatch(src, /Bearer\s+\$\{|authorization\s*[:=]/i);
  assert.doesNotMatch(src, /\.access_token\b/);
});

test("apiGuard Authorization Bearer eklemez", () => {
  const src = read("src/lib/auth/apiGuard.js");
  assert.doesNotMatch(src, /headers\.get\(\s*["']authorization["']\s*\)/i);
  assert.doesNotMatch(src, /Bearer\s+/);
  assert.match(src, /getServerSupabaseUser/);
});

test("proxy API dahil matcher — webhook skip", () => {
  const proxy = read("proxy.ts");
  assert.match(proxy, /_next\/static/);
  assert.match(proxy, /updateSession/);
  const session = read("src/lib/supabase/updateSession.js");
  assert.match(session, /shouldSkipSessionRefresh|automation\/webhook/);
  assert.match(session, /pathname === "\/login"/);
  assert.match(session, /setAll\(cookiesToSet\)/);
  assert.match(session, /getSupabaseSsrCookieOptions/);
});

test("login cookie hint fail-closed; logout storage clear", () => {
  const login = read("app/login/LoginForm.tsx");
  assert.match(login, /hasSupabaseAuthCookieHint/);
  assert.match(login, /signOut\(\s*\{\s*scope:\s*"local"/);
  assert.match(login, /window\.location\.replace\(redirectTarget\)/);
  assert.doesNotMatch(login, /document\.cookie\s*=\s*`[^`]*access_token/);

  const bar = read("src/components/AuthUserBar.jsx");
  assert.match(bar, /clearClientAuthStorage/);
  assert.match(bar, /signOut/);
});

test("AuthGate bellek-only oturumu cookie olmadan kabul etmez", () => {
  const src = read("src/components/AuthGate.jsx");
  assert.match(src, /hasSupabaseAuthCookieHint/);
  assert.match(src, /data\.session && hasSupabaseAuthCookieHint/);
});

test("auth/me credentials include; Bearer yok", () => {
  const meClient = read("src/lib/auth/authMeClient.js");
  assert.match(meClient, /credentials:\s*["']include["']/);
  assert.doesNotMatch(meClient, /Authorization|Bearer/);

  const meRoute = read("app/api/auth/me/route.js");
  assert.match(meRoute, /getServerSupabaseUser/);
  assert.doesNotMatch(meRoute, /authorization|Bearer/i);
});

test("ssr cookie options: path=/ sameSite=lax; secure prod-like", () => {
  const opts = getSupabaseSsrCookieOptions({ rememberMe: true });
  assert.equal(opts.path, "/");
  assert.equal(opts.sameSite, "lax");
  assert.equal(typeof opts.maxAge, "number");
  assert.equal(opts.secure, shouldUseSecureAuthCookies());

  const sessionOpts = getSupabaseSsrCookieOptions({ rememberMe: false });
  assert.equal(sessionOpts.path, "/");
  assert.equal("maxAge" in sessionOpts, false);
});

test("hasSupabaseAuthCookieHint değer okumaz (boş document)", () => {
  assert.equal(hasSupabaseAuthCookieHint(), false);
});

test("callback createAnnveroServerSupabase + setAll", () => {
  const src = read("app/auth/callback/route.js");
  assert.match(src, /createAnnveroServerSupabase/);
  assert.match(src, /setAll/);
  assert.doesNotMatch(src, /document\.cookie/);
});

if (!process.exitCode) {
  console.log("\nAll auth cookie transport tests passed.");
}
