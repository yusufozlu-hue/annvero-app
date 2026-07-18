/**
 * Deploy öncesi auth güvenlik kontrolleri (statik + davranış varsayımları).
 * Çalıştır: node scripts/test-auth-security-gates.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getSafeNextPath,
  buildLoginUrl,
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

test("AuthGate timeout sonrası getUser ile yeniden doğrular; cookie ile sonsuz authenticated yok", () => {
  const src = read("src/components/AuthGate.jsx");
  assert.match(src, /auth_session_timeout|SESSION_CHECK_TIMEOUT_MS/);
  assert.match(src, /getUser\(/);
  assert.match(src, /markUnauthenticated|clearClientSessionCaches/);
  assert.doesNotMatch(
    src,
    /if \(!hasAuthCookie && cachedAuthStatus === "loading"\)/
  );
  assert.match(src, /hasAuthCookie yalnız ilk paint|paint ipucu/i);
});

test("hasAuthCookie API route'larında authorization değildir", () => {
  const apiDir = path.join(root, "app/api");
  const stack = [apiDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(js|ts)$/.test(entry.name)) {
        const src = fs.readFileSync(full, "utf8");
        assert.doesNotMatch(
          src,
          /hasAuthCookie/,
          `${full} hasAuthCookie kullanmamalı`
        );
      }
    }
  }
});

test("korumalı API'ler sunucu oturum doğrulaması kullanır (örnekler)", () => {
  const samples = [
    "app/api/auth/me/route.js",
    "app/api/transaction-memory/route.js",
    "app/api/learning-memory/route.js",
    "app/api/companies/route.js",
    "app/api/admin/me/route.js",
  ];
  for (const rel of samples) {
    const src = read(rel);
    assert.match(
      src,
      /getServerSupabaseUser|requireAuthenticatedApi|requireApiSession|requireAdminUser|requireManagementUser|requireManagementApi/,
      `${rel} sunucu yetkisi eksik`
    );
  }
});

test("çıkış ve giriş client session cache temizler", () => {
  const bar = read("src/components/AuthUserBar.jsx");
  const login = read("app/login/page.tsx");
  const clearer = read("src/lib/auth/clearClientSession.js");
  assert.match(bar, /clearClientSessionCaches/);
  assert.match(login, /clearClientSessionCaches/);
  assert.match(clearer, /invalidateAuthMeCache/);
  assert.match(clearer, /resetAuthGateCache/);
  assert.match(clearer, /clearCompaniesClientCache/);
  assert.match(clearer, /ANNVERO_ROLE_STORAGE_KEY/);
});

test("auth/me unauthenticated önceki profil cache'ini tutmaz", () => {
  const src = read("src/lib/auth/authMeClient.js");
  assert.match(src, /data\?\.authenticated/);
  assert.match(src, /cache = null/);
});

test("useUserRole ağ hatasında localStorage'dan authenticated üretmez", () => {
  const src = read("src/hooks/useUserRole.js");
  assert.match(src, /Ağ hatasında localStorage/);
  assert.doesNotMatch(src, /source: "fallback"/);
  assert.match(src, /emitAuthInvalid/);
});

test("CompanyWorkspace oturum yokken firma seed etmez", () => {
  const src = read("src/contexts/CompanyWorkspaceContext.jsx");
  assert.match(src, /if \(!authenticated\)/);
  assert.match(src, /setCompanies\(\[\]\)/);
});

test("fetchCompanies oturumsuz localStorage sızdırmaz", () => {
  const src = read("src/utils/companies.js");
  assert.match(src, /if \(!session\)/);
  assert.match(src, /clearCompaniesClientCache/);
  assert.doesNotMatch(
    src,
    /catch \(error\) \{\s*console\.error\("Firma listesi[\s\S]*readRawCompaniesFromStorage/
  );
});

test("open redirect hâlâ kapalı", () => {
  assert.equal(buildLoginUrl(), "/login");
  assert.equal(getSafeNextPath("https://evil.com"), "/dashboard");
  assert.equal(getSafeNextPath("http://localhost:3000/x"), "/dashboard");
});

if (!process.exitCode) {
  console.log("\nAll auth security gate tests passed.");
}
