-- ANNVERO 032 — Belgeye özel hesap çözüm kararları (revision overlay)
-- Forward-only, idempotent. Destructive SQL YOK.
-- Canonical hareketler mutasyona uğramaz; kararlar ayrı tabloda kalır.
-- Yazma: service_role (API). Okuma: authenticated + annvero_can_access_company.

create table if not exists public.bank_statement_movement_resolutions (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  source_id uuid not null references public.bank_statement_sources(id),
  source_movement_id text not null default '',
  luca_leg text not null default ''
    check (luca_leg in ('', 'counter', 'bank', 'fee', 'tax')),
  account_code text not null default '',
  account_name text not null default '',
  direction text not null default ''
    check (direction in ('', 'GIRIS', 'CIKIS', 'BORC', 'ALACAK', 'GELEN', 'GIDEN')),
  analysis_key text not null default '',
  transaction_type text not null default '',
  decision_type text not null default 'DIRECT_ACCOUNT',
  learn_for_company boolean not null default false,
  user_approved boolean not null default true,
  status text not null default 'active'
    check (status in ('active', 'superseded', 'undone')),
  revision integer not null default 1 check (revision >= 1),
  supersedes_resolution_id uuid
    references public.bank_statement_movement_resolutions(id),
  source_revision integer not null default 1 check (source_revision >= 1),
  audit_note text not null default '',
  created_by text not null default '',
  undone_by text not null default '',
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

comment on table public.bank_statement_movement_resolutions is
  'Belgeye özel onaylı hesap kararları. company+source+source_movement_id. Snapshot hareketlerini mutasyona uğratmaz.';

create unique index if not exists uq_bank_stmt_resolutions_active_mid
  on public.bank_statement_movement_resolutions (
    source_id,
    source_movement_id,
    luca_leg
  )
  where deleted_at is null
    and status = 'active'
    and source_movement_id <> '';

create index if not exists idx_bank_stmt_resolutions_company_source
  on public.bank_statement_movement_resolutions (company_id, source_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_bank_stmt_resolutions_source_active
  on public.bank_statement_movement_resolutions (source_id, status, revision desc)
  where deleted_at is null;

create or replace function public.bank_statement_movement_resolutions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_bank_statement_movement_resolutions_set_updated_at
  on public.bank_statement_movement_resolutions;
create trigger trg_bank_statement_movement_resolutions_set_updated_at
before update on public.bank_statement_movement_resolutions
for each row execute function public.bank_statement_movement_resolutions_set_updated_at();

alter table public.bank_statement_movement_resolutions enable row level security;

revoke all on public.bank_statement_movement_resolutions from anon;
revoke insert, update, delete on public.bank_statement_movement_resolutions from authenticated;
grant select on public.bank_statement_movement_resolutions to authenticated;
grant all on public.bank_statement_movement_resolutions to service_role;

drop policy if exists "bank_statement_movement_resolutions_select_member"
  on public.bank_statement_movement_resolutions;
create policy "bank_statement_movement_resolutions_select_member"
  on public.bank_statement_movement_resolutions
  for select
  to authenticated
  using (
    deleted_at is null
    and public.annvero_can_access_company(company_id)
  );

do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'annvero_deny_authenticated_writes'
  ) then
    drop policy if exists "bank_statement_movement_resolutions_deny_write"
      on public.bank_statement_movement_resolutions;
    create policy "bank_statement_movement_resolutions_deny_write"
      on public.bank_statement_movement_resolutions
      as restrictive
      for all
      to authenticated
      using (public.annvero_deny_authenticated_writes())
      with check (public.annvero_deny_authenticated_writes());
  end if;
end $$;
