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
  const login = read("app/login/LoginForm.tsx");
  const clearer = read("src/lib/auth/clearClientSession.js");
  assert.match(bar, /clearClientSessionCaches/);
  assert.match(login, /clearClientSessionCaches/);
  assert.match(clearer, /invalidateAuthMeCache/);
  assert.match(clearer, /resetAuthGateCache/);
  assert.match(clearer, /clearCompaniesClientCache/);
  assert.match(clearer, /ANNVERO_ROLE_STORAGE_KEY/);
});

test("cache temizligi acik allowlist; toplu silme ve hatirlanan e-posta silme yok", () => {
  const clearer = read("src/lib/auth/clearClientSession.js");
  // Toplu temizlik yok: kullanicilar arasi sizinti allowlist ile onlenir.
  assert.doesNotMatch(clearer, /localStorage\.clear\(\)/);
  assert.doesNotMatch(clearer, /sessionStorage\.clear\(\)/);
  assert.doesNotMatch(clearer, /caches\.(open|keys|delete)/);
  assert.doesNotMatch(clearer, /Object\.keys\(/);
  // Hatirlanan e-posta ve sifre yoneticisi anahtarlari allowlist disinda.
  assert.doesNotMatch(clearer, /annvero_remembered_email/);
  assert.doesNotMatch(clearer, /ANNVERO_REMEMBERED_EMAIL_KEY/);
  // Kullanici-scoped anahtarlar allowlist icinde kalir.
  for (const key of [
    "ANNVERO_USERS_CACHE_KEY",
    "ANNVERO_SELECTED_COMPANY_KEY",
    "COMPANIES_SESSION_STORAGE_KEY",
  ]) {
    assert.ok(clearer.includes(key), `${key} allowlist'te yok`);
  }
});

test("login submit yolunda cache temizligi dinamik import beklemez", () => {
  const login = read("app/login/LoginForm.tsx");
  assert.match(
    login,
    /import \{ clearClientSessionCaches \} from "@\/src\/lib\/auth\/clearClientSession";/
  );
  assert.doesNotMatch(login, /await import\(\s*\n?\s*"@\/src\/lib\/auth\/clearClientSession"/);
});

test("firma sorgusu mukerrer calismaz", () => {
  const companies = read("src/utils/companies.js");
  const context = read("src/contexts/CompanyWorkspaceContext.jsx");
  assert.match(companies, /companiesFetchInFlight/);
  assert.match(companies, /return companiesFetchInFlight;/);
  // Kullanici degisiminde eski sorgu sonucu yeni kullaniciya verilmez.
  assert.match(companies, /companiesFetchGeneration \+= 1;/);
  assert.match(companies, /if \(generation !== companiesFetchGeneration\) return \[\];/);
  // refreshCompanies kimligi liste uzunlugu degisince yeniden olusmamali.
  assert.match(context, /companiesCountRef/);
  assert.doesNotMatch(context, /\}, \[companies\.length, persistCompanyId\]\);/);
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

test("public /login proxy'de getUser yok (updateSession early return)", () => {
  const proxy = read("proxy.ts");
  assert.match(proxy, /updateSession/);
  assert.match(proxy, /_next\/static/);
  const session = read("src/lib/supabase/updateSession.js");
  assert.match(session, /pathname === "\/login"/);
  assert.match(session, /asla Supabase getUser/);
});

test("SW login navigasyonunu bypass eder ve eski cache sürümü yükseltilir", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /annvero-pwa-v2/);
  assert.match(sw, /pathname === "\/login"/);
  assert.match(sw, /NAV_NETWORK_TIMEOUT_MS/);
  assert.match(sw, /AbortController/);
});

test("open redirect hâlâ kapalı", () => {
  assert.equal(buildLoginUrl(), "/login");
  assert.equal(getSafeNextPath("https://evil.com"), "/dashboard");
  assert.equal(getSafeNextPath("http://localhost:3000/x"), "/dashboard");
});

test("giris ve cikis yonlendirmeleri uzak cagrilarda asili kalmaz", () => {
  const bar = read("src/components/AuthUserBar.jsx");
  const login = read("app/login/LoginForm.tsx");
  const gate = read("src/components/AuthGate.jsx");
  const logoutProg = read("src/lib/auth/logoutInProgress.js");
  const session = read("src/lib/supabase/updateSession.js");
  assert.match(login, /RETURN_TO_BUDGET_MS/);
  assert.match(login, /controller\.abort\(\)/);
  assert.match(login, /router\.replace\(redirectTarget\)/);
  assert.doesNotMatch(login, /router\.refresh\(\)/);
  assert.doesNotMatch(login, /window\.location\.replace\(redirectTarget\)/);
  assert.doesNotMatch(login, /await existing\.auth\.signOut/);
  assert.match(session, /\/api\/auth\/return-to/);
  assert.match(session, /shouldSkipSessionRefresh/);
  assert.match(bar, /SIGN_OUT_GLOBAL_TIMEOUT_MS/);
  assert.match(bar, /signOut\(\{ scope: "global" \}\)/);
  assert.match(bar, /signOut\(\{ scope: "local" \}\)/);
  assert.match(bar, /beginLogoutInProgress/);
  assert.match(bar, /keepalive: true/);
  assert.match(bar, /window\.location\.replace\("https:\/\/annvero\.com\/"\)/);
  assert.match(logoutProg, /logoutInProgress/);
  assert.doesNotMatch(logoutProg, /localStorage\.|sessionStorage\./);
  assert.match(gate, /isLogoutInProgress/);
  assert.match(gate, /Çıkış yapılıyor/);
  assert.match(gate, /logoutActive \|\| isLogoutInProgress\(\)/);
});

test("return-to login kritik yolunu 1s bloklamaz; open redirect kapali", () => {
  const login = read("app/login/LoginForm.tsx");
  const route = read("app/api/auth/return-to/route.js");
  assert.match(login, /RETURN_TO_BUDGET_MS\s*=\s*100/);
  assert.doesNotMatch(login, /setTimeout\(\s*\(\)\s*=>\s*controller\.abort\(\),\s*1000\)/);
  assert.match(login, /DEFAULT_POST_LOGIN_PATH/);
  assert.match(route, /getSafeNextPath/);
  assert.match(route, /ANNVERO_RETURN_TO_COOKIE/);
  assert.equal(getSafeNextPath("https://evil.com"), "/dashboard");
  assert.equal(getSafeNextPath("//evil.com"), "/dashboard");
  assert.equal(getSafeNextPath("/muhasebe/banka"), "/muhasebe/banka");
});

test("Beni Hatirla yalniz e-posta saklar; sifre yazmaz", () => {
  const login = read("app/login/LoginForm.tsx");
  const redirect = read("src/utils/authRedirect.js");
  assert.match(redirect, /ANNVERO_REMEMBERED_EMAIL_KEY/);
  assert.match(redirect, /annvero_remembered_email/);
  assert.match(redirect, /normalizeRememberedEmail/);
  assert.match(login, /writeRememberedEmail/);
  assert.match(login, /autoComplete="username"/);
  assert.match(login, /autoComplete="current-password"/);
  assert.doesNotMatch(login, /localStorage\.setItem\([^)]*password/i);
  assert.doesNotMatch(
    redirect,
    /localStorage\.setItem\(\s*[^,]+,\s*[^)]*password/i
  );
});

test("auth perf diagnostigi staging + debug anahtari ister; hassas veri yok", () => {
  const diag = read("src/lib/auth/loginPerfDiagnostics.js");
  const login = read("app/login/LoginForm.tsx");
  const gate = read("src/components/AuthGate.jsx");
  assert.match(diag, /auth_perf/);
  assert.match(diag, /annvero\.com/);
  assert.match(diag, /sessionStorage/);
  assert.doesNotMatch(diag, /localStorage/);
  assert.doesNotMatch(diag, /fetch\(/);
  assert.match(login, /startAuthPerfRun/);
  assert.match(login, /markAuthPerf\("supabase_login"/);
  assert.match(gate, /markAuthPerfDocumentLoad/);
  assert.doesNotMatch(diag, /localStorage\.setItem/);
  assert.doesNotMatch(diag, /document\.cookie\s*=/);
});
if (!process.exitCode) {
  console.log("\nAll auth security gate tests passed.");
}
