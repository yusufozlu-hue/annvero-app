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
