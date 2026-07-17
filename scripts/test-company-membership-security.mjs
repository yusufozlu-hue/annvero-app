/**
 * ANNVERO — company membership güvenlik testleri (023)
 * Run: node ./scripts/test-company-membership-security.mjs
 *
 * NOT: Bu testler canlı DB gerektirmeden, 023 migration'ının SQL garantilerini
 * statik olarak doğrular. Her senaryo, ilgili fail-closed davranışının SQL
 * seviyesinde sağlandığını (fonksiyon gövdesi/constraint/grant) kanıtlar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const sql = readFileSync(
  join(root, "supabase", "migrations", "023_company_membership_source.sql"),
  "utf8"
);

const lower = sql.toLowerCase();

/** Belirli bir fonksiyonun gövdesini ($$ ... $$) çıkar. */
function functionBody(signatureFragment) {
  const idx = lower.indexOf(signatureFragment.toLowerCase());
  assert.ok(idx !== -1, `fonksiyon bulunamadı: ${signatureFragment}`);
  const start = sql.indexOf("$$", idx);
  const end = sql.indexOf("$$", start + 2);
  assert.ok(start !== -1 && end !== -1, `gövde ayrıştırılamadı: ${signatureFragment}`);
  return sql.slice(start + 2, end);
}

const results = [];
function check(name, fn) {
  fn();
  results.push(name);
  console.log(`PASS ${name}`);
}

const jwtCompanyIds = functionBody("function public.annvero_jwt_company_ids()");
const profileCompanyIds = functionBody("function public.annvero_profile_company_ids()");
const profileRole = functionBody("function public.annvero_profile_role()");
const canAccess = functionBody("function public.annvero_can_access_company(target_company_id text)");
const syncRpc = functionBody("function public.annvero_sync_company_membership(");

// Senaryo 1: regular kullanıcı user_metadata.company_ids sahtelese bile erişemez.
check("1. user_metadata.company_ids yetki kaynağı değil", () => {
  assert.ok(
    !jwtCompanyIds.toLowerCase().includes("user_metadata"),
    "annvero_jwt_company_ids user_metadata içermemeli"
  );
  assert.ok(
    !canAccess.toLowerCase().includes("user_metadata"),
    "annvero_can_access_company user_metadata içermemeli"
  );
});

// Senaryo 2: app_metadata.company_ids olsa bile membership yoksa erişemez.
check("2. app_metadata.company_ids fallback kaldırıldı (membership-only)", () => {
  assert.ok(
    !jwtCompanyIds.toLowerCase().includes("app_metadata"),
    "annvero_jwt_company_ids app_metadata içermemeli"
  );
  assert.ok(
    jwtCompanyIds.toLowerCase().includes("annvero_profile_company_ids"),
    "annvero_jwt_company_ids yalnız membership kaynağını çağırmalı"
  );
});

// Senaryo 3: aktif membership varsa yalnız atanmış firmaya erişir.
check("3. company_ids kaynağı auth.uid membership (yalnız atanmış firma)", () => {
  assert.ok(
    profileCompanyIds.toLowerCase().includes("annvero_company_members"),
    "profile_company_ids membership tablosundan okumalı"
  );
  assert.ok(
    profileCompanyIds.toLowerCase().includes("auth.uid()"),
    "profile_company_ids auth.uid() ile filtrelemeli"
  );
  assert.ok(
    canAccess.toLowerCase().includes("annvero_jwt_company_ids") &&
      canAccess.includes("= any(ids)"),
    "can_access yalnız atanmış firmaya izin vermeli"
  );
  // admin/partner kısa devresi korunur
  assert.ok(
    canAccess.toLowerCase().includes("'admin'") &&
      canAccess.toLowerCase().includes("'partner'"),
    "admin/partner kısa devresi korunmalı"
  );
});

// Senaryo 4: membership kaldırılınca (is_active=false) erişim kesilir.
check("4. membership is_active=false erişimi keser (fail-closed)", () => {
  assert.ok(
    /is_active\s*=\s*true/i.test(profileCompanyIds),
    "profile_company_ids yalnız is_active=true membership'i saymalı"
  );
  // fail-closed: boş membership → boş dizi
  assert.ok(
    profileCompanyIds.toLowerCase().includes("coalesce(array_agg") &&
      profileCompanyIds.toLowerCase().includes("array[]::text[]"),
    "membership yoksa boş text[] dönmeli"
  );
  assert.ok(
    /array_length\(ids,\s*1\),\s*0\)\s*=\s*0/i.test(canAccess.replace(/\s+/g, " ")) ||
      canAccess.toLowerCase().includes("return false"),
    "can_access boş listede false dönmeli"
  );
});

// Senaryo 5: geçersiz firma listesinde atomik rollback (FK + tek RPC).
check("5. geçersiz company_id → atomik rollback (FK + service_role-only RPC)", () => {
  assert.ok(
    /references\s+public\.companies\s*\(\s*id\s*\)/i.test(sql),
    "annvero_company_members.company_id companies(id) FK'sine sahip olmalı"
  );
  assert.ok(
    syncRpc.toLowerCase().includes("insert into public.annvero_company_members"),
    "RPC membership upsert yapmalı (FK ihlali → exception → rollback)"
  );
  assert.ok(
    /security\s+definer/i.test(sql.slice(sql.indexOf("annvero_sync_company_membership"))) ,
    "RPC SECURITY DEFINER olmalı"
  );
  assert.ok(
    /revoke\s+all\s+on\s+function\s+public\.annvero_sync_company_membership[\s\S]*from\s+anon/i.test(sql) &&
      /revoke\s+all\s+on\s+function\s+public\.annvero_sync_company_membership[\s\S]*from\s+authenticated/i.test(sql),
    "RPC execute anon/authenticated'tan revoke edilmeli"
  );
  assert.ok(
    /grant\s+execute\s+on\s+function\s+public\.annvero_sync_company_membership[\s\S]*to\s+service_role/i.test(sql),
    "RPC execute service_role'e verilmeli"
  );
});

// Ek güvenlik garantileri
check("6. profile_role runtime kaynağı auth.uid = auth_user_id", () => {
  assert.ok(
    profileRole.toLowerCase().includes("auth_user_id") &&
      profileRole.toLowerCase().includes("auth.uid()"),
    "profile_role auth.uid() = auth_user_id ile okumalı"
  );
  assert.ok(
    !profileRole.toLowerCase().includes("user_metadata"),
    "profile_role user_metadata içermemeli"
  );
});

check("7. auth_user_id backfill güvenli (p.id::uuid cast yok)", () => {
  assert.ok(!/p\.id::uuid/i.test(sql), "p.id::uuid cast'i kullanılmamalı");
  assert.ok(
    /p\.id\s*=\s*u\.id::text/i.test(sql),
    "backfill auth.users ile p.id = u.id::text join kullanmalı"
  );
});

check("8. annvero_company_members RLS açık + client grant yok", () => {
  assert.ok(
    /alter table public\.annvero_company_members enable row level security/i.test(sql),
    "membership tablosunda RLS açık olmalı"
  );
  assert.ok(
    /revoke all on public\.annvero_company_members from anon/i.test(sql) &&
      /revoke all on public\.annvero_company_members from authenticated/i.test(sql),
    "anon/authenticated tablo yetkisi revoke edilmeli"
  );
  assert.ok(
    /grant select, insert, update, delete on public\.annvero_company_members to service_role/i.test(sql),
    "service_role CRUD grant olmalı"
  );
});

console.log(`\nAll company membership security checks passed (${results.length}).`);
