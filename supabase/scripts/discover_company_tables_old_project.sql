-- ESKİ PROJE (projectRef: ttxigznwcjvrlzupbbro) SQL Editor'da çalıştırın.
-- Amaç: Firma verisinin hangi tabloda olduğunu bulmak. SİLME YAPMAZ.

-- 1) public.companies var mı?
select
  'public.companies' as candidate,
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'companies'
  ) as table_exists;

-- 2) Firma benzeri tablo adlarını listele
select
  table_schema,
  table_name
from information_schema.tables
where table_schema = 'public'
  and (
    table_name ilike '%compan%'
    or table_name ilike '%firma%'
    or table_name ilike '%mukellef%'
  )
order by table_name;

-- 3) companies tablosu varsa satır sayısı
select count(*) as companies_row_count
from public.companies;

-- 4) Örnek kayıt yapısı (ilk 3 satır, data boyutu)
select
  id,
  company_name,
  jsonb_typeof(data) as data_type,
  pg_column_size(data) as data_bytes,
  created_at,
  updated_at
from public.companies
order by created_at asc nulls last
limit 3;
