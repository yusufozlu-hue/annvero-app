-- YENİ PROJE (projectRef: hzyxeifqcldwelvfhydl)
-- GİB credentials company_id eşleşmesini kontrol eder. SİLME YAPMAZ.

select
  g.company_id,
  g.gib_user_code,
  g.is_active,
  case
    when c.id is null then 'MISSING_COMPANY'
    else 'OK'
  end as company_link_status,
  c.company_name
from public.company_gib_credentials g
left join public.companies c on c.id = g.company_id
order by company_link_status desc, g.company_id;

select
  count(*) filter (where c.id is null) as orphan_gib_credentials,
  count(*) filter (where c.id is not null) as linked_gib_credentials
from public.company_gib_credentials g
left join public.companies c on c.id = g.company_id;
