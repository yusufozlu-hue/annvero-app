-- ANNVERO RBAC güvenlik düzeltmesi (022) — kalıcı ve en küçük güvenli düzeltme
-- ---------------------------------------------------------------------------
-- SORUN:
--   annvero_jwt_role() rol yetkisini auth.jwt() -> user_metadata alanından okuyordu.
--   user_metadata KULLANICI TARAFINDAN DEĞİŞTİRİLEBİLİR bir alandır; bu nedenle bir
--   kullanıcı kendi user_metadata.annvero_role='admin' yaparak yetki yükseltebilirdi
--   (privilege escalation). Ayrıca gerçek oturumda user_metadata boş olduğu için
--   admin profil sahibi kullanıcı bile companies listesini boş ([]) görüyordu.
--
-- ÇÖZÜM:
--   Rol, auth kimliği (JWT email claim'i) ile annvero_user_profiles tablosundan,
--   SECURITY DEFINER + sabit search_path'li bir fonksiyon üzerinden okunur.
--   app_metadata yalnız SERVER-CONTROLLED fallback olarak kabul edilir.
--   user_metadata admin/partner yetkisi için ARTIK KULLANILMAZ.
--
-- NOT (company_ids):
--   annvero_jwt_company_ids() bu migration'da DEĞİŞTİRİLMEDİ (mevcut davranış korunur).
--   Ancak company_ids hâlâ user_metadata'dan okunuyor; bu da bir güven sınırı riskidir
--   (bkz. rapor). admin/partner için company_ids etkisizdir çünkü rol kısa devre yapar.
--
-- Idempotent; geçmiş migration'lar yeniden yazılmadan üzerine eklenir.
-- ---------------------------------------------------------------------------

-- 1) Aktif kullanıcının rolünü profil tablosundan güvenli oku (SECURITY DEFINER).
--    Definer sayesinde annvero_user_profiles RLS'ine takılmadan okur; recursion olmaz.
create or replace function public.annvero_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.annvero_user_profiles p
  where p.is_active = true
    and lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by p.updated_at desc nulls last
  limit 1;
$$;

comment on function public.annvero_profile_role() is
  'Aktif kullanıcının rolünü annvero_user_profiles tablosundan (JWT email kimliği ile) güvenli okur. SECURITY DEFINER, sabit search_path.';

-- 2) annvero_jwt_role(): rol kaynağı = profil tablosu (birincil) + app_metadata (server fallback).
--    user_metadata GÜVENİLMEZ olduğundan tamamen çıkarıldı.
create or replace function public.annvero_jwt_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(public.annvero_profile_role(), ''),
    -- Server-controlled fallback: app_metadata kullanıcı tarafından değiştirilemez.
    nullif(auth.jwt() -> 'app_metadata' ->> 'annvero_role', ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    ''
  );
$$;

comment on function public.annvero_jwt_role() is
  'Rol kaynağı: annvero_user_profiles (birincil) + app_metadata (server fallback). user_metadata GÜVENİLMEZ ve rol için kullanılmaz.';

-- 3) companies: authenticated için EN DAR tablo grant'i.
--    Statik inceleme: firma listesi tarayıcıda authenticated ile SELECT edilir
--    (src/utils/companies.js). Yazma işlemleri (upsert/update/soft-delete) yalnız
--    server service_role ile yapılır (app/api/companies/route.js). Bu nedenle
--    authenticated'a INSERT/UPDATE/DELETE VERİLMEZ; yalnız SELECT verilir.
grant select on public.companies to authenticated;

-- RLS zaten açık kalır; satır erişimi companies_select_authenticated policy'si ile
-- annvero_can_access_company(id) üzerinden (artık güvenli rol kaynağıyla) yönetilir.

-- 4) service_role: sunucu API'leri için tam yetki (42501 permission denied giderilir).
--    Migration'la (postgres owner) oluşturulan tablolarda service_role otomatik
--    yetki almadığı için server route'ları 42501 alıyordu. Aşağıdaki grant'ler
--    idempotent'tir; tekrar çalıştırmak güvenlidir. anon/authenticated rollerine
--    EK geniş yetki VERİLMEZ; authenticated için companies yalnız SELECT kalır.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Gelecekte (migration sahibi = postgres tarafından) oluşturulacak public nesneler
-- için varsayılan yetkiler. Yalnız service_role hedeflenir.
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
