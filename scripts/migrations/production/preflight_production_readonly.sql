-- ANNVERO PRODUCTION preflight — READ-ONLY (yalniz SELECT / katalog)
-- ---------------------------------------------------------------------------
-- AMAC: Drive + RBAC forward-only paketini (011,012,020,021,022,023) uygulamadan
-- ONCE production semasinin durumunu FAIL-SAFE dogrulamak.
--
-- Bu dosya HICBIR sey degistirmez: INSERT/UPDATE/DELETE/DDL/GRANT/REVOKE YOKTUR.
--
-- 42P01 DUZELTMESI:
--   Onceki surum, bulunmayan tabloyu (ornek: public.annvero_user_profiles) bir
--   CASE dalinin ICINDE statik alt-sorgu olarak referansliyordu:
--       case when to_regclass('public.annvero_user_profiles') is not null
--            then (select count(*) from public.annvero_user_profiles) ...
--   PostgreSQL, sorgunun TAMAMINI (CASE'in her iki dali dahil) PLAN asamasinda
--   coozumler; to_regclass RUNTIME guard'i parse asamasinda tabloyu var etmez.
--   Bu yuzden tablo yoksa 42P01 (relation does not exist) verir.
--
--   COZUM: Bulunmayan tablolara ASLA statik SQL referansi verme. Varlik/kolon/
--   policy/fonksiyon/grant durumlari yalniz KATALOG uzerinden okunur
--   (to_regclass, to_regprocedure, information_schema, pg_catalog, pg_policies,
--   has_table_privilege, has_function_privilege). Satir sayilari icin ya
--   GARANTILI var olan tablolar (companies, learning_memory, auth.users) statik
--   sayilir ya da pg_class.reltuples KATALOG tahmini kullanilir.
--
-- Onemli: Bu dosya PRODUCTION uzerinde uygulama ONERMEZ; yalniz durum tespiti
-- icindir. Uygulama karari ayri onay ister.
-- ---------------------------------------------------------------------------

with
-- 1) Cekirdek tablo varliklari (to_regclass — yoksa null doner, hata vermez)
core as (
  select
    (to_regclass('public.companies') is not null)              as companies_present,
    (to_regclass('public.learning_memory') is not null)        as learning_memory_present,
    (to_regclass('public.annvero_user_profiles') is not null)  as profiles_present,
    (to_regclass('public.official_notifications') is not null) as official_notifications_present,
    (to_regclass('public.annvero_company_members') is not null) as members_present
),
-- 2) Sayimlar
--    - GARANTILI var olan tablolar (companies, learning_memory, auth.users) statik sayilir.
--    - Kosullu (olabilir/olmayabilir) tablolar icin pg_class.reltuples KATALOG tahmini.
--      (reltuples: son ANALYZE tahmini; -1 => hic analiz edilmemis/olcum yok.)
counts as (
  select
    (select count(*)::bigint from public.companies)        as companies_count,
    (select count(*)::bigint from public.learning_memory)  as learning_memory_count,
    (select count(*)::bigint from auth.users)              as auth_users_count,
    -- Kosullu tablolar: statik referans YOK; yalniz katalog tahmini.
    coalesce((
      select c.reltuples::bigint
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'annvero_user_profiles'
    ), -1) as profiles_est_rowcount,
    coalesce((
      select c.reltuples::bigint
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'annvero_company_members'
    ), -1) as members_est_rowcount,
    -- 023 sonrasi membership taşinmasi gerekebilecek, user_metadata.company_ids dolu
    -- kullanicilar (GUVENILMEZ claim; yalniz rapor amaci). auth.users her zaman vardir.
    (
      select count(*)::bigint from auth.users u
      where jsonb_typeof(u.raw_user_meta_data -> 'company_ids') = 'array'
        and jsonb_array_length(u.raw_user_meta_data -> 'company_ids') > 0
    ) as users_with_untrusted_company_ids
),
-- 3) auth_user_id (023-A) kolon durumu — information_schema KATALOG (tablo yoksa 0 satir)
authcol as (
  select
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'annvero_user_profiles'
        and column_name = 'auth_user_id'
    ) as auth_user_id_present
),
-- 4) official_notifications kolon uyumu (006) — KATALOG (tablo yoksa false)
oncols as (
  select
    exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'official_notifications' and column_name = 'source') as on_has_source,
    exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'official_notifications' and column_name = 'served_date') as on_has_served_date
),
-- 5) learning_memory legacy public policy'leri (021 temizler) — pg_policies KATALOG
lmpol as (
  select coalesce(count(*), 0)::int as learning_memory_legacy_policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'learning_memory'
    and policyname in (
      'allow learning memory delete', 'allow learning memory insert',
      'allow learning memory read', 'allow learning memory update'
    )
),
-- 6) 020 Drive tablolari — to_regclass KATALOG
drive as (
  select (
    (to_regclass('public.cloud_storage_connections') is not null)::int
    + (to_regclass('public.company_cloud_folders') is not null)::int
    + (to_regclass('public.document_index') is not null)::int
    + (to_regclass('public.document_sync_events') is not null)::int
  ) as drive_tables_present_count
),
-- 7) 015 durumu (kismi uygulama tespiti) — helper fonksiyon + audit_events KATALOG
sec015 as (
  select
    (to_regprocedure('public.annvero_can_access_company(text)') is not null) as can_access_fn_present,
    (to_regprocedure('public.annvero_is_admin_or_partner()') is not null)    as admin_partner_fn_present,
    (to_regclass('public.audit_events') is not null)                         as audit_events_present
),
-- 8) 022/023 RBAC + membership nesneleri — to_regprocedure guard'li pg_get_functiondef
--    (to_regprocedure null ise pg_get_functiondef(null)=null; hata vermez.)
rbac as (
  select
    (to_regprocedure('public.annvero_jwt_role()') is not null) as jwt_role_fn_present,
    coalesce(
      to_regprocedure('public.annvero_jwt_role()') is not null
      and position('user_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_role()')::oid)) = 0
      and position('annvero_user_profiles' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_role()')::oid)) > 0,
    false) as jwt_role_secure,
    (to_regclass('public.annvero_company_members') is not null) as membership_table_present,
    (to_regprocedure('public.annvero_sync_company_membership(uuid, text[], uuid)') is not null) as sync_rpc_present,
    (to_regprocedure('public.annvero_profile_company_ids()') is not null) as profile_company_ids_fn_present,
    coalesce(
      to_regprocedure('public.annvero_jwt_company_ids()') is not null
      and position('user_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_company_ids()')::oid)) = 0
      and position('app_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_company_ids()')::oid)) = 0,
    false) as jwt_company_ids_secure
),
-- 9) Grant durumu — has_*_privilege yalniz CASE guard'i true iken degerlenir
--    (CASE kosullu-degerleme garantiler; bulunmayan tabloya cagri yapilmaz.)
grants as (
  select
    case when to_regclass('public.companies') is not null
      then coalesce(has_table_privilege('authenticated', 'public.companies', 'SELECT'), false) else false end
      as companies_authenticated_select,
    case when to_regclass('public.companies') is not null
      then coalesce(has_table_privilege('service_role', 'public.companies', 'SELECT'), false) else false end
      as companies_service_role_select,
    case when to_regclass('public.annvero_company_members') is not null
      then coalesce(has_table_privilege('service_role', 'public.annvero_company_members', 'SELECT')
        and has_table_privilege('service_role', 'public.annvero_company_members', 'INSERT')
        and has_table_privilege('service_role', 'public.annvero_company_members', 'UPDATE')
        and has_table_privilege('service_role', 'public.annvero_company_members', 'DELETE'), false)
      else false end as members_service_role_crud,
    case when to_regprocedure('public.annvero_sync_company_membership(uuid, text[], uuid)') is not null
      then coalesce(has_function_privilege('service_role', 'public.annvero_sync_company_membership(uuid, text[], uuid)', 'EXECUTE'), false)
      else false end as sync_rpc_service_role_execute,
    case when to_regprocedure('public.annvero_sync_company_membership(uuid, text[], uuid)') is not null
      then (coalesce(has_function_privilege('authenticated', 'public.annvero_sync_company_membership(uuid, text[], uuid)', 'EXECUTE'), false) = false
        and coalesce(has_function_privilege('anon', 'public.annvero_sync_company_membership(uuid, text[], uuid)', 'EXECUTE'), false) = false)
      else true end as sync_rpc_no_client_execute
)
select
  -- Cekirdek varlik
  core.companies_present, counts.companies_count,
  core.learning_memory_present, counts.learning_memory_count,
  core.profiles_present, counts.profiles_est_rowcount,
  core.members_present, counts.members_est_rowcount,
  counts.auth_users_count,
  lmpol.learning_memory_legacy_policy_count,
  core.official_notifications_present, oncols.on_has_source, oncols.on_has_served_date,
  -- 015 kismi uygulama
  sec015.can_access_fn_present, sec015.admin_partner_fn_present, sec015.audit_events_present,
  -- 023-A kolonu
  authcol.auth_user_id_present,
  -- 020
  drive.drive_tables_present_count,
  (drive.drive_tables_present_count = 4) as drive_020_applied,
  -- 022/023 nesneleri
  rbac.jwt_role_fn_present, rbac.jwt_role_secure,
  rbac.membership_table_present, rbac.sync_rpc_present,
  rbac.profile_company_ids_fn_present, rbac.jwt_company_ids_secure,
  (rbac.membership_table_present and rbac.sync_rpc_present
     and rbac.profile_company_ids_fn_present and rbac.jwt_company_ids_secure) as membership_023_applied,
  -- Grant
  grants.companies_authenticated_select, grants.companies_service_role_select,
  grants.members_service_role_crud, grants.sync_rpc_service_role_execute, grants.sync_rpc_no_client_execute,
  -- Membership gecis gereksinimi (yalniz auth.users kaynakli; guvenilmez claim rapor amaci)
  counts.users_with_untrusted_company_ids,
  -- 011/012 gereksinimi (022/023 profil tablosuna baglidir)
  (not core.profiles_present) as needs_011_012_user_profiles,
  -- Ozet karar ipucu (bilgi amacli; PASS/FAIL degil):
  case
    when rbac.membership_table_present and rbac.sync_rpc_present and rbac.jwt_company_ids_secure
      then 'ALREADY_APPLIED'
    when (not core.profiles_present)
         and drive.drive_tables_present_count = 0
         and not rbac.membership_table_present
      then 'FORWARD_ONLY_DRIVE_RBAC_REQUIRED (011,012,020,021,022,023)'
    else 'PARTIAL_REVIEW_REQUIRED'
  end as migration_state_hint
from core, counts, authcol, oncols, lmpol, drive, sec015, rbac, grants;
