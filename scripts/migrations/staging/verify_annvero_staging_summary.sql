-- ANNVERO staging doğrulama — TEK SATIR / TEK RESULT SET özet
-- Yalnızca SELECT/CTE. INSERT/UPDATE/DELETE/DDL YOKTUR.
-- Bootstrap (001 -> 023) uygulandıktan sonra Supabase SQL Editor'da çalıştırın.
-- Bu dosya SECRET içermez.

with expected(table_name) as (
  values
    ('mevzuat_parametreleri'),
    ('contact_messages'),
    ('reconciliation_matches'),
    ('learned_bank_rules'),
    ('official_notifications'),
    ('gib_check_reminders'),
    ('push_subscriptions'),
    ('company_gib_credentials'),
    ('gib_company_query_state'),
    ('gib_query_sessions'),
    ('companies'),
    ('learning_memory'),
    ('unrecognized_transactions'),
    ('mevzuat_hap_notlari'),
    ('annvero_user_profiles'),
    ('normalized_financial_transactions'),
    ('audit_events'),
    ('login_events'),
    ('company_backup_runs'),
    ('knowledge_entities'),
    ('knowledge_match_patterns'),
    ('knowledge_accounting_rules'),
    ('knowledge_company_memory'),
    ('knowledge_decision_history'),
    ('knowledge_rule_versions'),
    ('cloud_storage_connections'),
    ('company_cloud_folders'),
    ('document_index'),
    ('document_sync_events'),
    ('annvero_company_members')
),
existing as (
  select
    e.table_name,
    (t.table_name is not null) as is_present
  from expected e
  left join information_schema.tables t
    on t.table_schema = 'public'
   and t.table_name = e.table_name
),
tbl as (
  select
    (select count(*) from expected)::int as expected_table_count,
    (select count(*) from existing where is_present)::int as existing_table_count,
    (
      select coalesce(array_agg(table_name order by table_name), array[]::text[])
      from existing
      where not is_present
    ) as missing_tables
),
drive as (
  select
    count(*)::int as drive_table_count,
    count(*) filter (where c.relrowsecurity)::int as drive_rls_enabled_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'cloud_storage_connections',
      'company_cloud_folders',
      'document_index',
      'document_sync_events'
    )
),
drive_pol as (
  select count(*)::int as drive_anon_authenticated_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'cloud_storage_connections',
      'company_cloud_folders',
      'document_index',
      'document_sync_events'
    )
    and roles && array['anon','authenticated']::name[]
),
lm as (
  select count(*)::int as learning_memory_legacy_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'learning_memory'
    and policyname in (
      'allow learning memory delete',
      'allow learning memory insert',
      'allow learning memory read',
      'allow learning memory update'
    )
),
oncols as (
  select
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'official_notifications'
        and column_name = 'source'
    ) as official_notifications_has_source,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'official_notifications'
        and column_name = 'served_date'
    ) as official_notifications_has_served_date
),
seeds as (
  select
    (select count(*) from public.knowledge_entities)::int as knowledge_entities_count,
    (select count(*) from public.knowledge_match_patterns)::int as knowledge_match_patterns_count,
    (select count(*) from public.knowledge_accounting_rules)::int as knowledge_accounting_rules_count
),
grant_c as (
  -- authenticated rolü companies tablosunda SELECT hakkına sahip mi (022)
  select has_table_privilege('authenticated', 'public.companies', 'SELECT')
    as companies_authenticated_select_grant
),
rbac as (
  -- Güvenli RBAC: profil-kaynaklı rol fonksiyonu var mı ve annvero_jwt_role()
  -- artık user_metadata'ya güvenmiyor mu (022)
  select
    (to_regprocedure('public.annvero_profile_role()') is not null) as has_profile_role_fn,
    (
      to_regprocedure('public.annvero_jwt_role()') is not null
      and coalesce(
        position(
          'user_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_role()')::oid)
        ) = 0,
        false
      )
    ) as jwt_role_no_user_metadata
),
svc as (
  -- service_role sunucu API'leri için gerekli tablo yetkilerine sahip mi (022).
  select
    has_table_privilege('service_role', 'public.annvero_user_profiles', 'SELECT')
      as svc_profiles_select,
    (
          has_table_privilege('service_role', 'public.cloud_storage_connections', 'SELECT')
      and has_table_privilege('service_role', 'public.cloud_storage_connections', 'INSERT')
      and has_table_privilege('service_role', 'public.cloud_storage_connections', 'UPDATE')
      and has_table_privilege('service_role', 'public.cloud_storage_connections', 'DELETE')
      and has_table_privilege('service_role', 'public.company_cloud_folders', 'SELECT')
      and has_table_privilege('service_role', 'public.company_cloud_folders', 'INSERT')
      and has_table_privilege('service_role', 'public.company_cloud_folders', 'UPDATE')
      and has_table_privilege('service_role', 'public.company_cloud_folders', 'DELETE')
      and has_table_privilege('service_role', 'public.document_index', 'SELECT')
      and has_table_privilege('service_role', 'public.document_index', 'INSERT')
      and has_table_privilege('service_role', 'public.document_index', 'UPDATE')
      and has_table_privilege('service_role', 'public.document_index', 'DELETE')
      and has_table_privilege('service_role', 'public.document_sync_events', 'SELECT')
      and has_table_privilege('service_role', 'public.document_sync_events', 'INSERT')
      and has_table_privilege('service_role', 'public.document_sync_events', 'UPDATE')
      and has_table_privilege('service_role', 'public.document_sync_events', 'DELETE')
    ) as svc_drive_crud
),
members as (
  -- annvero_company_members (023): RLS açık + anon/authenticated policy yok
  select
    (to_regclass('public.annvero_company_members') is not null) as members_table_present,
    coalesce((
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'annvero_company_members'
    ), false) as members_rls_enabled,
    (
      select count(*)::int
      from pg_policies
      where schemaname = 'public'
        and tablename = 'annvero_company_members'
        and roles && array['anon','authenticated']::name[]
    ) as members_anon_authenticated_policy_count
),
members_grant as (
  -- anon/authenticated tablo yetkisi YOK - service_role tam CRUD
  select
    (
      not has_table_privilege('authenticated', 'public.annvero_company_members', 'SELECT')
      and not has_table_privilege('anon', 'public.annvero_company_members', 'SELECT')
    ) as members_no_client_grant,
    (
          has_table_privilege('service_role', 'public.annvero_company_members', 'SELECT')
      and has_table_privilege('service_role', 'public.annvero_company_members', 'INSERT')
      and has_table_privilege('service_role', 'public.annvero_company_members', 'UPDATE')
      and has_table_privilege('service_role', 'public.annvero_company_members', 'DELETE')
    ) as members_service_role_crud
),
backfill as (
  -- auth_user_id kolonu var + eşleşen auth kullanıcısı olan tüm profiller backfill edilmiş
  select
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'annvero_user_profiles'
        and column_name = 'auth_user_id'
    ) as profiles_has_auth_user_id,
    not exists (
      select 1
      from public.annvero_user_profiles p
      join auth.users u on lower(u.email) = lower(p.email)
      where p.auth_user_id is null
    ) as profiles_auth_user_id_backfilled
),
cidsrc as (
  -- Güvenli company_ids kaynağı (023):
  --  - annvero_profile_company_ids() var
  --  - annvero_jwt_company_ids() gövdesinde user_metadata geçmiyor + membership referansı var
  --  - annvero_profile_role() runtime kaynağı auth.uid/auth_user_id
  select
    (to_regprocedure('public.annvero_profile_company_ids()') is not null)
      as has_profile_company_ids_fn,
    (
      to_regprocedure('public.annvero_jwt_company_ids()') is not null
      and coalesce(position('user_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_company_ids()')::oid)) = 0, false)
      and coalesce(position('app_metadata' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_company_ids()')::oid)) = 0, false)
      and coalesce(position('annvero_profile_company_ids' in pg_get_functiondef(to_regprocedure('public.annvero_jwt_company_ids()')::oid)) > 0, false)
    ) as jwt_company_ids_secure,
    (
      to_regprocedure('public.annvero_profile_role()') is not null
      and coalesce(position('auth_user_id' in pg_get_functiondef(to_regprocedure('public.annvero_profile_role()')::oid)) > 0, false)
      and coalesce(position('auth.uid' in pg_get_functiondef(to_regprocedure('public.annvero_profile_role()')::oid)) > 0, false)
    ) as profile_role_uid_based
),
rpc as (
  -- Atomik membership senkron RPC (023): mevcut + yalnız service_role execute.
  select
    (to_regprocedure('public.annvero_sync_company_membership(uuid, text[], uuid)') is not null)
      as sync_rpc_present,
    coalesce(
      has_function_privilege(
        'service_role',
        'public.annvero_sync_company_membership(uuid, text[], uuid)',
        'EXECUTE'
      ),
      false
    ) as sync_rpc_service_role_execute,
    (
      coalesce(
        has_function_privilege(
          'authenticated',
          'public.annvero_sync_company_membership(uuid, text[], uuid)',
          'EXECUTE'
        ),
        false
      ) = false
      and coalesce(
        has_function_privilege(
          'anon',
          'public.annvero_sync_company_membership(uuid, text[], uuid)',
          'EXECUTE'
        ),
        false
      ) = false
    ) as sync_rpc_no_client_execute
)
select
  tbl.expected_table_count,
  tbl.existing_table_count,
  tbl.missing_tables,
  drive.drive_table_count,
  drive.drive_rls_enabled_count,
  drive_pol.drive_anon_authenticated_policy_count,
  lm.learning_memory_legacy_policy_count,
  oncols.official_notifications_has_source,
  oncols.official_notifications_has_served_date,
  seeds.knowledge_entities_count,
  seeds.knowledge_match_patterns_count,
  seeds.knowledge_accounting_rules_count,
  grant_c.companies_authenticated_select_grant,
  (rbac.has_profile_role_fn and rbac.jwt_role_no_user_metadata) as rbac_role_source_secure,
  svc.svc_profiles_select as service_role_profiles_select_grant,
  svc.svc_drive_crud as service_role_drive_crud_grant,
  (svc.svc_profiles_select and svc.svc_drive_crud) as service_role_grants_ok,
  members.members_table_present as annvero_company_members_present,
  members.members_rls_enabled as annvero_company_members_rls_enabled,
  members.members_anon_authenticated_policy_count,
  members_grant.members_no_client_grant as annvero_company_members_no_client_grant,
  members_grant.members_service_role_crud as service_role_members_crud_grant,
  backfill.profiles_has_auth_user_id,
  backfill.profiles_auth_user_id_backfilled,
  cidsrc.profile_role_uid_based,
  cidsrc.has_profile_company_ids_fn,
  cidsrc.jwt_company_ids_secure,
  (
    cidsrc.has_profile_company_ids_fn
    and cidsrc.jwt_company_ids_secure
    and cidsrc.profile_role_uid_based
  ) as company_ids_source_secure,
  rpc.sync_rpc_present,
  rpc.sync_rpc_service_role_execute,
  rpc.sync_rpc_no_client_execute,
  case
    when cardinality(tbl.missing_tables) = 0
      and drive.drive_table_count = 4
      and drive.drive_rls_enabled_count = 4
      and drive_pol.drive_anon_authenticated_policy_count = 0
      and lm.learning_memory_legacy_policy_count = 0
      and oncols.official_notifications_has_source
      and oncols.official_notifications_has_served_date
      and seeds.knowledge_entities_count = 8
      and seeds.knowledge_match_patterns_count = 10
      and seeds.knowledge_accounting_rules_count = 12
      and grant_c.companies_authenticated_select_grant
      and rbac.has_profile_role_fn
      and rbac.jwt_role_no_user_metadata
      and svc.svc_profiles_select
      and svc.svc_drive_crud
      and members.members_table_present
      and members.members_rls_enabled
      and members.members_anon_authenticated_policy_count = 0
      and members_grant.members_no_client_grant
      and members_grant.members_service_role_crud
      and backfill.profiles_has_auth_user_id
      and backfill.profiles_auth_user_id_backfilled
      and cidsrc.profile_role_uid_based
      and cidsrc.has_profile_company_ids_fn
      and cidsrc.jwt_company_ids_secure
      and rpc.sync_rpc_present
      and rpc.sync_rpc_service_role_execute
      and rpc.sync_rpc_no_client_execute
    then 'PASS'
    else 'FAIL'
  end as overall_status
from tbl, drive, drive_pol, lm, oncols, seeds, grant_c, rbac, svc,
     members, members_grant, backfill, cidsrc, rpc;
