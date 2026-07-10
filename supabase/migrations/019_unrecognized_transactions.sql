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
