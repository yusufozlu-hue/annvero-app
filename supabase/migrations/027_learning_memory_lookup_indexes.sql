-- Additive indexes for learning_memory lookup performance (no data delete/merge).
-- Safe for production: IF NOT EXISTS only.

create index if not exists idx_learning_memory_company_active
  on public.learning_memory (company_id, is_active);

create index if not exists idx_learning_memory_company_keyword_active
  on public.learning_memory (company_id, keyword, is_active);

create index if not exists idx_learning_memory_company_usage
  on public.learning_memory (company_id, usage_count desc nulls last);

create index if not exists idx_learning_memory_company_last_used
  on public.learning_memory (company_id, last_used_at desc nulls last);
