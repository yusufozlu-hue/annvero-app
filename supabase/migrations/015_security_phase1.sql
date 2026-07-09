-- ANNVERO Güvenlik Faz 1
-- RLS sıkılaştırma, audit_events, soft delete altyapısı

-- ---------------------------------------------------------------------------
-- JWT yardımcı fonksiyonları
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
-- Soft delete altyapısı (kritik tablolar)
-- ---------------------------------------------------------------------------

alter table public.companies
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

alter table public.unrecognized_transactions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

alter table public.normalized_financial_transactions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

alter table public.learned_bank_rules
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

alter table public.reconciliation_matches
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'learning_memory'
  ) then
    execute 'alter table public.learning_memory
      add column if not exists deleted_at timestamptz,
      add column if not exists deleted_by text';
  end if;
end $$;

create index if not exists idx_companies_deleted_at
  on public.companies (deleted_at)
  where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- Audit events
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

-- ---------------------------------------------------------------------------
-- Eski anon / açık politikaları kaldır
-- ---------------------------------------------------------------------------

drop policy if exists "companies_authenticated_all" on public.companies;
drop policy if exists "nft_authenticated_all" on public.normalized_financial_transactions;
drop policy if exists "unrecognized_transactions_authenticated_all" on public.unrecognized_transactions;
drop policy if exists "reconciliation_matches_authenticated_all" on public.reconciliation_matches;
drop policy if exists "learned_bank_rules_authenticated_all" on public.learned_bank_rules;
drop policy if exists "company_gib_credentials_authenticated_all" on public.company_gib_credentials;
drop policy if exists "gib_company_query_state_authenticated_all" on public.gib_company_query_state;
drop policy if exists "gib_query_sessions_authenticated_all" on public.gib_query_sessions;
drop policy if exists "official_notifications_authenticated_all" on public.official_notifications;
drop policy if exists "gib_check_reminders_authenticated_all" on public.gib_check_reminders;
drop policy if exists "push_subscriptions_authenticated_all" on public.push_subscriptions;
drop policy if exists "mevzuat_hap_notlari_public_read" on public.mevzuat_hap_notlari;
drop policy if exists "mevzuat_hap_notlari_authenticated_write" on public.mevzuat_hap_notlari;
drop policy if exists "annvero_user_profiles_authenticated_read" on public.annvero_user_profiles;
drop policy if exists "annvero_user_profiles_self_read" on public.annvero_user_profiles;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'learning_memory'
      and policyname = 'learning_memory_authenticated_all'
  ) then
    execute 'drop policy "learning_memory_authenticated_all" on public.learning_memory';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------

create policy "companies_select_authenticated"
  on public.companies
  for select
  to authenticated
  using (
    public.annvero_can_access_company(id)
    and deleted_at is null
  );

create policy "companies_insert_management"
  on public.companies
  for insert
  to authenticated
  with check (public.annvero_is_management());

create policy "companies_update_authenticated"
  on public.companies
  for update
  to authenticated
  using (public.annvero_can_access_company(id))
  with check (public.annvero_can_access_company(id));

-- ---------------------------------------------------------------------------
-- normalized_financial_transactions
-- ---------------------------------------------------------------------------

create policy "nft_select_authenticated"
  on public.normalized_financial_transactions
  for select
  to authenticated
  using (
    public.annvero_can_access_company(company_id)
    and deleted_at is null
  );

create policy "nft_insert_authenticated"
  on public.normalized_financial_transactions
  for insert
  to authenticated
  with check (public.annvero_can_access_company(company_id));

create policy "nft_update_authenticated"
  on public.normalized_financial_transactions
  for update
  to authenticated
  using (public.annvero_can_access_company(company_id))
  with check (public.annvero_can_access_company(company_id));

-- ---------------------------------------------------------------------------
-- unrecognized_transactions
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- reconciliation_matches + learned_bank_rules
-- ---------------------------------------------------------------------------

create policy "reconciliation_select_authenticated"
  on public.reconciliation_matches
  for select
  to authenticated
  using (
    public.annvero_can_access_company(company_id)
    and deleted_at is null
  );

create policy "reconciliation_insert_authenticated"
  on public.reconciliation_matches
  for insert
  to authenticated
  with check (public.annvero_can_access_company(company_id));

create policy "reconciliation_update_authenticated"
  on public.reconciliation_matches
  for update
  to authenticated
  using (public.annvero_can_access_company(company_id))
  with check (public.annvero_can_access_company(company_id));

create policy "learned_bank_rules_select_authenticated"
  on public.learned_bank_rules
  for select
  to authenticated
  using (
    public.annvero_can_access_company(company_id)
    and deleted_at is null
  );

create policy "learned_bank_rules_insert_authenticated"
  on public.learned_bank_rules
  for insert
  to authenticated
  with check (public.annvero_can_access_company(company_id));

create policy "learned_bank_rules_update_authenticated"
  on public.learned_bank_rules
  for update
  to authenticated
  using (public.annvero_can_access_company(company_id))
  with check (public.annvero_can_access_company(company_id));

-- ---------------------------------------------------------------------------
-- official_notifications + gib_check_reminders
-- ---------------------------------------------------------------------------

create policy "official_notifications_select_authenticated"
  on public.official_notifications
  for select
  to authenticated
  using (public.annvero_can_access_company(company_id));

create policy "official_notifications_insert_authenticated"
  on public.official_notifications
  for insert
  to authenticated
  with check (public.annvero_can_access_company(company_id));

create policy "official_notifications_update_authenticated"
  on public.official_notifications
  for update
  to authenticated
  using (public.annvero_can_access_company(company_id))
  with check (public.annvero_can_access_company(company_id));

create policy "gib_check_reminders_select_authenticated"
  on public.gib_check_reminders
  for select
  to authenticated
  using (
    company_id is null
    or public.annvero_can_access_company(company_id)
  );

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
  );

-- ---------------------------------------------------------------------------
-- push_subscriptions (kullanıcıya bağlı)
-- ---------------------------------------------------------------------------

create policy "push_subscriptions_select_own"
  on public.push_subscriptions
  for select
  to authenticated
  using (user_id is null or user_id = auth.uid()::text);

create policy "push_subscriptions_insert_own"
  on public.push_subscriptions
  for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid()::text);

create policy "push_subscriptions_update_own"
  on public.push_subscriptions
  for update
  to authenticated
  using (user_id is null or user_id = auth.uid()::text)
  with check (user_id is null or user_id = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- mevzuat_hap_notlari (global içerik)
-- ---------------------------------------------------------------------------

create policy "mevzuat_hap_notlari_select_authenticated"
  on public.mevzuat_hap_notlari
  for select
  to authenticated
  using (true);

create policy "mevzuat_hap_notlari_write_admin"
  on public.mevzuat_hap_notlari
  for all
  to authenticated
  using (public.annvero_is_admin_or_partner())
  with check (public.annvero_is_admin_or_partner());

-- ---------------------------------------------------------------------------
-- mevzuat_parametreleri (global)
-- ---------------------------------------------------------------------------

drop policy if exists "mevzuat_parametreleri_authenticated_read" on public.mevzuat_parametreleri;
drop policy if exists "mevzuat_parametreleri_admin_write" on public.mevzuat_parametreleri;

create policy "mevzuat_parametreleri_select_authenticated"
  on public.mevzuat_parametreleri
  for select
  to authenticated
  using (true);

create policy "mevzuat_parametreleri_write_admin"
  on public.mevzuat_parametreleri
  for all
  to authenticated
  using (public.annvero_is_admin_or_partner())
  with check (public.annvero_is_admin_or_partner());

-- ---------------------------------------------------------------------------
-- annvero_user_profiles (mevcut self-read korunur)
-- ---------------------------------------------------------------------------

create policy "annvero_user_profiles_self_read"
  on public.annvero_user_profiles
  for select
  to authenticated
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- ---------------------------------------------------------------------------
-- learning_memory (tablo varsa)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'learning_memory'
  ) then
    execute 'drop policy if exists "learning_memory_select_authenticated" on public.learning_memory';
    execute 'drop policy if exists "learning_memory_insert_authenticated" on public.learning_memory';
    execute 'drop policy if exists "learning_memory_update_authenticated" on public.learning_memory';

    execute 'create policy "learning_memory_select_authenticated"
      on public.learning_memory
      for select
      to authenticated
      using (
        public.annvero_can_access_company(company_id)
        and deleted_at is null
      )';

    execute 'create policy "learning_memory_insert_authenticated"
      on public.learning_memory
      for insert
      to authenticated
      with check (public.annvero_can_access_company(company_id))';

    execute 'create policy "learning_memory_update_authenticated"
      on public.learning_memory
      for update
      to authenticated
      using (public.annvero_can_access_company(company_id))
      with check (public.annvero_can_access_company(company_id))';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- audit_events (okuma: admin/partner veya firma erişimi)
-- ---------------------------------------------------------------------------

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

-- GİB kimlik bilgileri: doğrudan istemci erişimi yok (yalnızca service_role API)

comment on table public.audit_events is
  'ANNVERO merkezi audit log — yazma service_role API üzerinden.';
