-- ANNVERO staging tek seferlik ATOMIK bootstrap (001 -> 023)
-- Kaynak: supabase/migrations/*.sql - icerik degistirilmeden ayni sirayla birlestirildi.
-- Tek transaction: hata olursa TAMAMI geri alinir (rollback).
-- Bu dosya SECRET icermez (project ref / URL / parola / API key yoktur).
-- Uygulama: Supabase SQL Editor'da bir kez calistirin.

BEGIN;

-- ======================================================================
-- BEGIN MIGRATION: 001_mevzuat_parametreleri.sql
-- ======================================================================
-- ANNVERO mevzuat parametreleri tablosu
-- Supabase SQL Editor üzerinden çalıştırılabilir.

create table if not exists public.mevzuat_parametreleri (
  id text primary key,
  module_key text not null,
  parameter_key text not null,
  parameter_name text not null,
  year integer not null,
  period text not null default 'Yıllık',
  value text not null,
  description text,
  valid_from date,
  valid_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mevzuat_parametreleri_module
  on public.mevzuat_parametreleri (module_key, year, is_active);

create unique index if not exists uq_mevzuat_parametreleri_key
  on public.mevzuat_parametreleri (module_key, parameter_key, year, period);

alter table public.mevzuat_parametreleri enable row level security;

-- Admin kullanıcılar service role veya özel policy ile yönetir.
-- İlk kurulumda authenticated admin policy tanımlanmalıdır.

-- ---- END MIGRATION: 001_mevzuat_parametreleri.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 002_contact_messages.sql
-- ======================================================================
-- ANNVERO iletişim widget form mesajları

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  message text not null,
  source text not null default 'contact_widget',
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create index if not exists idx_contact_messages_created_at
  on public.contact_messages (created_at desc);

create index if not exists idx_contact_messages_status
  on public.contact_messages (status, created_at desc);

alter table public.contact_messages enable row level security;

-- Herkese açık iletişim formu: yalnızca yeni kayıt ekleme
create policy "contact_messages_public_insert"
  on public.contact_messages
  for insert
  to anon, authenticated
  with check (true);

-- ---- END MIGRATION: 002_contact_messages.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 003_reconciliation_matches.sql
-- ======================================================================
-- Banka mutabakat eşleşmeleri ve öğrenilen banka kuralları

create table if not exists public.reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  bank_id text,
  bank_transaction_id text,
  ledger_transaction_id text,
  match_type text,
  match_score numeric(5, 2) default 0,
  status text not null default 'matched',
  difference_amount numeric(18, 2) default 0,
  matched_by text default 'system',
  bank_snapshot jsonb,
  ledger_snapshot jsonb,
  matched_at timestamptz default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.learned_bank_rules (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  bank_id text,
  bank_description_pattern text not null,
  ledger_account_code text,
  ledger_account_name text,
  transaction_type text,
  document_type text,
  usage_count integer not null default 1,
  last_used_at timestamptz default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_reconciliation_matches_company
  on public.reconciliation_matches (company_id, created_at desc);

create index if not exists idx_learned_bank_rules_company
  on public.learned_bank_rules (company_id, usage_count desc);

alter table public.reconciliation_matches enable row level security;
alter table public.learned_bank_rules enable row level security;

create policy "reconciliation_matches_authenticated_all"
  on public.reconciliation_matches
  for all
  to authenticated, anon
  using (true)
  with check (true);

create policy "learned_bank_rules_authenticated_all"
  on public.learned_bank_rules
  for all
  to authenticated, anon
  using (true)
  with check (true);

-- ---- END MIGRATION: 003_reconciliation_matches.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 004_official_notifications.sql
-- ======================================================================
-- Resmi bildirim & tebligat takibi (GİB, SGK, UETS, KEP)

create table if not exists public.official_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  channel text not null check (channel in ('gib', 'sgk', 'uets', 'kep')),
  title text not null,
  summary text,
  reference_no text,
  notification_date date,
  status text not null default 'unread' check (status in ('unread', 'read', 'archived')),
  metadata jsonb default '{}'::jsonb,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gib_check_reminders (
  id uuid primary key default gen_random_uuid(),
  company_id text,
  enabled boolean not null default true,
  interval_days integer not null default 1 check (interval_days >= 1),
  reminder_time text not null default '09:00',
  last_check_at timestamptz,
  next_check_at timestamptz,
  push_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_official_notifications_company_channel
  on public.official_notifications (company_id, channel, created_at desc);

create index if not exists idx_official_notifications_channel_status
  on public.official_notifications (channel, status, notification_date desc);

create index if not exists idx_gib_check_reminders_company
  on public.gib_check_reminders (company_id);

alter table public.official_notifications enable row level security;
alter table public.gib_check_reminders enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "official_notifications_authenticated_all"
  on public.official_notifications
  for all
  to authenticated, anon
  using (true)
  with check (true);

create policy "gib_check_reminders_authenticated_all"
  on public.gib_check_reminders
  for all
  to authenticated, anon
  using (true)
  with check (true);

create policy "push_subscriptions_authenticated_all"
  on public.push_subscriptions
  for all
  to authenticated, anon
  using (true)
  with check (true);

-- ---- END MIGRATION: 004_official_notifications.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 005_company_gib_credentials.sql
-- ======================================================================
-- Firma bazlı GİB kimlik bilgileri (şifreler şifreli saklanır)

create table if not exists public.company_gib_credentials (
  id uuid primary key default gen_random_uuid(),
  company_id text not null unique,
  gib_user_code text not null,
  encrypted_password text not null,
  encrypted_parola text,
  is_active boolean not null default true,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gib_company_query_state (
  company_id text primary key,
  last_query_at timestamptz,
  result_status text,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists public.gib_query_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  status text not null default 'awaiting_verification',
  result_status text,
  storage_state jsonb,
  captcha_image_base64 text,
  error_message text,
  scraped_notifications jsonb default '[]'::jsonb,
  new_notification_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists idx_gib_query_sessions_company
  on public.gib_query_sessions (company_id, created_at desc);

create index if not exists idx_gib_query_sessions_expires
  on public.gib_query_sessions (expires_at);

alter table public.company_gib_credentials enable row level security;
alter table public.gib_company_query_state enable row level security;
alter table public.gib_query_sessions enable row level security;

create policy "company_gib_credentials_authenticated_all"
  on public.company_gib_credentials
  for all
  to authenticated, anon
  using (true)
  with check (true);

create policy "gib_company_query_state_authenticated_all"
  on public.gib_company_query_state
  for all
  to authenticated, anon
  using (true)
  with check (true);

create policy "gib_query_sessions_authenticated_all"
  on public.gib_query_sessions
  for all
  to authenticated, anon
  using (true)
  with check (true);

-- ---- END MIGRATION: 005_company_gib_credentials.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 006_official_notifications_table.sql
-- ======================================================================
-- official_notifications — idempotent uyumluluk migration'ı (canonical: source şeması)
-- - 004 hiç çalışmadıysa: canonical tabloyu tek başına oluşturur.
-- - 004 daha önce çalıştıysa (channel şeması): eksik kolonları ekler ve
--   channel değerlerini source'a güvenli taşır.
-- - Boş veya dolu tabloda hata vermez. Veri silmez / drop table yapmaz.

-- 1) Canonical tablo yoksa oluştur (source başlangıçta nullable — backfill için).
create table if not exists public.official_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  source text,
  notification_type text not null default 'tebligat',
  title text not null,
  reference_no text,
  served_date date,
  due_date date,
  status text not null default 'unread',
  priority text not null default 'normal',
  description text,
  file_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) 006'nın gerektirdiği kolonları garanti et (004'ten geliniyorsa eksikleri ekler).
alter table public.official_notifications
  add column if not exists source text,
  add column if not exists notification_type text not null default 'tebligat',
  add column if not exists served_date date,
  add column if not exists due_date date,
  add column if not exists priority text not null default 'normal',
  add column if not exists description text,
  add column if not exists file_url text;

-- 3) 004 (channel/notification_date) şemasından güvenli veri taşıma.
do $$
begin
  -- channel -> source (source boşsa)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'official_notifications'
      and column_name = 'channel'
  ) then
    execute $sql$
      update public.official_notifications
      set source = channel
      where source is null and channel is not null
    $sql$;
  end if;

  -- notification_date -> served_date (served_date boşsa) — veri kaybı yok
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'official_notifications'
      and column_name = 'notification_date'
  ) then
    execute $sql$
      update public.official_notifications
      set served_date = notification_date
      where served_date is null and notification_date is not null
    $sql$;
  end if;
end $$;

-- 4) source için gib/sgk/uets/kep kontrolünü koru (null'a toleranslı, idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'official_notifications_source_check'
      and conrelid = 'public.official_notifications'::regclass
  ) then
    if not exists (
      select 1 from public.official_notifications
      where source is not null
        and source not in ('gib', 'sgk', 'uets', 'kep')
    ) then
      execute $sql$
        alter table public.official_notifications
          add constraint official_notifications_source_check
          check (source is null or source in ('gib', 'sgk', 'uets', 'kep'))
      $sql$;
    else
      raise notice '006: source check atlandı — geçersiz mevcut source değerleri var';
    end if;
  end if;
end $$;

-- 5) 006 şemasının gerektirdiği indexler.
create index if not exists idx_official_notifications_company_source
  on public.official_notifications (company_id, source, created_at desc);

create index if not exists idx_official_notifications_source_status
  on public.official_notifications (source, status, served_date desc);

create index if not exists idx_official_notifications_company_reference
  on public.official_notifications (company_id, reference_no);

create index if not exists idx_official_notifications_served_date
  on public.official_notifications (served_date desc nulls last);

-- 6) updated_at trigger.
create or replace function public.official_notifications_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_official_notifications_set_updated_at on public.official_notifications;

create trigger trg_official_notifications_set_updated_at
before update on public.official_notifications
for each row
execute function public.official_notifications_set_updated_at();

-- 7) RLS aç + geçici açık policy (015 daha sonra sıkılaştırılmış policy'lerle değiştirir).
alter table public.official_notifications enable row level security;

drop policy if exists "official_notifications_authenticated_all" on public.official_notifications;

create policy "official_notifications_authenticated_all"
  on public.official_notifications
  for all
  to authenticated, anon
  using (true)
  with check (true);

comment on table public.official_notifications is
  'Resmi bildirim ve tebligat kayıtları (GİB, SGK, UETS, KEP). Canonical şema: source.';

comment on column public.official_notifications.source is
  'Bildirim kaynağı: gib | sgk | uets | kep';

-- ---- END MIGRATION: 006_official_notifications_table.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 007_companies_table.sql
-- ======================================================================
-- Firma ana kayıt tablosu (CompanyManagement / firma yönetimi)
-- Not: Tablo yoksa Supabase SQL Editor'da bu dosyayı çalıştırın.

create table if not exists public.companies (
  id text primary key,
  company_name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_companies_company_name
  on public.companies (company_name);

create index if not exists idx_companies_updated_at
  on public.companies (updated_at desc);

create index if not exists idx_companies_created_at
  on public.companies (created_at asc);

create or replace function public.companies_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_companies_set_updated_at on public.companies;

create trigger trg_companies_set_updated_at
before update on public.companies
for each row
execute function public.companies_set_updated_at();

alter table public.companies enable row level security;

drop policy if exists "companies_authenticated_all" on public.companies;

create policy "companies_authenticated_all"
  on public.companies
  for all
  to authenticated, anon
  using (true)
  with check (true);

comment on table public.companies is
  'Firma ana kayıtları. Detay alanları data jsonb içinde saklanır.';

comment on column public.companies.id is
  'Firma UUID (company_gib_credentials.company_id ile eşleşir)';

comment on column public.companies.company_name is
  'Firma adı (liste ve arama için denormalize)';

comment on column public.companies.data is
  'Firma detayları: iletişim, banka, modüller, personel vb.';

-- ---- END MIGRATION: 007_companies_table.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 007a_learning_memory_base.sql
-- ======================================================================
-- ANNVERO learning_memory taban şeması (production'dan doğrulanan)
-- Bu dosya boş projede 008/009'dan ÖNCE tabloyu garanti eder.
-- 008 ve 009 ek kolonları (add column if not exists) ekler.
-- 015 deleted_at/deleted_by kolonlarını ve authenticated policy'lerini ekler.
-- Not: Burada anon/public erişim policy'si OLUŞTURULMAZ (fail-closed).

create table if not exists public.learning_memory (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  keyword text not null,
  account_code text,
  account_name text,
  counter_account_code text,
  counter_account_name text,
  document_type text,
  transaction_type text,
  description_format text,
  source_module text default 'manual',
  usage_count integer default 0,
  is_active boolean default true,
  last_used_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_learning_memory_company_id
  on public.learning_memory (company_id);

create index if not exists idx_learning_memory_keyword
  on public.learning_memory (keyword);

alter table public.learning_memory enable row level security;

-- ---- END MIGRATION: 007a_learning_memory_base.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 008_transaction_memory.sql
-- ======================================================================
-- İşlem Hafızası / Tanınmayan işlem kuyruğu
-- Öğrenilen kurallar learning_memory tablosuna yazılır.

create table if not exists public.unrecognized_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  source_module text not null default 'banka',
  source_bank text,
  source_row_id text,
  transaction_date text,
  amount numeric,
  direction text,
  raw_description text not null default '',
  clean_description text not null default '',
  keyword text not null default '',
  transaction_type text,
  suggested_account_code text,
  suggested_account_name text,
  suggested_document_type text,
  suggested_cari text,
  suggested_memory_id uuid,
  suggestion_score numeric,
  account_code text,
  account_name text,
  document_type text,
  cari_name text,
  status text not null default 'pending',
  user_correction text,
  learned_memory_id uuid,
  learned_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_unrecognized_transactions_company_status
  on public.unrecognized_transactions (company_id, status, created_at desc);

create index if not exists idx_unrecognized_transactions_keyword
  on public.unrecognized_transactions (company_id, keyword);

create index if not exists idx_unrecognized_transactions_fingerprint
  on public.unrecognized_transactions (company_id, source_row_id)
  where status = 'pending';

alter table public.unrecognized_transactions enable row level security;

create policy "unrecognized_transactions_authenticated_all"
  on public.unrecognized_transactions
  for all
  to authenticated, anon
  using (true)
  with check (true);

-- learning_memory genişletme (varsa atlanır)
alter table public.learning_memory
  add column if not exists raw_description text,
  add column if not exists clean_description text,
  add column if not exists cari_name text,
  add column if not exists user_correction text,
  add column if not exists learned_at timestamptz;

-- ---- END MIGRATION: 008_transaction_memory.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 009_learning_memory_match_usage.sql
-- ======================================================================
-- Öğrenen Hafıza ikinci aşama: otomatik eşleşme ve kullanım metrikleri
alter table public.learning_memory
  add column if not exists bank_name text,
  add column if not exists amount numeric,
  add column if not exists status text not null default 'active',
  add column if not exists match_count integer not null default 0,
  add column if not exists last_matched_at timestamptz;

create index if not exists idx_learning_memory_company_status
  on public.learning_memory (company_id, status);

create index if not exists idx_learning_memory_bank_name
  on public.learning_memory (company_id, bank_name);

-- ---- END MIGRATION: 009_learning_memory_match_usage.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 010_mevzuat_hap_notlari.sql
-- ======================================================================
-- Mevzuat Hap Notları modülü

create table if not exists public.mevzuat_hap_notlari (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text not null default 'Diğer' check (
    source in (
      'GİB',
      'SGK',
      'Resmî Gazete',
      'TÜRMOB',
      'İSMMMO',
      'Ticaret Bakanlığı',
      'TCMB',
      'KOSGEB',
      'Diğer'
    )
  ),
  source_url text,
  category text not null default 'Diğer' check (
    category in (
      'Vergi',
      'SGK',
      'E-Belge',
      'Teşvik',
      'Ticaret',
      'Finans',
      'Diğer'
    )
  ),
  summary text not null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_pinned boolean not null default false,
  is_active boolean not null default true
);

create index if not exists idx_mevzuat_hap_notlari_active_order
  on public.mevzuat_hap_notlari (is_active, is_pinned desc, published_at desc);

create index if not exists idx_mevzuat_hap_notlari_category
  on public.mevzuat_hap_notlari (category, published_at desc);

create index if not exists idx_mevzuat_hap_notlari_source
  on public.mevzuat_hap_notlari (source, published_at desc);

create or replace function public.mevzuat_hap_notlari_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mevzuat_hap_notlari_set_updated_at on public.mevzuat_hap_notlari;

create trigger trg_mevzuat_hap_notlari_set_updated_at
before update on public.mevzuat_hap_notlari
for each row
execute function public.mevzuat_hap_notlari_set_updated_at();

alter table public.mevzuat_hap_notlari enable row level security;

drop policy if exists "mevzuat_hap_notlari_public_read" on public.mevzuat_hap_notlari;
drop policy if exists "mevzuat_hap_notlari_authenticated_write" on public.mevzuat_hap_notlari;

create policy "mevzuat_hap_notlari_public_read"
  on public.mevzuat_hap_notlari
  for select
  to authenticated, anon
  using (true);

create policy "mevzuat_hap_notlari_authenticated_write"
  on public.mevzuat_hap_notlari
  for all
  to authenticated
  using (true)
  with check (true);

comment on table public.mevzuat_hap_notlari is
  'Vergi, SGK ve mali mevzuat duyuruları için kısa hap not kayıtları.';

-- ---- END MIGRATION: 010_mevzuat_hap_notlari.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 011_annvero_user_profiles.sql
-- ======================================================================
-- ANNVERO kullanıcı profilleri, firma erişimi ve modül yetkileri
-- auth.users ile e-posta üzerinden eşleşir; id login sonrası güncellenir.

create table if not exists public.annvero_user_profiles (
  id text primary key,
  email text not null unique,
  display_name text not null default '',
  role text not null default 'muhasebe_personeli',
  permissions jsonb not null default '[]'::jsonb,
  company_ids jsonb not null default '[]'::jsonb,
  team_id text not null default '',
  is_active boolean not null default true,
  password_reset_requested_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_annvero_user_profiles_email
  on public.annvero_user_profiles (lower(email));

create index if not exists idx_annvero_user_profiles_role
  on public.annvero_user_profiles (role);

create index if not exists idx_annvero_user_profiles_active
  on public.annvero_user_profiles (is_active);

create or replace function public.annvero_user_profiles_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_annvero_user_profiles_set_updated_at on public.annvero_user_profiles;

create trigger trg_annvero_user_profiles_set_updated_at
before update on public.annvero_user_profiles
for each row
execute function public.annvero_user_profiles_set_updated_at();

alter table public.annvero_user_profiles enable row level security;

drop policy if exists "annvero_user_profiles_authenticated_read" on public.annvero_user_profiles;

create policy "annvero_user_profiles_authenticated_read"
  on public.annvero_user_profiles
  for select
  to authenticated
  using (true);

comment on table public.annvero_user_profiles is
  'ANNVERO RBAC profilleri. company_ids boş = tüm firmalar (admin/partner).';

-- ---- END MIGRATION: 011_annvero_user_profiles.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 012_annvero_user_profiles_rls.sql
-- ======================================================================
-- Strengthen annvero_user_profiles access:
-- - authenticated users read only their own row (by email)
-- - service_role keeps full access for server-side profile APIs

alter table public.annvero_user_profiles enable row level security;

drop policy if exists "annvero_user_profiles_authenticated_read" on public.annvero_user_profiles;
drop policy if exists "annvero_user_profiles_self_read" on public.annvero_user_profiles;
drop policy if exists "annvero_user_profiles_service_all" on public.annvero_user_profiles;

create policy "annvero_user_profiles_self_read"
  on public.annvero_user_profiles
  for select
  to authenticated
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "annvero_user_profiles_service_all"
  on public.annvero_user_profiles
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.annvero_user_profiles is
  'ANNVERO RBAC profilleri. Server API service_role ile yazar; kullanıcı kendi satırını okuyabilir.';

-- ---- END MIGRATION: 012_annvero_user_profiles_rls.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 013_bootstrap_owner_admin.sql
-- ======================================================================
-- Kurulum sahibi: yusufozlu@gmail.com → admin rolü
-- company_ids boş = tüm firmalara erişim (admin/partner kuralı)

update public.annvero_user_profiles
set
  role = 'admin',
  permissions = '["view","edit","export","approve","admin"]'::jsonb,
  company_ids = '[]'::jsonb,
  is_active = true,
  updated_at = now()
where lower(email) = lower('yusufozlu@gmail.com');

-- ---- END MIGRATION: 013_bootstrap_owner_admin.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 014_normalized_financial_transactions.sql
-- ======================================================================
-- Banka & Kart Operasyon Merkezi — ortak finansal hareket tablosu
-- Mevcut learning_memory / unrecognized_transactions akışını bozmaz.

create table if not exists public.normalized_financial_transactions (
  id text primary key,
  company_id text not null default '',
  source_type text not null default 'bank',
  source_name text not null default '',
  bank_name text not null default '',
  account_no text not null default '',
  card_no_masked text not null default '',
  currency text not null default 'TRY',
  transaction_date text not null default '',
  description_raw text not null default '',
  description_normalized text not null default '',
  debit_amount numeric not null default 0,
  credit_amount numeric not null default 0,
  balance numeric,
  transaction_type text not null default 'DIGER',
  counterparty_name text not null default '',
  iban text not null default '',
  document_no text not null default '',
  source_file_name text not null default '',
  source_file_type text not null default 'xlsx',
  parser_name text not null default '',
  recognition_status text not null default 'unknown',
  suggested_account_code text not null default '',
  suggested_counter_account_code text not null default '',
  suggested_cari text not null default '',
  suggested_document_type text not null default 'DK',
  confidence_score numeric not null default 0,
  risk_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_nft_company_status
  on public.normalized_financial_transactions (company_id, recognition_status, transaction_date);

create index if not exists idx_nft_bank_date
  on public.normalized_financial_transactions (bank_name, transaction_date);

create index if not exists idx_nft_source_type
  on public.normalized_financial_transactions (source_type, company_id);

create index if not exists idx_nft_document_no
  on public.normalized_financial_transactions (company_id, document_no)
  where document_no <> '';

alter table public.normalized_financial_transactions enable row level security;

drop policy if exists "nft_authenticated_all" on public.normalized_financial_transactions;

create policy "nft_authenticated_all"
  on public.normalized_financial_transactions
  for all
  to authenticated, anon
  using (true)
  with check (true);

comment on table public.normalized_financial_transactions is
  'Banka & Kart Operasyon Merkezi ortak finansal hareket modeli. source_type: bank|credit_card|pos|cash|other.';

-- ---- END MIGRATION: 014_normalized_financial_transactions.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 015_security_phase1.sql
-- ======================================================================
-- ANNVERO Güvenlik Faz 1 (production-safe)
-- RLS sıkılaştırma, audit_events, soft delete altyapısı
-- Olmayan tablolar atlanır; migration yarıda kesilmez.

-- ---------------------------------------------------------------------------
-- JWT yardımcı fonksiyonları (her zaman güvenli)
-- ---------------------------------------------------------------------------

create or replace function public.annvero_jwt_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'annvero_role', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'role', ''),
    ''
  );
$$;

create or replace function public.annvero_jwt_company_ids()
returns text[]
language sql
stable
as $$
  select coalesce(
    array(
      select jsonb_array_elements_text(
        coalesce(auth.jwt() -> 'user_metadata' -> 'company_ids', '[]'::jsonb)
      )
    ),
    array[]::text[]
  );
$$;

create or replace function public.annvero_is_authenticated()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null;
$$;

create or replace function public.annvero_is_admin_or_partner()
returns boolean
language sql
stable
as $$
  select public.annvero_jwt_role() in ('admin', 'partner');
$$;

create or replace function public.annvero_is_management()
returns boolean
language sql
stable
as $$
  select public.annvero_jwt_role() in ('admin', 'partner', 'mudur');
$$;

create or replace function public.annvero_can_access_company(target_company_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  role text;
  ids text[];
begin
  if auth.uid() is null then
    return false;
  end if;

  if target_company_id is null or btrim(target_company_id) = '' then
    return false;
  end if;

  role := public.annvero_jwt_role();

  if role in ('admin', 'partner') then
    return true;
  end if;

  ids := public.annvero_jwt_company_ids();

  if coalesce(array_length(ids, 1), 0) = 0 then
    return false;
  end if;

  return target_company_id = any(ids);
end;
$$;

comment on function public.annvero_can_access_company(text) is
  'JWT user_metadata annvero_role + company_ids ile firma erişim kontrolü.';

-- ---------------------------------------------------------------------------
-- Audit events (yoksa oluştur — her zaman güvenli)
-- ---------------------------------------------------------------------------

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null default '',
  actor_email text not null default '',
  company_id text not null default '',
  entity_type text not null,
  entity_id text not null default '',
  action text not null,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_company_created
  on public.audit_events (company_id, created_at desc);

create index if not exists idx_audit_events_entity
  on public.audit_events (entity_type, entity_id, created_at desc);

create index if not exists idx_audit_events_actor
  on public.audit_events (actor_email, created_at desc);

alter table public.audit_events enable row level security;

drop policy if exists "audit_events_select_scoped" on public.audit_events;

create policy "audit_events_select_scoped"
  on public.audit_events
  for select
  to authenticated
  using (
    public.annvero_is_admin_or_partner()
    or (
      company_id <> ''
      and public.annvero_can_access_company(company_id)
    )
  );

comment on table public.audit_events is
  'ANNVERO merkezi audit log — yazma service_role API üzerinden.';

-- ---------------------------------------------------------------------------
-- Tablo bazlı: soft delete + eski policy drop + RLS + yeni policy
-- ---------------------------------------------------------------------------

-- companies
do $$
begin
  if to_regclass('public.companies') is null then
    raise notice '015 skip: public.companies yok';
    return;
  end if;

  execute $sql$
    alter table public.companies
      add column if not exists deleted_at timestamptz,
      add column if not exists deleted_by text
  $sql$;

  execute 'create index if not exists idx_companies_deleted_at on public.companies (deleted_at) where deleted_at is not null';

  execute 'drop policy if exists "companies_authenticated_all" on public.companies';
  execute 'drop policy if exists "companies_select_authenticated" on public.companies';
  execute 'drop policy if exists "companies_insert_management" on public.companies';
  execute 'drop policy if exists "companies_update_authenticated" on public.companies';

  execute 'alter table public.companies enable row level security';

  execute $sql$
    create policy "companies_select_authenticated"
      on public.companies
      for select
      to authenticated
      using (
        public.annvero_can_access_company(id)
        and deleted_at is null
      )
  $sql$;

  execute $sql$
    create policy "companies_insert_management"
      on public.companies
      for insert
      to authenticated
      with check (public.annvero_is_management())
  $sql$;

  execute $sql$
    create policy "companies_update_authenticated"
      on public.companies
      for update
      to authenticated
      using (public.annvero_can_access_company(id))
      with check (public.annvero_can_access_company(id))
  $sql$;
end $$;

-- normalized_financial_transactions
do $$
begin
  if to_regclass('public.normalized_financial_transactions') is null then
    raise notice '015 skip: public.normalized_financial_transactions yok';
    return;
  end if;

  execute $sql$
    alter table public.normalized_financial_transactions
      add column if not exists deleted_at timestamptz,
      add column if not exists deleted_by text
  $sql$;

  execute 'drop policy if exists "nft_authenticated_all" on public.normalized_financial_transactions';
  execute 'drop policy if exists "nft_select_authenticated" on public.normalized_financial_transactions';
  execute 'drop policy if exists "nft_insert_authenticated" on public.normalized_financial_transactions';
  execute 'drop policy if exists "nft_update_authenticated" on public.normalized_financial_transactions';

  execute 'alter table public.normalized_financial_transactions enable row level security';

  execute $sql$
    create policy "nft_select_authenticated"
      on public.normalized_financial_transactions
      for select
      to authenticated
      using (
        public.annvero_can_access_company(company_id)
        and deleted_at is null
      )
  $sql$;

  execute $sql$
    create policy "nft_insert_authenticated"
      on public.normalized_financial_transactions
      for insert
      to authenticated
      with check (public.annvero_can_access_company(company_id))
  $sql$;

  execute $sql$
    create policy "nft_update_authenticated"
      on public.normalized_financial_transactions
      for update
      to authenticated
      using (public.annvero_can_access_company(company_id))
      with check (public.annvero_can_access_company(company_id))
  $sql$;
end $$;

-- unrecognized_transactions (008 — production'da olmayabilir)
do $$
begin
  if to_regclass('public.unrecognized_transactions') is null then
    raise notice '015 skip: public.unrecognized_transactions yok (008_transaction_memory.sql)';
    return;
  end if;

  execute $sql$
    alter table public.unrecognized_transactions
      add column if not exists deleted_at timestamptz,
      add column if not exists deleted_by text
  $sql$;

  execute 'drop policy if exists "unrecognized_transactions_authenticated_all" on public.unrecognized_transactions';
  execute 'drop policy if exists "unrecognized_select_authenticated" on public.unrecognized_transactions';
  execute 'drop policy if exists "unrecognized_insert_authenticated" on public.unrecognized_transactions';
  execute 'drop policy if exists "unrecognized_update_authenticated" on public.unrecognized_transactions';

  execute 'alter table public.unrecognized_transactions enable row level security';

  execute $sql$
    create policy "unrecognized_select_authenticated"
      on public.unrecognized_transactions
      for select
      to authenticated
      using (
        public.annvero_can_access_company(company_id)
        and deleted_at is null
      )
  $sql$;

  execute $sql$
    create policy "unrecognized_insert_authenticated"
      on public.unrecognized_transactions
      for insert
      to authenticated
      with check (public.annvero_can_access_company(company_id))
  $sql$;

  execute $sql$
    create policy "unrecognized_update_authenticated"
      on public.unrecognized_transactions
      for update
      to authenticated
      using (public.annvero_can_access_company(company_id))
      with check (public.annvero_can_access_company(company_id))
  $sql$;
end $$;

-- reconciliation_matches
do $$
begin
  if to_regclass('public.reconciliation_matches') is null then
    raise notice '015 skip: public.reconciliation_matches yok';
    return;
  end if;

  execute $sql$
    alter table public.reconciliation_matches
      add column if not exists deleted_at timestamptz,
      add column if not exists deleted_by text
  $sql$;

  execute 'drop policy if exists "reconciliation_matches_authenticated_all" on public.reconciliation_matches';
  execute 'drop policy if exists "reconciliation_select_authenticated" on public.reconciliation_matches';
  execute 'drop policy if exists "reconciliation_insert_authenticated" on public.reconciliation_matches';
  execute 'drop policy if exists "reconciliation_update_authenticated" on public.reconciliation_matches';

  execute 'alter table public.reconciliation_matches enable row level security';

  execute $sql$
    create policy "reconciliation_select_authenticated"
      on public.reconciliation_matches
      for select
      to authenticated
      using (
        public.annvero_can_access_company(company_id)
        and deleted_at is null
      )
  $sql$;

  execute $sql$
    create policy "reconciliation_insert_authenticated"
      on public.reconciliation_matches
      for insert
      to authenticated
      with check (public.annvero_can_access_company(company_id))
  $sql$;

  execute $sql$
    create policy "reconciliation_update_authenticated"
      on public.reconciliation_matches
      for update
      to authenticated
      using (public.annvero_can_access_company(company_id))
      with check (public.annvero_can_access_company(company_id))
  $sql$;
end $$;

-- learned_bank_rules
do $$
begin
  if to_regclass('public.learned_bank_rules') is null then
    raise notice '015 skip: public.learned_bank_rules yok';
    return;
  end if;

  execute $sql$
    alter table public.learned_bank_rules
      add column if not exists deleted_at timestamptz,
      add column if not exists deleted_by text
  $sql$;

  execute 'drop policy if exists "learned_bank_rules_authenticated_all" on public.learned_bank_rules';
  execute 'drop policy if exists "learned_bank_rules_select_authenticated" on public.learned_bank_rules';
  execute 'drop policy if exists "learned_bank_rules_insert_authenticated" on public.learned_bank_rules';
  execute 'drop policy if exists "learned_bank_rules_update_authenticated" on public.learned_bank_rules';

  execute 'alter table public.learned_bank_rules enable row level security';

  execute $sql$
    create policy "learned_bank_rules_select_authenticated"
      on public.learned_bank_rules
      for select
      to authenticated
      using (
        public.annvero_can_access_company(company_id)
        and deleted_at is null
      )
  $sql$;

  execute $sql$
    create policy "learned_bank_rules_insert_authenticated"
      on public.learned_bank_rules
      for insert
      to authenticated
      with check (public.annvero_can_access_company(company_id))
  $sql$;

  execute $sql$
    create policy "learned_bank_rules_update_authenticated"
      on public.learned_bank_rules
      for update
      to authenticated
      using (public.annvero_can_access_company(company_id))
      with check (public.annvero_can_access_company(company_id))
  $sql$;
end $$;

-- learning_memory (önceden manuel kurulmuş olabilir)
do $$
begin
  if to_regclass('public.learning_memory') is null then
    raise notice '015 skip: public.learning_memory yok';
    return;
  end if;

  execute $sql$
    alter table public.learning_memory
      add column if not exists deleted_at timestamptz,
      add column if not exists deleted_by text
  $sql$;

  execute 'drop policy if exists "learning_memory_authenticated_all" on public.learning_memory';
  execute 'drop policy if exists "learning_memory_select_authenticated" on public.learning_memory';
  execute 'drop policy if exists "learning_memory_insert_authenticated" on public.learning_memory';
  execute 'drop policy if exists "learning_memory_update_authenticated" on public.learning_memory';
  -- Legacy production public policy'leri (varsa) temizle
  execute 'drop policy if exists "allow learning memory delete" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory insert" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory read" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory update" on public.learning_memory';

  execute 'alter table public.learning_memory enable row level security';

  execute $sql$
    create policy "learning_memory_select_authenticated"
      on public.learning_memory
      for select
      to authenticated
      using (
        public.annvero_can_access_company(company_id)
        and deleted_at is null
      )
  $sql$;

  execute $sql$
    create policy "learning_memory_insert_authenticated"
      on public.learning_memory
      for insert
      to authenticated
      with check (public.annvero_can_access_company(company_id))
  $sql$;

  execute $sql$
    create policy "learning_memory_update_authenticated"
      on public.learning_memory
      for update
      to authenticated
      using (public.annvero_can_access_company(company_id))
      with check (public.annvero_can_access_company(company_id))
  $sql$;
end $$;

-- official_notifications
do $$
begin
  if to_regclass('public.official_notifications') is null then
    raise notice '015 skip: public.official_notifications yok';
    return;
  end if;

  execute 'drop policy if exists "official_notifications_authenticated_all" on public.official_notifications';
  execute 'drop policy if exists "official_notifications_select_authenticated" on public.official_notifications';
  execute 'drop policy if exists "official_notifications_insert_authenticated" on public.official_notifications';
  execute 'drop policy if exists "official_notifications_update_authenticated" on public.official_notifications';

  execute 'alter table public.official_notifications enable row level security';

  execute $sql$
    create policy "official_notifications_select_authenticated"
      on public.official_notifications
      for select
      to authenticated
      using (public.annvero_can_access_company(company_id))
  $sql$;

  execute $sql$
    create policy "official_notifications_insert_authenticated"
      on public.official_notifications
      for insert
      to authenticated
      with check (public.annvero_can_access_company(company_id))
  $sql$;

  execute $sql$
    create policy "official_notifications_update_authenticated"
      on public.official_notifications
      for update
      to authenticated
      using (public.annvero_can_access_company(company_id))
      with check (public.annvero_can_access_company(company_id))
  $sql$;
end $$;

-- gib_check_reminders
do $$
begin
  if to_regclass('public.gib_check_reminders') is null then
    raise notice '015 skip: public.gib_check_reminders yok';
    return;
  end if;

  execute 'drop policy if exists "gib_check_reminders_authenticated_all" on public.gib_check_reminders';
  execute 'drop policy if exists "gib_check_reminders_select_authenticated" on public.gib_check_reminders';
  execute 'drop policy if exists "gib_check_reminders_write_authenticated" on public.gib_check_reminders';

  execute 'alter table public.gib_check_reminders enable row level security';

  execute $sql$
    create policy "gib_check_reminders_select_authenticated"
      on public.gib_check_reminders
      for select
      to authenticated
      using (
        company_id is null
        or public.annvero_can_access_company(company_id)
      )
  $sql$;

  execute $sql$
    create policy "gib_check_reminders_write_authenticated"
      on public.gib_check_reminders
      for all
      to authenticated
      using (
        company_id is null
        or public.annvero_can_access_company(company_id)
      )
      with check (
        company_id is null
        or public.annvero_can_access_company(company_id)
      )
  $sql$;
end $$;

-- push_subscriptions
do $$
begin
  if to_regclass('public.push_subscriptions') is null then
    raise notice '015 skip: public.push_subscriptions yok';
    return;
  end if;

  execute 'drop policy if exists "push_subscriptions_authenticated_all" on public.push_subscriptions';
  execute 'drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions';
  execute 'drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions';
  execute 'drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions';

  execute 'alter table public.push_subscriptions enable row level security';

  execute $sql$
    create policy "push_subscriptions_select_own"
      on public.push_subscriptions
      for select
      to authenticated
      using (user_id is null or user_id = auth.uid()::text)
  $sql$;

  execute $sql$
    create policy "push_subscriptions_insert_own"
      on public.push_subscriptions
      for insert
      to authenticated
      with check (user_id is null or user_id = auth.uid()::text)
  $sql$;

  execute $sql$
    create policy "push_subscriptions_update_own"
      on public.push_subscriptions
      for update
      to authenticated
      using (user_id is null or user_id = auth.uid()::text)
      with check (user_id is null or user_id = auth.uid()::text)
  $sql$;
end $$;

-- mevzuat_hap_notlari
do $$
begin
  if to_regclass('public.mevzuat_hap_notlari') is null then
    raise notice '015 skip: public.mevzuat_hap_notlari yok';
    return;
  end if;

  execute 'drop policy if exists "mevzuat_hap_notlari_public_read" on public.mevzuat_hap_notlari';
  execute 'drop policy if exists "mevzuat_hap_notlari_authenticated_write" on public.mevzuat_hap_notlari';
  execute 'drop policy if exists "mevzuat_hap_notlari_select_authenticated" on public.mevzuat_hap_notlari';
  execute 'drop policy if exists "mevzuat_hap_notlari_write_admin" on public.mevzuat_hap_notlari';

  execute 'alter table public.mevzuat_hap_notlari enable row level security';

  execute $sql$
    create policy "mevzuat_hap_notlari_select_authenticated"
      on public.mevzuat_hap_notlari
      for select
      to authenticated
      using (true)
  $sql$;

  execute $sql$
    create policy "mevzuat_hap_notlari_write_admin"
      on public.mevzuat_hap_notlari
      for all
      to authenticated
      using (public.annvero_is_admin_or_partner())
      with check (public.annvero_is_admin_or_partner())
  $sql$;
end $$;

-- mevzuat_parametreleri
do $$
begin
  if to_regclass('public.mevzuat_parametreleri') is null then
    raise notice '015 skip: public.mevzuat_parametreleri yok';
    return;
  end if;

  execute 'drop policy if exists "mevzuat_parametreleri_authenticated_read" on public.mevzuat_parametreleri';
  execute 'drop policy if exists "mevzuat_parametreleri_admin_write" on public.mevzuat_parametreleri';
  execute 'drop policy if exists "mevzuat_parametreleri_select_authenticated" on public.mevzuat_parametreleri';
  execute 'drop policy if exists "mevzuat_parametreleri_write_admin" on public.mevzuat_parametreleri';

  execute 'alter table public.mevzuat_parametreleri enable row level security';

  execute $sql$
    create policy "mevzuat_parametreleri_select_authenticated"
      on public.mevzuat_parametreleri
      for select
      to authenticated
      using (true)
  $sql$;

  execute $sql$
    create policy "mevzuat_parametreleri_write_admin"
      on public.mevzuat_parametreleri
      for all
      to authenticated
      using (public.annvero_is_admin_or_partner())
      with check (public.annvero_is_admin_or_partner())
  $sql$;
end $$;

-- annvero_user_profiles
do $$
begin
  if to_regclass('public.annvero_user_profiles') is null then
    raise notice '015 skip: public.annvero_user_profiles yok';
    return;
  end if;

  execute 'drop policy if exists "annvero_user_profiles_authenticated_read" on public.annvero_user_profiles';
  execute 'drop policy if exists "annvero_user_profiles_self_read" on public.annvero_user_profiles';

  execute 'alter table public.annvero_user_profiles enable row level security';

  execute $sql$
    create policy "annvero_user_profiles_self_read"
      on public.annvero_user_profiles
      for select
      to authenticated
      using (
        lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  $sql$;
end $$;

-- GİB tabloları: eski açık policy kaldır, yeni policy yok (service_role API)
do $$
begin
  if to_regclass('public.company_gib_credentials') is not null then
    execute 'drop policy if exists "company_gib_credentials_authenticated_all" on public.company_gib_credentials';
    execute 'alter table public.company_gib_credentials enable row level security';
  else
    raise notice '015 skip: public.company_gib_credentials yok';
  end if;

  if to_regclass('public.gib_company_query_state') is not null then
    execute 'drop policy if exists "gib_company_query_state_authenticated_all" on public.gib_company_query_state';
    execute 'alter table public.gib_company_query_state enable row level security';
  else
    raise notice '015 skip: public.gib_company_query_state yok';
  end if;

  if to_regclass('public.gib_query_sessions') is not null then
    execute 'drop policy if exists "gib_query_sessions_authenticated_all" on public.gib_query_sessions';
    execute 'alter table public.gib_query_sessions enable row level security';
  else
    raise notice '015 skip: public.gib_query_sessions yok';
  end if;
end $$;

-- GİB kimlik bilgileri: doğrudan istemci erişimi yok (yalnızca service_role API)

-- ---- END MIGRATION: 015_security_phase1.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 016_security_phase2.sql
-- ======================================================================
-- ANNVERO Güvenlik Faz 2 (production-safe)
-- login_events, export/recovery altyapısı destek tabloları
-- Olmayan tablolar atlanır; idempotent.

-- ---------------------------------------------------------------------------
-- login_events
-- ---------------------------------------------------------------------------

create table if not exists public.login_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default '',
  email text not null default '',
  ip_address text,
  user_agent text,
  event_type text not null default 'login',
  success boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_login_events_user_created
  on public.login_events (user_id, created_at desc);

create index if not exists idx_login_events_email_created
  on public.login_events (email, created_at desc);

create index if not exists idx_login_events_created
  on public.login_events (created_at desc);

alter table public.login_events enable row level security;

drop policy if exists "login_events_select_management" on public.login_events;

create policy "login_events_select_management"
  on public.login_events
  for select
  to authenticated
  using (public.annvero_is_management());

comment on table public.login_events is
  'Oturum / login event logları — yazma service_role API üzerinden.';

-- ---------------------------------------------------------------------------
-- company_backup_runs (opsiyonel metadata — export geçmişi)
-- ---------------------------------------------------------------------------

create table if not exists public.company_backup_runs (
  id uuid primary key default gen_random_uuid(),
  company_id text not null default '',
  exported_by text not null default '',
  export_version integer not null default 2,
  row_counts jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_company_backup_runs_company_created
  on public.company_backup_runs (company_id, created_at desc);

alter table public.company_backup_runs enable row level security;

drop policy if exists "company_backup_runs_select_management" on public.company_backup_runs;

create policy "company_backup_runs_select_management"
  on public.company_backup_runs
  for select
  to authenticated
  using (
    public.annvero_is_management()
    and (
      public.annvero_is_admin_or_partner()
      or public.annvero_can_access_company(company_id)
    )
  );

comment on table public.company_backup_runs is
  'Firma export geçmişi metadata — tam JSON dosyası burada saklanmaz.';

-- ---------------------------------------------------------------------------
-- GİB tabloları: deleted_at kolonları (varsa)
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.company_gib_credentials') is not null then
    execute $sql$
      alter table public.company_gib_credentials
        add column if not exists deleted_at timestamptz,
        add column if not exists deleted_by text
    $sql$;
  else
    raise notice '016 skip: public.company_gib_credentials yok';
  end if;

  if to_regclass('public.gib_company_query_state') is not null then
    execute $sql$
      alter table public.gib_company_query_state
        add column if not exists deleted_at timestamptz,
        add column if not exists deleted_by text
    $sql$;
  else
    raise notice '016 skip: public.gib_company_query_state yok';
  end if;

  if to_regclass('public.gib_query_sessions') is not null then
    execute $sql$
      alter table public.gib_query_sessions
        add column if not exists deleted_at timestamptz,
        add column if not exists deleted_by text
    $sql$;
  else
    raise notice '016 skip: public.gib_query_sessions yok';
  end if;

  if to_regclass('public.gib_check_reminders') is not null then
    execute $sql$
      alter table public.gib_check_reminders
        add column if not exists deleted_at timestamptz,
        add column if not exists deleted_by text
    $sql$;
  else
    raise notice '016 skip: public.gib_check_reminders yok';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- audit_events: company_backup entity desteği (tablo zaten var)
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.audit_events') is null then
    raise notice '016 skip: public.audit_events yok';
    return;
  end if;

  comment on table public.audit_events is
    'ANNVERO merkezi audit log — export/recovery/login event yazımı service_role API üzerinden.';
end;
$$;

-- ---- END MIGRATION: 016_security_phase2.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 017_knowledge_engine.sql
-- ======================================================================
-- ANNVERO Knowledge Engine / Muhasebe Bilgi Motoru — Görev 1
-- Tablolar, indexler, RLS, sınırlı global seed
-- Idempotent; company_id text (companies.id ile uyumlu)
-- Önkoşul: 015_security_phase1.sql (annvero_can_access_company fonksiyonları)

-- ---------------------------------------------------------------------------
-- Yardımcı: global veya firma kapsamlı okuma
-- ---------------------------------------------------------------------------

create or replace function public.knowledge_can_read_row(
  p_is_global boolean,
  p_company_id text
)
returns boolean
language sql
stable
as $$
  select
    (
      coalesce(p_is_global, false) = true
      and (p_company_id is null or btrim(p_company_id) = '')
    )
    or (
      p_company_id is not null
      and btrim(p_company_id) <> ''
      and public.annvero_can_access_company(p_company_id)
    )
    or public.annvero_is_admin_or_partner();
$$;

create or replace function public.knowledge_can_write_row(
  p_is_global boolean,
  p_company_id text
)
returns boolean
language sql
stable
as $$
  select
    case
      when p_company_id is not null and btrim(p_company_id) <> '' then
        public.annvero_can_access_company(p_company_id)
      when coalesce(p_is_global, false) = true then
        public.annvero_is_management()
      else
        public.annvero_is_management()
    end;
$$;

-- ---------------------------------------------------------------------------
-- A) knowledge_entities
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_entities (
  id uuid primary key default gen_random_uuid(),
  entity_name text not null,
  entity_family text,
  entity_type text,
  aliases jsonb not null default '[]'::jsonb,
  tax_no text,
  iban_list jsonb not null default '[]'::jsonb,
  swift_codes jsonb not null default '[]'::jsonb,
  country text default 'TR',
  risk_level text not null default 'low',
  default_confidence numeric not null default 0.70,
  is_global boolean not null default true,
  company_id text,
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

create index if not exists idx_knowledge_entities_entity_name
  on public.knowledge_entities (entity_name);

create index if not exists idx_knowledge_entities_entity_family
  on public.knowledge_entities (entity_family);

create index if not exists idx_knowledge_entities_entity_type
  on public.knowledge_entities (entity_type);

create index if not exists idx_knowledge_entities_company_id
  on public.knowledge_entities (company_id)
  where company_id is not null and btrim(company_id) <> '';

create index if not exists idx_knowledge_entities_active
  on public.knowledge_entities (is_active, deleted_at)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- B) knowledge_match_patterns
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_match_patterns (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.knowledge_entities(id) on delete set null,
  company_id text,
  pattern_type text not null,
  pattern_value text not null,
  normalized_value text,
  priority integer not null default 100,
  confidence numeric not null default 0.75,
  is_global boolean not null default true,
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

create index if not exists idx_knowledge_patterns_entity_id
  on public.knowledge_match_patterns (entity_id);

create index if not exists idx_knowledge_patterns_company_id
  on public.knowledge_match_patterns (company_id)
  where company_id is not null and btrim(company_id) <> '';

create index if not exists idx_knowledge_patterns_type_value
  on public.knowledge_match_patterns (pattern_type, pattern_value);

create index if not exists idx_knowledge_patterns_normalized
  on public.knowledge_match_patterns (normalized_value)
  where normalized_value is not null;

-- ---------------------------------------------------------------------------
-- C) knowledge_accounting_rules
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_accounting_rules (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.knowledge_entities(id) on delete set null,
  company_id text,
  source_type text,
  transaction_direction text default 'both',
  debit_account_code text,
  debit_account_name text,
  credit_account_code text,
  credit_account_name text,
  vat_account_code text,
  vat_rate numeric,
  document_type text,
  cari_name text,
  description_template text,
  voucher_type text,
  rule_source text not null default 'knowledge_base',
  priority integer not null default 100,
  confidence numeric not null default 0.80,
  risk_level text not null default 'low',
  is_global boolean not null default true,
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

create index if not exists idx_knowledge_rules_entity_id
  on public.knowledge_accounting_rules (entity_id);

create index if not exists idx_knowledge_rules_company_id
  on public.knowledge_accounting_rules (company_id)
  where company_id is not null and btrim(company_id) <> '';

create index if not exists idx_knowledge_rules_source_type
  on public.knowledge_accounting_rules (source_type);

create index if not exists idx_knowledge_rules_confidence
  on public.knowledge_accounting_rules (confidence desc);

-- ---------------------------------------------------------------------------
-- D) knowledge_company_memory
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_company_memory (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  entity_id uuid references public.knowledge_entities(id) on delete set null,
  raw_description text,
  normalized_description text,
  bank_name text,
  account_no text,
  iban text,
  counterparty_name text,
  transaction_type text,
  currency text default 'TRY',
  amount_min numeric,
  amount_max numeric,
  suggested_account_code text,
  suggested_account_name text,
  suggested_counter_account_code text,
  suggested_cari text,
  suggested_document_type text,
  suggested_description text,
  suggested_vat_rate numeric,
  confidence numeric not null default 1.00,
  learned_from text not null default 'manual',
  use_count integer not null default 0,
  last_used_at timestamptz,
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

create index if not exists idx_knowledge_memory_company_norm_desc
  on public.knowledge_company_memory (company_id, normalized_description);

create index if not exists idx_knowledge_memory_company_raw_desc
  on public.knowledge_company_memory (company_id, raw_description);

create index if not exists idx_knowledge_memory_company_id
  on public.knowledge_company_memory (company_id);

create index if not exists idx_knowledge_memory_entity_id
  on public.knowledge_company_memory (entity_id)
  where entity_id is not null;

-- ---------------------------------------------------------------------------
-- E) knowledge_decision_history
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_decision_history (
  id uuid primary key default gen_random_uuid(),
  company_id text,
  source_type text,
  source_record_id text,
  raw_input jsonb not null default '{}'::jsonb,
  matched_entity_id uuid,
  matched_pattern_id uuid,
  matched_rule_id uuid,
  decision_source text not null,
  decision_status text not null default 'suggested',
  confidence numeric not null default 0,
  suggested_result jsonb not null default '{}'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_knowledge_decisions_company_id
  on public.knowledge_decision_history (company_id)
  where company_id is not null and btrim(company_id) <> '';

create index if not exists idx_knowledge_decisions_source
  on public.knowledge_decision_history (decision_source);

create index if not exists idx_knowledge_decisions_confidence
  on public.knowledge_decision_history (confidence desc);

create index if not exists idx_knowledge_decisions_created_at
  on public.knowledge_decision_history (created_at desc);

-- ---------------------------------------------------------------------------
-- F) knowledge_rule_versions
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_rule_versions (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  version_no integer not null,
  change_type text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);

create unique index if not exists idx_knowledge_versions_record_version
  on public.knowledge_rule_versions (table_name, record_id, version_no);

create index if not exists idx_knowledge_versions_record
  on public.knowledge_rule_versions (table_name, record_id);

create index if not exists idx_knowledge_versions_changed_at
  on public.knowledge_rule_versions (changed_at desc);

-- ---------------------------------------------------------------------------
-- RLS — knowledge_entities
-- ---------------------------------------------------------------------------

alter table public.knowledge_entities enable row level security;

drop policy if exists "knowledge_entities_select" on public.knowledge_entities;
drop policy if exists "knowledge_entities_insert" on public.knowledge_entities;
drop policy if exists "knowledge_entities_update" on public.knowledge_entities;

create policy "knowledge_entities_select"
  on public.knowledge_entities for select to authenticated
  using (
    deleted_at is null
    and public.knowledge_can_read_row(is_global, company_id)
  );

create policy "knowledge_entities_insert"
  on public.knowledge_entities for insert to authenticated
  with check (public.knowledge_can_write_row(is_global, company_id));

create policy "knowledge_entities_update"
  on public.knowledge_entities for update to authenticated
  using (public.knowledge_can_write_row(is_global, company_id))
  with check (public.knowledge_can_write_row(is_global, company_id));

-- ---------------------------------------------------------------------------
-- RLS — knowledge_match_patterns
-- ---------------------------------------------------------------------------

alter table public.knowledge_match_patterns enable row level security;

drop policy if exists "knowledge_patterns_select" on public.knowledge_match_patterns;
drop policy if exists "knowledge_patterns_insert" on public.knowledge_match_patterns;
drop policy if exists "knowledge_patterns_update" on public.knowledge_match_patterns;

create policy "knowledge_patterns_select"
  on public.knowledge_match_patterns for select to authenticated
  using (
    deleted_at is null
    and public.knowledge_can_read_row(is_global, company_id)
  );

create policy "knowledge_patterns_insert"
  on public.knowledge_match_patterns for insert to authenticated
  with check (public.knowledge_can_write_row(is_global, company_id));

create policy "knowledge_patterns_update"
  on public.knowledge_match_patterns for update to authenticated
  using (public.knowledge_can_write_row(is_global, company_id))
  with check (public.knowledge_can_write_row(is_global, company_id));

-- ---------------------------------------------------------------------------
-- RLS — knowledge_accounting_rules
-- ---------------------------------------------------------------------------

alter table public.knowledge_accounting_rules enable row level security;

drop policy if exists "knowledge_rules_select" on public.knowledge_accounting_rules;
drop policy if exists "knowledge_rules_insert" on public.knowledge_accounting_rules;
drop policy if exists "knowledge_rules_update" on public.knowledge_accounting_rules;

create policy "knowledge_rules_select"
  on public.knowledge_accounting_rules for select to authenticated
  using (
    deleted_at is null
    and public.knowledge_can_read_row(is_global, company_id)
  );

create policy "knowledge_rules_insert"
  on public.knowledge_accounting_rules for insert to authenticated
  with check (public.knowledge_can_write_row(is_global, company_id));

create policy "knowledge_rules_update"
  on public.knowledge_accounting_rules for update to authenticated
  using (public.knowledge_can_write_row(is_global, company_id))
  with check (public.knowledge_can_write_row(is_global, company_id));

-- ---------------------------------------------------------------------------
-- RLS — knowledge_company_memory (her zaman firma kapsamlı)
-- ---------------------------------------------------------------------------

alter table public.knowledge_company_memory enable row level security;

drop policy if exists "knowledge_memory_select" on public.knowledge_company_memory;
drop policy if exists "knowledge_memory_insert" on public.knowledge_company_memory;
drop policy if exists "knowledge_memory_update" on public.knowledge_company_memory;

create policy "knowledge_memory_select"
  on public.knowledge_company_memory for select to authenticated
  using (
    deleted_at is null
    and public.annvero_can_access_company(company_id)
  );

create policy "knowledge_memory_insert"
  on public.knowledge_company_memory for insert to authenticated
  with check (public.annvero_can_access_company(company_id));

create policy "knowledge_memory_update"
  on public.knowledge_company_memory for update to authenticated
  using (public.annvero_can_access_company(company_id))
  with check (public.annvero_can_access_company(company_id));

-- ---------------------------------------------------------------------------
-- RLS — knowledge_decision_history
-- ---------------------------------------------------------------------------

alter table public.knowledge_decision_history enable row level security;

drop policy if exists "knowledge_decisions_select" on public.knowledge_decision_history;
drop policy if exists "knowledge_decisions_insert" on public.knowledge_decision_history;

create policy "knowledge_decisions_select"
  on public.knowledge_decision_history for select to authenticated
  using (
    (company_id is null or btrim(company_id) = '')
    or public.annvero_can_access_company(company_id)
    or public.annvero_is_admin_or_partner()
  );

create policy "knowledge_decisions_insert"
  on public.knowledge_decision_history for insert to authenticated
  with check (
    (company_id is null or btrim(company_id) = '' or public.annvero_can_access_company(company_id))
  );

-- ---------------------------------------------------------------------------
-- RLS — knowledge_rule_versions (yönetim okur; yazma API/service_role)
-- ---------------------------------------------------------------------------

alter table public.knowledge_rule_versions enable row level security;

drop policy if exists "knowledge_versions_select" on public.knowledge_rule_versions;
drop policy if exists "knowledge_versions_insert" on public.knowledge_rule_versions;

create policy "knowledge_versions_select"
  on public.knowledge_rule_versions for select to authenticated
  using (public.annvero_is_management());

create policy "knowledge_versions_insert"
  on public.knowledge_rule_versions for insert to authenticated
  with check (public.annvero_is_management());

comment on table public.knowledge_entities is
  'Muhasebe Bilgi Motoru — tanınabilir kurum/varlık kayıtları (global + firma).';
comment on table public.knowledge_match_patterns is
  'Entity eşleştirme kalıpları (keyword, regex, IBAN, VKN, vb.).';
comment on table public.knowledge_accounting_rules is
  'Entity/pattern için muhasebe öneri kuralları.';
comment on table public.knowledge_company_memory is
  'Firma bazlı öğrenilen muhasebe hafızası.';
comment on table public.knowledge_decision_history is
  'Knowledge Engine karar geçmişi — audit_events ile tamamlayıcı.';
comment on table public.knowledge_rule_versions is
  'Bilgi tabloları versiyon geçmişi (soft delete öncesi snapshot).';

-- ---------------------------------------------------------------------------
-- Seed — sınırlı global örnekler (idempotent sabit UUID)
-- ---------------------------------------------------------------------------

do $$
declare
  v_google uuid := 'a1000001-0001-4000-8000-000000000001';
  v_meta uuid := 'a1000001-0001-4000-8000-000000000002';
  v_sgk uuid := 'a1000001-0001-4000-8000-000000000003';
  v_gib uuid := 'a1000001-0001-4000-8000-000000000004';
  v_turkcell uuid := 'a1000001-0001-4000-8000-000000000005';
  v_turktelekom uuid := 'a1000001-0001-4000-8000-000000000006';
  v_booking uuid := 'a1000001-0001-4000-8000-000000000007';
  v_expedia uuid := 'a1000001-0001-4000-8000-000000000008';
begin
  if to_regclass('public.knowledge_entities') is null then
    raise notice '017 skip seed: knowledge_entities yok';
    return;
  end if;

  insert into public.knowledge_entities (
    id, entity_name, entity_family, entity_type, aliases, country,
    risk_level, default_confidence, is_global, is_active
  ) values
    (v_google, 'Google', 'tech_ads', 'platform',
      '["Google","Google Ads","GOOGLE ADS","Google Ireland"]'::jsonb, 'IE', 'low', 0.70, true, true),
    (v_meta, 'Meta', 'tech_ads', 'platform',
      '["Facebook","Meta","Meta Ads","FACEBK"]'::jsonb, 'US', 'low', 0.70, true, true),
    (v_sgk, 'SGK', 'public_institution', 'government',
      '["SGK","Sosyal Güvenlik","5510"]'::jsonb, 'TR', 'low', 0.85, true, true),
    (v_gib, 'GİB', 'public_institution', 'government',
      '["GİB","GIB","Gelir İdaresi","gelir idaresi"]'::jsonb, 'TR', 'medium', 0.85, true, true),
    (v_turkcell, 'Turkcell', 'telecom', 'corporation',
      '["Turkcell","TURKCELL","TCELL"]'::jsonb, 'TR', 'low', 0.75, true, true),
    (v_turktelekom, 'Türk Telekom', 'telecom', 'corporation',
      '["Türk Telekom","Turk Telekom","TTNET","AVEA"]'::jsonb, 'TR', 'low', 0.75, true, true),
    (v_booking, 'Booking.com', 'travel_ota', 'platform',
      '["Booking","Booking.com","BOOKING.COM"]'::jsonb, 'NL', 'low', 0.70, true, true),
    (v_expedia, 'Expedia', 'travel_ota', 'platform',
      '["Expedia","EXPEDIA","Hotels.com"]'::jsonb, 'US', 'low', 0.70, true, true)
  on conflict (id) do nothing;

  -- Patterns
  insert into public.knowledge_match_patterns (
    id, entity_id, pattern_type, pattern_value, normalized_value, priority, confidence, is_global
  ) values
    ('b2000001-0001-4000-8000-000000000001', v_google, 'keyword', 'GOOGLE', 'google', 10, 0.80, true),
    ('b2000001-0001-4000-8000-000000000002', v_google, 'description_contains', 'GOOGLE ADS', 'google ads', 20, 0.78, true),
    ('b2000001-0001-4000-8000-000000000003', v_meta, 'keyword', 'FACEBK', 'facebk', 10, 0.80, true),
    ('b2000001-0001-4000-8000-000000000004', v_meta, 'description_contains', 'META ADS', 'meta ads', 20, 0.78, true),
    ('b2000001-0001-4000-8000-000000000005', v_sgk, 'keyword', 'SGK', 'sgk', 10, 0.90, true),
    ('b2000001-0001-4000-8000-000000000006', v_gib, 'keyword', 'GİB', 'gib', 10, 0.88, true),
    ('b2000001-0001-4000-8000-000000000007', v_turkcell, 'keyword', 'TURKCELL', 'turkcell', 10, 0.82, true),
    ('b2000001-0001-4000-8000-000000000008', v_turktelekom, 'keyword', 'TURK TELEKOM', 'turk telekom', 10, 0.82, true),
    ('b2000001-0001-4000-8000-000000000009', v_booking, 'keyword', 'BOOKING', 'booking', 10, 0.80, true),
    ('b2000001-0001-4000-8000-000000000010', v_expedia, 'keyword', 'EXPEDIA', 'expedia', 10, 0.80, true)
  on conflict (id) do nothing;

  -- Örnek muhasebe kuralları (düşük confidence — kesin hesap kodu değil)
  insert into public.knowledge_accounting_rules (
    id, entity_id, source_type, transaction_direction,
    debit_account_code, debit_account_name, credit_account_code, credit_account_name,
    document_type, description_template, rule_source, priority, confidence, risk_level, is_global
  ) values
    (
      'c3000001-0001-4000-8000-000000000001', v_google, 'credit_card', 'debit',
      '770', 'Genel Yönetim Giderleri', '320', 'Satıcılar',
      'EA', 'örnek global kural — Google Ads reklam gideri (hesap kodları doğrulanmalı)',
      'global', 100, 0.45, 'medium', true
    ),
    (
      'c3000001-0001-4000-8000-000000000002', v_meta, 'credit_card', 'debit',
      '770', 'Genel Yönetim Giderleri', '320', 'Satıcılar',
      'EA', 'örnek global kural — Meta/Facebook Ads reklam gideri (hesap kodları doğrulanmalı)',
      'global', 100, 0.45, 'medium', true
    ),
    (
      'c3000001-0001-4000-8000-000000000003', v_sgk, 'payroll', 'debit',
      '335', 'Personele Borçlar', '102', 'Bankalar',
      'DK', 'örnek global kural — SGK prim ödemesi (hesap kodları doğrulanmalı)',
      'global', 100, 0.50, 'medium', true
    ),
    (
      'c3000001-0001-4000-8000-000000000004', v_booking, 'bank', 'debit',
      '120', 'Alıcılar', '600', 'Yurt İçi Satışlar',
      'EA', 'örnek global kural — Booking komisyon/satış (hesap kodları doğrulanmalı)',
      'global', 100, 0.40, 'high', true
    )
  on conflict (id) do nothing;

  raise notice '017 seed: global knowledge entities/patterns/rules yüklendi (veya zaten vardı)';
end;
$$;

-- ---- END MIGRATION: 017_knowledge_engine.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 018_real_accounting_rules_seed.sql
-- ======================================================================
-- ANNVERO Knowledge Engine — Görev 5
-- Gerçek global muhasebe kural seed revizyonu (idempotent)
-- Önkoşul: 017_knowledge_engine.sql (entity + tablo omurgası)

do $$
declare
  v_google uuid := 'a1000001-0001-4000-8000-000000000001';
  v_meta uuid := 'a1000001-0001-4000-8000-000000000002';
  v_sgk uuid := 'a1000001-0001-4000-8000-000000000003';
  v_gib uuid := 'a1000001-0001-4000-8000-000000000004';
  v_turkcell uuid := 'a1000001-0001-4000-8000-000000000005';
  v_turktelekom uuid := 'a1000001-0001-4000-8000-000000000006';
  v_booking uuid := 'a1000001-0001-4000-8000-000000000007';
  v_expedia uuid := 'a1000001-0001-4000-8000-000000000008';
begin
  if to_regclass('public.knowledge_accounting_rules') is null then
    raise notice '018 skip: knowledge_accounting_rules yok — önce 017 çalıştırın';
    return;
  end if;

  insert into public.knowledge_accounting_rules (
    id, entity_id, company_id, source_type, transaction_direction,
    debit_account_code, debit_account_name, credit_account_code, credit_account_name,
    vat_rate, document_type, cari_name, description_template,
    rule_source, priority, confidence, risk_level, is_global, is_active
  ) values
    -- A) Google — bank
    (
      'c3000002-0001-4000-8000-000000000001', v_google, null, 'bank', 'debit',
      '770', 'Reklam / pazarlama giderleri', '320', 'Google cari',
      null, 'FT', 'Google', 'Google reklam / dijital hizmet gideri',
      'global', 10, 0.85, 'medium', true, true
    ),
    -- A) Google — credit_card
    (
      'c3000001-0001-4000-8000-000000000001', v_google, null, 'credit_card', 'debit',
      '770', 'Reklam / pazarlama giderleri', '320', 'Google cari',
      null, 'FT', 'Google', 'Google reklam / dijital hizmet gideri',
      'global', 10, 0.85, 'medium', true, true
    ),
    -- B) Meta — bank
    (
      'c3000002-0001-4000-8000-000000000002', v_meta, null, 'bank', 'debit',
      '770', 'Reklam / pazarlama giderleri', '320', 'Satıcılar',
      null, 'FT', 'Meta / Facebook', 'Meta/Facebook reklam gideri',
      'global', 10, 0.85, 'medium', true, true
    ),
    -- B) Meta — credit_card
    (
      'c3000001-0001-4000-8000-000000000002', v_meta, null, 'credit_card', 'debit',
      '770', 'Reklam / pazarlama giderleri', '320', 'Satıcılar',
      null, 'FT', 'Meta / Facebook', 'Meta/Facebook reklam gideri',
      'global', 10, 0.85, 'medium', true, true
    ),
    -- C) SGK — bank
    (
      'c3000001-0001-4000-8000-000000000003', v_sgk, null, 'bank', 'debit',
      '361', 'Ödenecek SGK primleri', '102', 'Bankalar',
      null, 'DK', 'SGK', 'SGK prim ödemesi',
      'global', 10, 0.90, 'low', true, true
    ),
    -- D) GİB — bank
    (
      'c3000002-0001-4000-8000-000000000003', v_gib, null, 'bank', 'debit',
      '360', 'Ödenecek vergi ve fonlar', '102', 'Bankalar',
      null, 'DK', 'GİB', 'KDV / vergi ödemesi',
      'global', 10, 0.80, 'medium', true, true
    ),
    -- E) Turkcell — bank
    (
      'c3000002-0001-4000-8000-000000000004', v_turkcell, null, 'bank', 'debit',
      '770', 'Genel yönetim giderleri', '320', 'Satıcılar',
      null, 'FT', 'Turkcell', 'Turkcell iletişim gideri',
      'global', 10, 0.80, 'low', true, true
    ),
    -- E) Turkcell — credit_card
    (
      'c3000002-0001-4000-8000-000000000005', v_turkcell, null, 'credit_card', 'debit',
      '770', 'Genel yönetim giderleri', '320', 'Satıcılar',
      null, 'FT', 'Turkcell', 'Turkcell iletişim gideri',
      'global', 10, 0.80, 'low', true, true
    ),
    -- F) Türk Telekom — bank
    (
      'c3000002-0001-4000-8000-000000000006', v_turktelekom, null, 'bank', 'debit',
      '770', 'Genel yönetim giderleri', '320', 'Satıcılar',
      null, 'FT', 'Türk Telekom', 'Türk Telekom iletişim gideri',
      'global', 10, 0.80, 'low', true, true
    ),
    -- F) Türk Telekom — credit_card
    (
      'c3000002-0001-4000-8000-000000000007', v_turktelekom, null, 'credit_card', 'debit',
      '770', 'Genel yönetim giderleri', '320', 'Satıcılar',
      null, 'FT', 'Türk Telekom', 'Türk Telekom iletişim gideri',
      'global', 10, 0.80, 'low', true, true
    ),
    -- G) Booking.com — bank
    (
      'c3000001-0001-4000-8000-000000000004', v_booking, null, 'bank', 'debit',
      '120', 'Alıcılar', '600', 'Yurt İçi Satışlar',
      null, 'FT', 'Booking.com', 'Booking tahsilatı / komisyon kontrolü gerekli',
      'global', 10, 0.75, 'medium', true, true
    ),
    -- H) Expedia — bank
    (
      'c3000002-0001-4000-8000-000000000008', v_expedia, null, 'bank', 'debit',
      '120', 'Alıcılar', '600', 'Yurt İçi Satışlar',
      null, 'FT', 'Expedia', 'Expedia tahsilatı / komisyon kontrolü gerekli',
      'global', 10, 0.75, 'medium', true, true
    )
  on conflict (id) do update set
    entity_id = excluded.entity_id,
    company_id = excluded.company_id,
    source_type = excluded.source_type,
    transaction_direction = excluded.transaction_direction,
    debit_account_code = excluded.debit_account_code,
    debit_account_name = excluded.debit_account_name,
    credit_account_code = excluded.credit_account_code,
    credit_account_name = excluded.credit_account_name,
    vat_rate = excluded.vat_rate,
    document_type = excluded.document_type,
    cari_name = excluded.cari_name,
    description_template = excluded.description_template,
    rule_source = excluded.rule_source,
    priority = excluded.priority,
    confidence = excluded.confidence,
    risk_level = excluded.risk_level,
    is_global = excluded.is_global,
    is_active = excluded.is_active,
    updated_at = now(),
    deleted_at = null;

  raise notice '018 seed: 12 global accounting rule upserted (Görev 5)';
end;
$$;

comment on table public.knowledge_accounting_rules is
  'Muhasebe Bilgi Motoru — entity/pattern için muhasebe öneri kuralları (018 gerçek global seed).';

-- ---- END MIGRATION: 018_real_accounting_rules_seed.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 019_unrecognized_transactions.sql
-- ======================================================================
-- İşlem Hafızası: tanınmayan işlem kuyruğu (production-safe, idempotent)
-- 008 uygulanmamış ortamlarda tabloyu oluşturur; 015 RLS politikalarını kurar.

create table if not exists public.unrecognized_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  source_module text not null default 'banka',
  source_bank text,
  source_row_id text,
  transaction_date text,
  amount numeric,
  direction text,
  raw_description text not null default '',
  clean_description text not null default '',
  keyword text not null default '',
  transaction_type text,
  suggested_account_code text,
  suggested_account_name text,
  suggested_document_type text,
  suggested_cari text,
  suggested_memory_id uuid,
  suggestion_score numeric,
  account_code text,
  account_name text,
  document_type text,
  cari_name text,
  status text not null default 'pending',
  user_correction text,
  learned_memory_id uuid,
  learned_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.unrecognized_transactions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

create index if not exists idx_unrecognized_transactions_company_status
  on public.unrecognized_transactions (company_id, status, created_at desc);

create index if not exists idx_unrecognized_transactions_keyword
  on public.unrecognized_transactions (company_id, keyword);

create index if not exists idx_unrecognized_transactions_fingerprint
  on public.unrecognized_transactions (company_id, source_row_id)
  where status = 'pending';

alter table public.unrecognized_transactions enable row level security;

drop policy if exists "unrecognized_transactions_authenticated_all" on public.unrecognized_transactions;
drop policy if exists "unrecognized_select_authenticated" on public.unrecognized_transactions;
drop policy if exists "unrecognized_insert_authenticated" on public.unrecognized_transactions;
drop policy if exists "unrecognized_update_authenticated" on public.unrecognized_transactions;

create policy "unrecognized_select_authenticated"
  on public.unrecognized_transactions
  for select
  to authenticated
  using (
    public.annvero_can_access_company(company_id)
    and deleted_at is null
  );

create policy "unrecognized_insert_authenticated"
  on public.unrecognized_transactions
  for insert
  to authenticated
  with check (public.annvero_can_access_company(company_id));

create policy "unrecognized_update_authenticated"
  on public.unrecognized_transactions
  for update
  to authenticated
  using (public.annvero_can_access_company(company_id))
  with check (public.annvero_can_access_company(company_id));

comment on table public.unrecognized_transactions is
  'İşlem Hafızası — tanınmayan banka/ekstre işlemleri kuyruğu.';

notify pgrst, 'reload schema';

-- ---- END MIGRATION: 019_unrecognized_transactions.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 020_cloud_storage_evrak_havuzu_v1.sql
-- ======================================================================
-- ANNVERO Google Drive / Evrak Havuzu V1
-- Uygulama erişimi yalnız server-side service_role üzerinden yapılır.

create table if not exists public.cloud_storage_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'google_drive'),
  account_email text,
  access_scope text not null default 'https://www.googleapis.com/auth/drive.file',
  token_reference text,
  status text not null default 'disconnected' check (status in ('connected','disconnected','error')),
  connected_at timestamptz,
  last_refresh_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.company_cloud_folders (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  connection_id uuid references public.cloud_storage_connections(id) on delete set null,
  root_folder_id text not null,
  root_folder_name text,
  folder_structure_version text not null default 'v1',
  sync_status text not null default 'idle' check (sync_status in ('idle','syncing','ok','error','disconnected')),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id),
  unique (connection_id, root_folder_id)
);

create table if not exists public.document_index (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  provider text not null default 'google_drive' check (provider = 'google_drive'),
  provider_file_id text not null,
  parent_folder_id text,
  file_name text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  file_hash text,
  document_category text,
  document_type text,
  period_key text,
  revision_no integer not null default 0 check (revision_no >= 0),
  source_path text,
  parse_status text not null default 'indexed',
  parser_version text,
  normalized_record_id text,
  last_modified_at timestamptz,
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider_file_id)
);

create table if not exists public.document_sync_events (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  provider_file_id text,
  event_type text not null,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_document_index_company_hash
  on public.document_index (company_id, file_hash)
  where file_hash is not null and file_hash <> '' and parse_status <> 'soft_deleted';
create index if not exists idx_cloud_connections_user on public.cloud_storage_connections(user_id, provider);
create index if not exists idx_cloud_folders_company on public.company_cloud_folders(company_id);
create index if not exists idx_document_index_company_period on public.document_index(company_id, period_key);
create index if not exists idx_document_sync_events_company on public.document_sync_events(company_id, created_at desc);

alter table public.cloud_storage_connections enable row level security;
alter table public.company_cloud_folders enable row level security;
alter table public.document_index enable row level security;
alter table public.document_sync_events enable row level security;

-- Fail-closed: anon/authenticated için policy yok; service_role RLS bypass eder.
revoke all on public.cloud_storage_connections from anon, authenticated;
revoke all on public.company_cloud_folders from anon, authenticated;
revoke all on public.document_index from anon, authenticated;
revoke all on public.document_sync_events from anon, authenticated;

create or replace function public.cloud_storage_set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_cloud_connections_updated_at on public.cloud_storage_connections;
create trigger trg_cloud_connections_updated_at before update on public.cloud_storage_connections
for each row execute function public.cloud_storage_set_updated_at();
drop trigger if exists trg_company_cloud_folders_updated_at on public.company_cloud_folders;
create trigger trg_company_cloud_folders_updated_at before update on public.company_cloud_folders
for each row execute function public.cloud_storage_set_updated_at();
drop trigger if exists trg_document_index_updated_at on public.document_index;
create trigger trg_document_index_updated_at before update on public.document_index
for each row execute function public.cloud_storage_set_updated_at();

comment on column public.cloud_storage_connections.token_reference is
  'AES-256-GCM encrypted OAuth token bundle; plaintext token yasaktır.';

-- ---- END MIGRATION: 020_cloud_storage_evrak_havuzu_v1.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 021_security_cleanup_legacy_learning_memory_policies.sql
-- ======================================================================
-- ANNVERO Güvenlik — legacy learning_memory public policy temizliği
-- 015 daha önce production'da uygulanmış olsa bile, eski açık (public) policy'lerin
-- kalıcı temizliğini garanti eder. Idempotent ve fail-safe.
-- - learning_memory yoksa notice verip güvenle atlar.
-- - Tablo veya veri SİLMEZ; yalnızca policy düşürür.
-- - RLS'yi açık bırakır.

do $$
begin
  if to_regclass('public.learning_memory') is null then
    raise notice '021 skip: public.learning_memory yok';
    return;
  end if;

  execute 'alter table public.learning_memory enable row level security';

  execute 'drop policy if exists "allow learning memory delete" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory insert" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory read" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory update" on public.learning_memory';

  raise notice '021: legacy learning_memory public policy temizliği tamamlandı';
end $$;

-- ---- END MIGRATION: 021_security_cleanup_legacy_learning_memory_policies.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 022_rbac_profile_source_and_table_grants.sql
-- ======================================================================
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

-- ---- END MIGRATION: 022_rbac_profile_source_and_table_grants.sql ----

-- ======================================================================
-- BEGIN MIGRATION: 023_company_membership_source.sql
-- ======================================================================
-- ANNVERO Güvenlik (023) — company_ids yatay yetki yükseltme açığının kalıcı kapatılması
-- ---------------------------------------------------------------------------
-- SORUN:
--   annvero_jwt_company_ids() firma erişim listesini auth.jwt() -> user_metadata
--   -> company_ids alanından okuyordu. user_metadata KULLANICI TARAFINDAN
--   DEĞİŞTİRİLEBİLİR olduğundan, normal (admin olmayan) bir kullanıcı kendi
--   user_metadata.company_ids değerine başka firmaların ID'lerini ekleyerek
--   YATAY YETKİ YÜKSELTME (unauthorized firma erişimi) yapabilirdi.
--
-- ÇÖZÜM (fail-closed):
--   Firma üyeliği güvenilir, sunucu-kontrollü bir DB tablosuna (annvero_company_members)
--   taşınır. Runtime authorization auth.uid() tabanlıdır. user_metadata rol/company_ids
--   kaynağı olarak ARTIK KULLANILMAZ. Membership kaydı olmayan normal kullanıcı
--   fail-closed olarak SIFIR firma görür. admin/partner kısa devresi korunur.
--
--   Firma satır yetkisinin TEK kaynağı annvero_company_members'tir. user_metadata VE
--   app_metadata company_ids yetki kaynağı DEĞİLDİR (app_metadata fallback kaldırıldı).
--   Membership senkronu yalnız atomik SECURITY DEFINER RPC (annvero_sync_company_membership)
--   üzerinden, yalnız service_role ile yapılır.
--
-- Idempotent; geçmiş migration'lar yeniden yazılmadan üzerine eklenir.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) Kimlik eşlemesi: annvero_user_profiles.auth_user_id
-- ===========================================================================

-- 1) auth_user_id kolonu (yoksa ekle)
alter table public.annvero_user_profiles
  add column if not exists auth_user_id uuid;

-- 2) Idempotent backfill — birincil: auth.users ile lower(email) eşleşmesi.
update public.annvero_user_profiles p
set auth_user_id = u.id
from auth.users u
where p.auth_user_id is null
  and lower(p.email) = lower(u.email);

-- 2b) Güvenli ek backfill — uygulama zaten profiles.id = auth user uuid yazıyor
--     (bkz. profileService.js). Cast hatası riski OLMADAN auth.users ile metin
--     eşleşmesi (p.id = u.id::text) kullanılır; profiles.id üzerinde uuid cast YAPILMAZ.
update public.annvero_user_profiles p
set auth_user_id = u.id
from auth.users u
where p.auth_user_id is null
  and p.id = u.id::text;

-- 3) auth_user_id için unique partial index (null olmayanlar)
create unique index if not exists uq_annvero_user_profiles_auth_user_id
  on public.annvero_user_profiles (auth_user_id)
  where auth_user_id is not null;

-- 4) auth.users(id) FK — mevcut veri riskine karşı NOT VALID ekle, sonra validate et.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'annvero_user_profiles_auth_user_id_fkey'
      and conrelid = 'public.annvero_user_profiles'::regclass
  ) then
    alter table public.annvero_user_profiles
      add constraint annvero_user_profiles_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id)
      on delete set null
      not valid;
  end if;

  begin
    alter table public.annvero_user_profiles
      validate constraint annvero_user_profiles_auth_user_id_fkey;
  exception when others then
    raise notice '023: auth_user_id FK validate atlandı (mevcut veri): %', sqlerrm;
  end;
end $$;

-- 5) annvero_profile_role(): runtime kaynağı auth.uid() = auth_user_id (yalnız).
--    Email eşleşmesi runtime yetki kaynağı DEĞİLDİR (yalnız yukarıdaki backfill'de kullanıldı).
--    022'deki email-tabanlı sürümün üstüne yazar; user_metadata kesinlikle kullanılmaz.
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
    and p.auth_user_id = auth.uid()
  order by p.updated_at desc nulls last
  limit 1;
$$;

comment on function public.annvero_profile_role() is
  'Aktif kullanıcının rolünü annvero_user_profiles tablosundan auth.uid() = auth_user_id ile okur (runtime). SECURITY DEFINER, sabit search_path. user_metadata KULLANILMAZ.';

-- ===========================================================================
-- B) Normalize firma üyeliği: public.annvero_company_members
-- ===========================================================================

create table if not exists public.annvero_company_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id text not null references public.companies(id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id)
);

create index if not exists idx_annvero_company_members_user
  on public.annvero_company_members (user_id)
  where is_active;

create index if not exists idx_annvero_company_members_company
  on public.annvero_company_members (company_id);

-- updated_at trigger
create or replace function public.annvero_company_members_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_annvero_company_members_set_updated_at on public.annvero_company_members;

create trigger trg_annvero_company_members_set_updated_at
before update on public.annvero_company_members
for each row
execute function public.annvero_company_members_set_updated_at();

-- RLS aç; anon/authenticated için POLICY veya GRANT VERİLMEZ (fail-closed).
-- Normal kullanıcı tabloyu doğrudan okuyamaz; yalnız SECURITY DEFINER erişim
-- fonksiyonu (annvero_profile_company_ids) üzerinden erişilir. service_role RLS'i bypass eder.
alter table public.annvero_company_members enable row level security;

-- Emniyet: yanlışlıkla eklenmiş açık policy'ler varsa kaldır (idempotent).
drop policy if exists "annvero_company_members_authenticated_all" on public.annvero_company_members;
drop policy if exists "annvero_company_members_select_authenticated" on public.annvero_company_members;

-- service_role için gerekli CRUD (idempotent, dar hedef).
grant select, insert, update, delete on public.annvero_company_members to service_role;

-- Emniyet: anon/authenticated'a tablo yetkisi verilmediğini garanti et.
revoke all on public.annvero_company_members from anon;
revoke all on public.annvero_company_members from authenticated;

comment on table public.annvero_company_members is
  'Kullanıcı-firma üyeliği (güvenilir, sunucu-kontrollü). RLS açık; anon/authenticated erişimi yok. Yalnız service_role ve SECURITY DEFINER fonksiyonları erişir.';

-- B.1) Atomik membership senkron RPC'si.
--   - Verilen geçerli company ID'lerini aktif upsert eder.
--   - Listede olmayan mevcut üyelikleri is_active=false yapar.
--   - Geçersiz company_id (companies FK ihlali) → fonksiyon exception atar → TÜM işlem rollback.
--   - Tek statement (RPC) çağrısı olduğundan atomiktir.
--   - Yalnız service_role çağırabilir; anon/authenticated execute REVOKE edilir.
create or replace function public.annvero_sync_company_membership(
  target_user_id uuid,
  target_company_ids text[],
  actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids text[];
begin
  if target_user_id is null then
    raise exception 'annvero_sync_company_membership: target_user_id zorunludur';
  end if;

  -- Normalize: null/boş temizle, tekilleştir.
  v_ids := (
    select coalesce(array_agg(distinct btrim(x)), array[]::text[])
    from unnest(coalesce(target_company_ids, array[]::text[])) as x
    where btrim(coalesce(x, '')) <> ''
  );

  -- 1) İstenen listede olmayan mevcut aktif üyelikleri pasifleştir (erişim daraltma).
  update public.annvero_company_members m
  set is_active = false, updated_at = now()
  where m.user_id = target_user_id
    and m.is_active = true
    and m.company_id <> all(v_ids);

  -- 2) İstenen firmaları aktif upsert et. Geçersiz company_id → FK ihlali → rollback.
  if array_length(v_ids, 1) is not null then
    insert into public.annvero_company_members as m
      (user_id, company_id, is_active, created_by, updated_at)
    select target_user_id, cid, true, actor_user_id, now()
    from unnest(v_ids) as cid
    on conflict (user_id, company_id)
    do update set is_active = true, updated_at = now();
  end if;
end;
$$;

comment on function public.annvero_sync_company_membership(uuid, text[], uuid) is
  'Atomik membership senkronu (service_role). Geçersiz company_id → tüm işlem rollback. anon/authenticated execute YOK.';

-- Execute yetkisi: yalnız service_role.
revoke all on function public.annvero_sync_company_membership(uuid, text[], uuid) from public;
revoke all on function public.annvero_sync_company_membership(uuid, text[], uuid) from anon;
revoke all on function public.annvero_sync_company_membership(uuid, text[], uuid) from authenticated;
grant execute on function public.annvero_sync_company_membership(uuid, text[], uuid) to service_role;

-- ===========================================================================
-- C) Güvenli company_ids kaynağı
-- ===========================================================================

-- 1) auth.uid() ile aktif membership company_id listesi (text[]).
create or replace function public.annvero_profile_company_ids()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(m.company_id), array[]::text[])
  from public.annvero_company_members m
  where m.is_active = true
    and m.user_id = auth.uid();
$$;

comment on function public.annvero_profile_company_ids() is
  'auth.uid() için aktif firma üyeliği company_id listesi. SECURITY DEFINER; annvero_company_members RLS bypass. user_metadata KULLANILMAZ.';

-- 2) annvero_jwt_company_ids(): firma satır yetkisinin TEK kaynağı DB membership.
--    user_metadata VE app_metadata company_ids yetki kaynağı DEĞİLDİR (ikisi de kaldırıldı).
--    Membership yoksa her zaman boş text[] döner (fail-closed).
create or replace function public.annvero_jwt_company_ids()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.annvero_profile_company_ids();
$$;

comment on function public.annvero_jwt_company_ids() is
  'Firma erişim listesi: TEK kaynak annvero_company_members (auth.uid). Membership yoksa boş text[] (fail-closed). user_metadata ve app_metadata company_ids KULLANILMAZ.';

-- 3) annvero_can_access_company(): admin/partner kısa devresi korunur; normal kullanıcı
--    yeni güvenli membership kaynağını (annvero_jwt_company_ids) kullanır. Membership yoksa
--    fail-closed (sıfır firma). Yalnız comment/search_path güncellendi; mantık korunur.
create or replace function public.annvero_can_access_company(target_company_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  role text;
  ids text[];
begin
  if auth.uid() is null then
    return false;
  end if;

  if target_company_id is null or btrim(target_company_id) = '' then
    return false;
  end if;

  role := public.annvero_jwt_role();

  if role in ('admin', 'partner') then
    return true;
  end if;

  ids := public.annvero_jwt_company_ids();

  if coalesce(array_length(ids, 1), 0) = 0 then
    return false;
  end if;

  return target_company_id = any(ids);
end;
$$;

comment on function public.annvero_can_access_company(text) is
  'Firma erişim kontrolü. Rol kaynağı: annvero_user_profiles (auth.uid). Firma listesi: annvero_company_members (auth.uid). user_metadata KULLANILMAZ. Membership yoksa fail-closed.';

-- ---- END MIGRATION: 023_company_membership_source.sql ----

COMMIT;
