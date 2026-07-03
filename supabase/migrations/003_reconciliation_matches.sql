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
