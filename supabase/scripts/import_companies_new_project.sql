-- YENİ PROJE (projectRef: hzyxeifqcldwelvfhydl) SQL Editor'da çalıştırın.
-- Önkoşul: 007_companies_table.sql migration uygulanmış olmalı.
-- SİLME YAPMAZ — sadece upsert (id çakışırsa günceller).
--
-- Kullanım:
-- 1) Eski projede export_companies_old_project.sql çalıştırın.
-- 2) Dönen companies_export JSON'unu aşağıdaki :import_payload yerine yapıştırın.
-- 3) Bu dosyayı yeni projede çalıştırın.

begin;

with import_payload as (
  select '[]'::jsonb as rows
  -- ÖRNEK:
  -- select '[{"id":"...","company_name":"...","data":{...},"created_at":"...","updated_at":"..."}]'::jsonb as rows
),
normalized as (
  select
    (row->>'id')::text as id,
    (row->>'company_name')::text as company_name,
    coalesce(row->'data', '{}'::jsonb) as data,
    coalesce((row->>'created_at')::timestamptz, now()) as created_at,
    coalesce((row->>'updated_at')::timestamptz, now()) as updated_at
  from import_payload,
  lateral jsonb_array_elements(import_payload.rows) as row
  where coalesce(row->>'id', '') <> ''
    and coalesce(row->>'company_name', '') <> ''
)
insert into public.companies (id, company_name, data, created_at, updated_at)
select id, company_name, data, created_at, updated_at
from normalized
on conflict (id) do update
set
  company_name = excluded.company_name,
  data = excluded.data,
  updated_at = excluded.updated_at;

-- Taşıma sonrası kontrol
select
  count(*) as imported_count,
  min(created_at) as oldest_created_at,
  max(updated_at) as newest_updated_at
from public.companies;

commit;
