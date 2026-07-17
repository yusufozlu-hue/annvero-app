-- ANNVERO staging doğrulama (001 -> 021 bootstrap sonrası)
-- YALNIZCA SELECT sorguları içerir; hiçbir veri yazmaz/değiştirmez.
-- Supabase SQL Editor'da bootstrap uygulandıktan sonra çalıştırın.
-- Bu dosya SECRET içermez.

-- ============================================================
-- 1) Beklenen tabloların varlığı
-- ============================================================
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
    ('document_sync_events')
)
select
  e.table_name,
  (t.table_name is not null) as exists
from expected e
left join information_schema.tables t
  on t.table_schema = 'public'
 and t.table_name = e.table_name
order by e.table_name;

-- ============================================================
-- 2) Cloud storage 4 tablosunun kolonları
-- ============================================================
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'cloud_storage_connections',
    'company_cloud_folders',
    'document_index',
    'document_sync_events'
  )
order by table_name, ordinal_position;

-- ============================================================
-- 3) Cloud storage 4 tablosunda RLS durumu (rowsecurity = true olmalı)
-- ============================================================
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'cloud_storage_connections',
    'company_cloud_folders',
    'document_index',
    'document_sync_events'
  )
order by c.relname;

-- ============================================================
-- 4) Cloud storage 4 tablosunda anon/authenticated policy var mı?
--    (Fail-closed beklenir: 0 satır dönmeli)
-- ============================================================
select
  tablename,
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'cloud_storage_connections',
    'company_cloud_folders',
    'document_index',
    'document_sync_events'
  )
  and roles && array['anon','authenticated']::name[]
order by tablename, policyname;

-- 4b) Özet sayaç (0 beklenir)
select count(*) as cloud_anon_authenticated_policy_count
from pg_policies
where schemaname = 'public'
  and tablename in (
    'cloud_storage_connections',
    'company_cloud_folders',
    'document_index',
    'document_sync_events'
  )
  and roles && array['anon','authenticated']::name[];

-- ============================================================
-- 5) learning_memory legacy public policy'leri kalmadı mı?
--    (0 satır / count = 0 beklenir)
-- ============================================================
select
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and tablename = 'learning_memory'
  and policyname in (
    'allow learning memory delete',
    'allow learning memory insert',
    'allow learning memory read',
    'allow learning memory update'
  )
order by policyname;

select count(*) as legacy_learning_memory_policy_count
from pg_policies
where schemaname = 'public'
  and tablename = 'learning_memory'
  and policyname in (
    'allow learning memory delete',
    'allow learning memory insert',
    'allow learning memory read',
    'allow learning memory update'
  );

-- ============================================================
-- 6) official_notifications canonical kolonları (source, served_date)
-- ============================================================
select
  (exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'official_notifications'
      and column_name = 'source'
  )) as has_source_column,
  (exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'official_notifications'
      and column_name = 'served_date'
  )) as has_served_date_column;

-- ============================================================
-- 7) Migration sonrası seed tablo satır sayıları
-- ============================================================
select 'knowledge_entities' as seed_table, count(*) as row_count from public.knowledge_entities
union all
select 'knowledge_match_patterns', count(*) from public.knowledge_match_patterns
union all
select 'knowledge_accounting_rules', count(*) from public.knowledge_accounting_rules
order by seed_table;
