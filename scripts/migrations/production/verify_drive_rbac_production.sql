-- ANNVERO PRODUCTION — Drive + RBAC forward-only paketi DOGRULAMA
-- YALNIZCA SELECT / KATALOG (READ-ONLY). Hicbir sey degistirmez.
-- ===========================================================================
-- UYGULAMA SIRASINDAKI YERI: atomik migration + admin onayli seed'den SONRA.
-- Tum kontroller KATALOG (to_regclass, to_regprocedure, pg_get_functiondef,
-- information_schema, pg_policies, pg_class, has_*_privilege) uzerinden yapilir;
-- boylece paket kismen uygulanmis olsa bile fail-safe calisir.
--
-- Beklenen: 'PASS' sutunlari true. Herhangi biri false ise NO-GO.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) 011/012 — annvero_user_profiles tablo + RLS + auth_user_id (023-A)
-- ---------------------------------------------------------------------------
select
  '011/012/023-A annvero_user_profiles' as check_group,
  (to_regclass('public.annvero_user_profiles') is not null) as profiles_table_present,
  (
    select coalesce(bool_or(c.relrowsecurity), false)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'annvero_user_profiles'
  ) as profiles_rls_enabled,
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'annvero_user_profiles'
      and policyname = 'annvero_user_profiles_self_read'
  ) as self_read_policy_present,
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'annvero_user_profiles'
      and policyname = 'annvero_user_profiles_service_all'
  ) as service_all_policy_present,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'annvero_user_profiles'
      and column_name = 'auth_user_id'
  ) as auth_user_id_column_present,
  exists (
    select 1 from pg_constraint
    where conname = 'annvero_user_profiles_auth_user_id_fkey'
  ) as auth_user_id_fk_present;

-- 1b) auth_user_id backfill durumu (tablo varsa guvenli sayim: reltuples degil gercek).
--     Tablo bu asamada VARDIR (migration uygulandi); yine de katalog guard'i ile guvenli.
select
  '011/012 auth_user_id backfill' as check_group,
  (
    select count(*)::bigint from public.annvero_user_profiles
  ) as profiles_rowcount,
  (
    select count(*)::bigint from public.annvero_user_profiles where auth_user_id is not null
  ) as auth_user_id_backfilled_count,
  (
    select count(*)::bigint from public.annvero_user_profiles where auth_user_id is null
  ) as auth_user_id_missing_count;

-- ---------------------------------------------------------------------------
-- 2) 020 — Google Drive / cloud_storage 4 tablo + RLS + fail-closed
-- ---------------------------------------------------------------------------
select
  '020 cloud_storage tables' as check_group,
  (
    (to_regclass('public.cloud_storage_connections') is not null)::int
    + (to_regclass('public.company_cloud_folders') is not null)::int
    + (to_regclass('public.document_index') is not null)::int
    + (to_regclass('public.document_sync_events') is not null)::int
  ) as drive_tables_present_count,
  (
    (to_regclass('public.cloud_storage_connections') is not null)
    and (to_regclass('public.company_cloud_folders') is not null)
    and (to_regclass('public.document_index') is not null)
    and (to_regclass('public.document_sync_events') is not null)
  ) as drive_020_all_present;

-- 2b) RLS acik mi? (4 tabloda true beklenir)
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'cloud_storage_connections', 'company_cloud_folders',
    'document_index', 'document_sync_events'
  )
order by c.relname;

-- 2c) Fail-closed: Drive tablolarinda anon/authenticated policy SAYISI = 0 beklenir.
select
  '020 fail-closed (0 beklenir)' as check_group,
  count(*)::int as drive_anon_authenticated_policy_count,
  (count(*) = 0) as pass_fail_closed
from pg_policies
where schemaname = 'public'
  and tablename in (
    'cloud_storage_connections', 'company_cloud_folders',
    'document_index', 'document_sync_events'
  )
  and roles && array['anon', 'authenticated']::name[];

-- ---------------------------------------------------------------------------
-- 3) 021 — learning_memory legacy public policy'leri temizlendi (0 beklenir)
-- ---------------------------------------------------------------------------
select
  '021 legacy learning_memory policy (0 beklenir)' as check_group,
  count(*)::int as legacy_learning_memory_policy_count,
  (count(*) = 0) as pass_legacy_cleaned
from pg_policies
where schemaname = 'public'
  and tablename = 'learning_memory'
  and policyname in (
    'allow learning memory delete', 'allow learning memory insert',
    'allow learning memory read', 'allow learning memory update'
  );

-- ---------------------------------------------------------------------------
-- 4) 022 — annvero_jwt_role GUVENLI (user_metadata YOK, profil tablosu VAR)
--          + companies grant (authenticated yalniz SELECT)
-- ---------------------------------------------------------------------------
select
  '022 rbac jwt_role secure' as check_group,
  (to_regprocedure('public.annvero_jwt_role()') is not null) as jwt_role_fn_present,
  coalesce(
    to_regprocedure('public.annvero_jwt_role()') is not null
    and position('user_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_role()')::oid)) = 0
    and position('annvero_profile_role' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_role()')::oid)) > 0,
  false) as jwt_role_secure,
  (to_regprocedure('public.annvero_profile_role()') is not null) as profile_role_fn_present,
  coalesce(
    to_regprocedure('public.annvero_profile_role()') is not null
    and position('auth.uid()' in pg_get_functiondef(to_regprocedure('public.annvero_profile_role()')::oid)) > 0
    and position('user_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_profile_role()')::oid)) = 0,
  false) as profile_role_uses_auth_uid,
  case when to_regclass('public.companies') is not null
    then coalesce(has_table_privilege('authenticated', 'public.companies', 'SELECT'), false) else false end
    as companies_authenticated_select,
  case when to_regclass('public.companies') is not null
    then (coalesce(has_table_privilege('authenticated', 'public.companies', 'INSERT'), false) = false
      and coalesce(has_table_privilege('authenticated', 'public.companies', 'UPDATE'), false) = false
      and coalesce(has_table_privilege('authenticated', 'public.companies', 'DELETE'), false) = false)
    else false end as companies_authenticated_no_write;

-- ---------------------------------------------------------------------------
-- 5) 023 — membership tablosu + RPC + GUVENLI company_ids + fail-closed grant
-- ---------------------------------------------------------------------------
select
  '023 membership objects' as check_group,
  (to_regclass('public.annvero_company_members') is not null) as membership_table_present,
  (
    select coalesce(bool_or(c.relrowsecurity), false)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'annvero_company_members'
  ) as membership_rls_enabled,
  (to_regprocedure('public.annvero_sync_company_membership(uuid, text[], uuid)') is not null) as sync_rpc_present,
  (to_regprocedure('public.annvero_profile_company_ids()') is not null) as profile_company_ids_fn_present,
  coalesce(
    to_regprocedure('public.annvero_jwt_company_ids()') is not null
    and position('user_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_company_ids()')::oid)) = 0
    and position('app_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_company_ids()')::oid)) = 0
    and position('annvero_profile_company_ids' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_company_ids()')::oid)) > 0,
  false) as jwt_company_ids_secure,
  coalesce(
    to_regprocedure('public.annvero_can_access_company(text)') is not null
    and position('user_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_can_access_company(text)')::oid)) = 0
    and position('annvero_jwt_company_ids' in pg_get_functiondef(to_regprocedure('public.annvero_can_access_company(text)')::oid)) > 0,
  false) as can_access_secure;

-- 5b) 023 grant / fail-closed dogrulama
select
  '023 grants / fail-closed' as check_group,
  case when to_regclass('public.annvero_company_members') is not null
    then coalesce(has_table_privilege('service_role', 'public.annvero_company_members', 'SELECT')
      and has_table_privilege('service_role', 'public.annvero_company_members', 'INSERT')
      and has_table_privilege('service_role', 'public.annvero_company_members', 'UPDATE')
      and has_table_privilege('service_role', 'public.annvero_company_members', 'DELETE'), false)
    else false end as members_service_role_crud,
  case when to_regclass('public.annvero_company_members') is not null
    then (coalesce(has_table_privilege('authenticated', 'public.annvero_company_members', 'SELECT'), false) = false
      and coalesce(has_table_privilege('anon', 'public.annvero_company_members', 'SELECT'), false) = false)
    else false end as members_no_client_select,
  case when to_regprocedure('public.annvero_sync_company_membership(uuid, text[], uuid)') is not null
    then coalesce(has_function_privilege('service_role', 'public.annvero_sync_company_membership(uuid, text[], uuid)', 'EXECUTE'), false)
    else false end as sync_rpc_service_role_execute,
  case when to_regprocedure('public.annvero_sync_company_membership(uuid, text[], uuid)') is not null
    then (coalesce(has_function_privilege('authenticated', 'public.annvero_sync_company_membership(uuid, text[], uuid)', 'EXECUTE'), false) = false
      and coalesce(has_function_privilege('anon', 'public.annvero_sync_company_membership(uuid, text[], uuid)', 'EXECUTE'), false) = false)
    else true end as sync_rpc_no_client_execute;

-- ---------------------------------------------------------------------------
-- 6) Mevcut 12 production tablosu KORUNDU mu? (hepsi true beklenir — veri kaybi kontrolu)
-- ---------------------------------------------------------------------------
with expected(table_name) as (
  values
    ('audit_events'), ('companies'), ('company_backup_runs'),
    ('knowledge_accounting_rules'), ('knowledge_company_memory'),
    ('knowledge_decision_history'), ('knowledge_entities'),
    ('knowledge_match_patterns'), ('knowledge_rule_versions'),
    ('learning_memory'), ('login_events'), ('unrecognized_transactions')
)
select
  e.table_name,
  (to_regclass('public.' || e.table_name) is not null) as still_present
from expected e
order by e.table_name;

-- ---------------------------------------------------------------------------
-- 7) Membership seed sonrasi ozet (admin onayli seed sonrasi anlamlidir).
--    Tablolar VAR oldugundan statik referans guvenli.
-- ---------------------------------------------------------------------------
select
  '023 membership seed ozet' as check_group,
  (select count(*)::bigint from public.annvero_company_members) as total_membership_rows,
  (select count(*)::bigint from public.annvero_company_members where is_active) as active_membership_rows,
  (select count(distinct user_id)::bigint from public.annvero_company_members where is_active) as users_with_active_membership;

-- ---------------------------------------------------------------------------
-- 7b) ADMIN ONAYLI profil dogrulama (yusufozlu@gmail.com / a46284eb-...).
--     Beklenen: bu auth user id icin TAM (aktif + admin) TEK profil; mukerrer yok;
--     admin icin membership ZORUNLU DEGIL (0 satir normaldir).
-- ---------------------------------------------------------------------------
select
  '013-admin-approved profile' as check_group,
  (
    select count(*)::int from public.annvero_user_profiles
    where auth_user_id = 'a46284eb-2ee3-4be0-a33e-a166d25261a4'
  ) as profile_by_auth_uid_count,
  (
    select count(*)::int from public.annvero_user_profiles
    where auth_user_id = 'a46284eb-2ee3-4be0-a33e-a166d25261a4'
      and role = 'admin' and is_active = true
  ) as active_admin_by_auth_uid_count,
  (
    select count(*)::int from public.annvero_user_profiles
    where lower(email) = lower('yusufozlu@gmail.com')
  ) as profile_by_email_count,
  -- Mukerrer yok: her iki kimlik icin de en fazla 1 profil.
  (
    (select count(*) from public.annvero_user_profiles
       where auth_user_id = 'a46284eb-2ee3-4be0-a33e-a166d25261a4') <= 1
    and (select count(*) from public.annvero_user_profiles
       where lower(email) = lower('yusufozlu@gmail.com')) <= 1
  ) as no_duplicate_profile,
  -- Admin icin membership zorunlu degil (bilgi): 0 satir beklenir/kabul edilir.
  (
    select count(*)::int from public.annvero_company_members
    where user_id = 'a46284eb-2ee3-4be0-a33e-a166d25261a4'
  ) as admin_membership_rows_optional,
  -- PASS: tam olarak 1 aktif admin profili, auth_uid ve email icin mukerrer yok.
  (
    (select count(*) from public.annvero_user_profiles
       where auth_user_id = 'a46284eb-2ee3-4be0-a33e-a166d25261a4'
         and role = 'admin' and is_active = true) = 1
    and (select count(*) from public.annvero_user_profiles
       where auth_user_id = 'a46284eb-2ee3-4be0-a33e-a166d25261a4') = 1
    and (select count(*) from public.annvero_user_profiles
       where lower(email) = lower('yusufozlu@gmail.com')) <= 1
  ) as pass_admin_profile;

-- ---------------------------------------------------------------------------
-- 8) GENEL GO/NO-GO ozeti (tum kritik kontroller true ise GO).
-- ---------------------------------------------------------------------------
select
  case when (
    (to_regclass('public.annvero_user_profiles') is not null)
    and (to_regclass('public.annvero_company_members') is not null)
    and (to_regclass('public.cloud_storage_connections') is not null)
    and (to_regclass('public.company_cloud_folders') is not null)
    and (to_regclass('public.document_index') is not null)
    and (to_regclass('public.document_sync_events') is not null)
    and (to_regprocedure('public.annvero_sync_company_membership(uuid, text[], uuid)') is not null)
    and coalesce(
      position('user_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_company_ids()')::oid)) = 0
      and position('app_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_company_ids()')::oid)) = 0,
    false)
    and coalesce(
      position('user_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_role()')::oid)) = 0,
    false)
    and (
      select count(*) = 0 from pg_policies
      where schemaname = 'public'
        and tablename in ('cloud_storage_connections', 'company_cloud_folders', 'document_index', 'document_sync_events')
        and roles && array['anon', 'authenticated']::name[]
    )
    -- ADMIN ONAYLI profil: tam olarak 1 aktif admin profili + mukerrer yok.
    and (
      (select count(*) from public.annvero_user_profiles
         where auth_user_id = 'a46284eb-2ee3-4be0-a33e-a166d25261a4'
           and role = 'admin' and is_active = true) = 1
      and (select count(*) from public.annvero_user_profiles
         where auth_user_id = 'a46284eb-2ee3-4be0-a33e-a166d25261a4') = 1
      and (select count(*) from public.annvero_user_profiles
         where lower(email) = lower('yusufozlu@gmail.com')) <= 1
    )
  ) then 'GO — Drive + RBAC paketi + admin onayli profil dogrulandi'
    else 'NO-GO — eksik/guvensiz nesne veya admin profil sorunu var; yukaridaki kontrolleri inceleyin'
  end as overall_verify_result;
