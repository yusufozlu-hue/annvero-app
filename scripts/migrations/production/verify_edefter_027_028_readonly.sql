-- Salt okunur doğrulama: 027 learning_memory lookup indexes
-- Production veya staging SQL editor'da çalıştırın. Destructive SQL yok.

select
  i.relname as index_name,
  case when i.relname is not null then 'mevcut' else 'eksik' end as durum
from (
  values
    ('idx_learning_memory_company_active'),
    ('idx_learning_memory_company_keyword_active'),
    ('idx_learning_memory_company_usage'),
    ('idx_learning_memory_company_last_used')
) as wanted(index_name)
left join pg_class t on t.relname = 'learning_memory' and t.relkind = 'r'
left join pg_index x on x.indrelid = t.oid
left join pg_class i on i.oid = x.indexrelid and i.relname = wanted.index_name
order by wanted.index_name;

-- 028 varlık kontrolü
select
  c.relname as relation_name,
  case when c.oid is not null then 'mevcut' else 'eksik' end as durum
from (
  values
    ('edefter_control_runs'),
    ('edefter_control_findings'),
    ('edefter_control_audit_events')
) as wanted(relation_name)
left join pg_class c
  on c.relname = wanted.relation_name
 and c.relkind = 'r'
 and c.relnamespace = 'public'::regnamespace
order by wanted.relation_name;
