-- ANNVERO learning_memory taban şeması (production'dan doğrulanan)
-- Bu dosya boş projede 008/009'dan ÖNCE tabloyu garanti eder.
-- 008 ve 009 ek kolonları (add column if not exists) ekler.
-- 015 deleted_at/deleted_by kolonlarını ve authenticated policy'lerini ekler.
-- Not: Burada anon/public erişim policy'si OLUŞTURULMAZ (fail-closed).

create table if not exists public.learning_memory (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  keyword text not null,
  account_code text,
  account_name text,
  counter_account_code text,
  counter_account_name text,
  document_type text,
  transaction_type text,
  description_format text,
  source_module text default 'manual',
  usage_count integer default 0,
  is_active boolean default true,
  last_used_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_learning_memory_company_id
  on public.learning_memory (company_id);

create index if not exists idx_learning_memory_keyword
  on public.learning_memory (keyword);

alter table public.learning_memory enable row level security;
