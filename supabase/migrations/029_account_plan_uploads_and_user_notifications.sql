-- ANNVERO 029 — Hesap planı sürümleri + kullanıcı bildirimleri
-- Forward-only, idempotent. Destructive SQL YOK.
-- Ham Excel satırı / VKN / IBAN saklanmaz.
-- Yazma: service_role (API). Okuma: authenticated + üyelik / sahip kullanıcı.

-- ---------------------------------------------------------------------------
-- 1) company_account_plan_uploads
-- ---------------------------------------------------------------------------

create table if not exists public.company_account_plan_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  file_name text not null default '',
  content_fingerprint text not null default '',
  uploaded_by text not null default '',
  uploaded_by_label text not null default '',
  status text not null default 'pending'
    check (status in (
      'pending',
      'active',
      'failed',
      'duplicate',
      'superseded',
      'rolled_back'
    )),
  is_active boolean not null default false,
  total_rows integer not null default 0 check (total_rows >= 0),
  added_count integer not null default 0 check (added_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  safe_error_summary text not null default '',
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  deleted_at timestamptz,
  deleted_by text
);

comment on table public.company_account_plan_uploads is
  'Hesap planı yükleme geçmişi. Ham Excel içeriği yok; yalnız sayılar ve fingerprint.';

create index if not exists idx_account_plan_uploads_company_created
  on public.company_account_plan_uploads (company_id, created_at desc)
  where deleted_at is null;

create unique index if not exists uq_account_plan_uploads_active
  on public.company_account_plan_uploads (company_id)
  where is_active = true and deleted_at is null;

create index if not exists idx_account_plan_uploads_fingerprint
  on public.company_account_plan_uploads (company_id, content_fingerprint, created_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2) company_account_plan_accounts
-- ---------------------------------------------------------------------------

create table if not exists public.company_account_plan_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  upload_id uuid not null references public.company_account_plan_uploads(id),
  account_code text not null,
  account_name text not null,
  currency text not null default 'TL',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text,
  constraint uq_account_plan_accounts_upload_code unique (upload_id, account_code)
);

comment on table public.company_account_plan_accounts is
  'Hesap planı satırları — sürüm (upload) bazlı; tenant company_id ile izole.';

create index if not exists idx_account_plan_accounts_company_upload
  on public.company_account_plan_accounts (company_id, upload_id)
  where deleted_at is null;

create index if not exists idx_account_plan_accounts_company_code
  on public.company_account_plan_accounts (company_id, account_code)
  where deleted_at is null;

create index if not exists idx_account_plan_accounts_active_lookup
  on public.company_account_plan_accounts (company_id, upload_id, is_active)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3) user_app_notifications
-- ---------------------------------------------------------------------------

create table if not exists public.user_app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id text not null default '',
  dedupe_key text not null,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  deleted_at timestamptz,
  deleted_by text,
  constraint uq_user_app_notifications_dedupe unique (user_id, dedupe_key)
);

comment on table public.user_app_notifications is
  'Kullanıcıya özel uygulama bildirimleri. Hassas belge içeriği yok.';

create index if not exists idx_user_app_notifications_user_created
  on public.user_app_notifications (user_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_user_app_notifications_user_unread
  on public.user_app_notifications (user_id, created_at desc)
  where deleted_at is null and read_at is null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.company_account_plan_uploads enable row level security;
alter table public.company_account_plan_accounts enable row level security;
alter table public.user_app_notifications enable row level security;

revoke all on public.company_account_plan_uploads from anon;
revoke all on public.company_account_plan_accounts from anon;
revoke all on public.user_app_notifications from anon;

revoke insert, update, delete on public.company_account_plan_uploads from authenticated;
revoke insert, update, delete on public.company_account_plan_accounts from authenticated;
revoke insert, update, delete on public.user_app_notifications from authenticated;

grant select on public.company_account_plan_uploads to authenticated;
grant select on public.company_account_plan_accounts to authenticated;
grant select on public.user_app_notifications to authenticated;

grant all on public.company_account_plan_uploads to service_role;
grant all on public.company_account_plan_accounts to service_role;
grant all on public.user_app_notifications to service_role;

drop policy if exists "account_plan_uploads_select_member" on public.company_account_plan_uploads;
create policy "account_plan_uploads_select_member"
  on public.company_account_plan_uploads
  for select
  to authenticated
  using (
    deleted_at is null
    and public.annvero_can_access_company(company_id)
  );

drop policy if exists "account_plan_accounts_select_member" on public.company_account_plan_accounts;
create policy "account_plan_accounts_select_member"
  on public.company_account_plan_accounts
  for select
  to authenticated
  using (
    deleted_at is null
    and public.annvero_can_access_company(company_id)
  );

drop policy if exists "user_app_notifications_select_own" on public.user_app_notifications;
create policy "user_app_notifications_select_own"
  on public.user_app_notifications
  for select
  to authenticated
  using (
    deleted_at is null
    and user_id = auth.uid()
  );

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_account_plan_uploads'
      and policyname = 'account_plan_uploads_deny_write_authenticated'
  ) then
    drop policy "account_plan_uploads_deny_write_authenticated" on public.company_account_plan_uploads;
  end if;
  create policy "account_plan_uploads_deny_write_authenticated"
    on public.company_account_plan_uploads
    as restrictive
    for all
    to authenticated
    using (false)
    with check (false);

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_account_plan_accounts'
      and policyname = 'account_plan_accounts_deny_write_authenticated'
  ) then
    drop policy "account_plan_accounts_deny_write_authenticated" on public.company_account_plan_accounts;
  end if;
  create policy "account_plan_accounts_deny_write_authenticated"
    on public.company_account_plan_accounts
    as restrictive
    for all
    to authenticated
    using (false)
    with check (false);

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_app_notifications'
      and policyname = 'user_app_notifications_deny_write_authenticated'
  ) then
    drop policy "user_app_notifications_deny_write_authenticated" on public.user_app_notifications;
  end if;
  create policy "user_app_notifications_deny_write_authenticated"
    on public.user_app_notifications
    as restrictive
    for all
    to authenticated
    using (false)
    with check (false);
end $$;
