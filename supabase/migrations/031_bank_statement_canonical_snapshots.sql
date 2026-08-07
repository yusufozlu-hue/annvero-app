-- ANNVERO 031 — Banka ekstresi canonical hareket snapshot (dosyasız reanalysis)
-- Forward-only, idempotent. Destructive SQL YOK.
-- Ham PDF/XLS/XLSX baytı, base64, Drive file ID, token saklanmaz.
-- PDF ve Excel aynı tabloları kullanır.
-- Yazma: service_role (API). Okuma: authenticated + annvero_can_access_company.

-- ---------------------------------------------------------------------------
-- 1) bank_statement_sources
-- ---------------------------------------------------------------------------

create table if not exists public.bank_statement_sources (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  content_hash text not null default '',
  file_name text not null default '',
  mime_type text not null default '',
  byte_length integer not null default 0 check (byte_length >= 0),
  detected_bank text not null default '',
  source_type text not null default 'unknown'
    check (source_type in ('pdf', 'excel', 'csv', 'unknown')),
  schema_version text not null default 'bank-canon-v1',
  plan_content_fingerprint text not null default '',
  plan_account_count integer not null default 0 check (plan_account_count >= 0),
  movement_count integer not null default 0 check (movement_count >= 0),
  status text not null default 'active'
    check (status in ('active', 'superseded', 'deleted')),
  revision integer not null default 1 check (revision >= 1),
  supersedes_source_id uuid references public.bank_statement_sources(id),
  v1_audit_entity_id text not null default '',
  safe_summary jsonb not null default '{}'::jsonb,
  created_by text not null default '',
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bank_statement_sources is
  'Banka ekstresi kaynak kimliği. Ham belge baytı yok; content_hash + meta.';

create unique index if not exists uq_bank_statement_sources_active_hash
  on public.bank_statement_sources (company_id, content_hash)
  where deleted_at is null
    and status = 'active'
    and content_hash <> '';

create index if not exists idx_bank_statement_sources_company_created
  on public.bank_statement_sources (company_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_bank_statement_sources_company_status
  on public.bank_statement_sources (company_id, status, created_at desc)
  where deleted_at is null;

create index if not exists idx_bank_statement_sources_v1_entity
  on public.bank_statement_sources (company_id, v1_audit_entity_id)
  where v1_audit_entity_id <> '' and deleted_at is null;

create or replace function public.bank_statement_sources_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_bank_statement_sources_set_updated_at
  on public.bank_statement_sources;
create trigger trg_bank_statement_sources_set_updated_at
before update on public.bank_statement_sources
for each row execute function public.bank_statement_sources_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) bank_statement_movements (canonical rows — PDF/Excel ortak)
-- ---------------------------------------------------------------------------

create table if not exists public.bank_statement_movements (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.bank_statement_sources(id),
  company_id text not null,
  source_movement_id text not null default '',
  sort_index integer not null default 0 check (sort_index >= 0),
  transaction_date text not null default '',
  value_date text not null default '',
  description text not null default '',
  amount numeric not null default 0,
  debit numeric not null default 0,
  credit numeric not null default 0,
  balance numeric,
  currency text not null default 'TRY',
  direction text not null default ''
    check (direction in ('', 'GIRIS', 'CIKIS', 'BORC', 'ALACAK')),
  movement_type text not null default '',
  classification text not null default '',
  source_page integer,
  source_row integer,
  source_sheet text not null default '',
  confidence numeric,
  low_confidence boolean not null default false,
  review_required boolean not null default false,
  status text not null default 'ok',
  schema_version text not null default 'bank-canon-v1',
  safe_extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

comment on table public.bank_statement_movements is
  'Canonical banka hareketleri (PDF/Excel). Drive ID / ham dosya yok.';

create unique index if not exists uq_bank_statement_movements_source_mid
  on public.bank_statement_movements (source_id, source_movement_id)
  where deleted_at is null and source_movement_id <> '';

create index if not exists idx_bank_statement_movements_source_sort
  on public.bank_statement_movements (source_id, sort_index)
  where deleted_at is null;

create index if not exists idx_bank_statement_movements_company
  on public.bank_statement_movements (company_id, created_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- RLS — fail-closed yazma; okuma üyelik tabanlı
-- ---------------------------------------------------------------------------

alter table public.bank_statement_sources enable row level security;
alter table public.bank_statement_movements enable row level security;

revoke all on public.bank_statement_sources from anon;
revoke all on public.bank_statement_movements from anon;

revoke insert, update, delete on public.bank_statement_sources from authenticated;
revoke insert, update, delete on public.bank_statement_movements from authenticated;

grant select on public.bank_statement_sources to authenticated;
grant select on public.bank_statement_movements to authenticated;

grant all on public.bank_statement_sources to service_role;
grant all on public.bank_statement_movements to service_role;

drop policy if exists "bank_statement_sources_select_member"
  on public.bank_statement_sources;
create policy "bank_statement_sources_select_member"
  on public.bank_statement_sources
  for select
  to authenticated
  using (
    deleted_at is null
    and public.annvero_can_access_company(company_id)
  );

drop policy if exists "bank_statement_movements_select_member"
  on public.bank_statement_movements;
create policy "bank_statement_movements_select_member"
  on public.bank_statement_movements
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
    drop policy if exists "bank_statement_sources_deny_write"
      on public.bank_statement_sources;
    create policy "bank_statement_sources_deny_write"
      on public.bank_statement_sources
      as restrictive
      for all
      to authenticated
      using (public.annvero_deny_authenticated_writes())
      with check (public.annvero_deny_authenticated_writes());

    drop policy if exists "bank_statement_movements_deny_write"
      on public.bank_statement_movements;
    create policy "bank_statement_movements_deny_write"
      on public.bank_statement_movements
      as restrictive
      for all
      to authenticated
      using (public.annvero_deny_authenticated_writes())
      with check (public.annvero_deny_authenticated_writes());
  end if;
end $$;
