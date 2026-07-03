-- YENİ PROJE (projectRef: hzyxeifqcldwelvfhydl) SQL Editor'da çalıştırın.
-- Eski Supabase erişimi GEREKMEZ.
-- Önkoşul: 007_companies_table.sql uygulanmış olmalı.
-- SİLME YAPMAZ — upsert (id çakışırsa günceller).
--
-- Veri kaynağı seçenekleri (eski proje olmadan):
-- A) Tarayıcı localStorage -> supabase/scripts/browser_export_annvero_companies.js
-- B) POST /api/companies/migrate (JSON body)
-- C) Aşağıdaki import_payload JSON'unu yapıştır

begin;

with import_payload as (
  select
    -- BURAYA browser_export_annvero_companies.js çıktısını yapıştırın:
    '[]'::jsonb as rows
),
normalized as (
  select
    (row->>'id')::text as id,
    coalesce(nullif(trim(row->>'company_name'), ''), nullif(trim(row->'data'->>'companyName'), '')) as company_name,
    coalesce(row->'data', '{}'::jsonb) as data,
    coalesce((row->>'created_at')::timestamptz, now()) as created_at,
    coalesce((row->>'updated_at')::timestamptz, now()) as updated_at
  from import_payload,
  lateral jsonb_array_elements(import_payload.rows) as row
  where coalesce(row->>'id', '') <> ''
    and coalesce(
      nullif(trim(row->>'company_name'), ''),
      nullif(trim(row->'data'->>'companyName'), '')
    ) is not null
)
insert into public.companies (id, company_name, data, created_at, updated_at)
select id, company_name, data, created_at, updated_at
from normalized
on conflict (id) do update
set
  company_name = excluded.company_name,
  data = excluded.data,
  updated_at = excluded.updated_at;

select
  count(*) as total_companies,
  count(*) filter (where updated_at >= now() - interval '5 minutes') as touched_recently
from public.companies;

commit;
