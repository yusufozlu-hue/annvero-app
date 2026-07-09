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
