-- ESKİ PROJE (projectRef: ttxigznwcjvrlzupbbro) SQL Editor'da çalıştırın.
-- Amaç: Firma kayıtlarını JSON olarak dışa aktarmak. SİLME YAPMAZ.
--
-- Sonuç tek satır JSON döner. Sonucu kopyalayıp yeni projede
-- import_companies_from_json.sql dosyasına yapıştırın.

select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'company_name', company_name,
      'data', data,
      'created_at', created_at,
      'updated_at', updated_at
    )
    order by created_at asc nulls last
  ),
  '[]'::jsonb
) as companies_export
from public.companies;

-- Alternatif: CSV export için (Dashboard Table Editor -> Export da kullanılabilir)
-- select id, company_name, data::text as data_json, created_at, updated_at
-- from public.companies
-- order by created_at asc;

-- GİB credentials eşleşmesi için company_id listesi (taşıma sonrası kontrol)
select
  c.id as company_id,
  c.company_name,
  exists (
    select 1
    from public.company_gib_credentials g
    where g.company_id = c.id
  ) as has_gib_credentials
from public.companies c
order by c.company_name;
