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
