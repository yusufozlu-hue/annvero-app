-- Öğrenen Hafıza ikinci aşama: otomatik eşleşme ve kullanım metrikleri
alter table public.learning_memory
  add column if not exists bank_name text,
  add column if not exists amount numeric,
  add column if not exists status text not null default 'active',
  add column if not exists match_count integer not null default 0,
  add column if not exists last_matched_at timestamptz;

create index if not exists idx_learning_memory_company_status
  on public.learning_memory (company_id, status);

create index if not exists idx_learning_memory_bank_name
  on public.learning_memory (company_id, bank_name);
