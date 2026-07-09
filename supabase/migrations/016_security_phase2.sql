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
