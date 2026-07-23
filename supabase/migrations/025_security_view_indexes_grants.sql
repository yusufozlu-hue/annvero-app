-- ANNVERO Güvenlik kapanış — forward-only migration 025 (V4.1 sözleşme)
-- Tenant index + grant/policy doğrulama. DROP POLICY YOK. View ALTER YOK.
-- Önkoşul: 020→021→022→023 + 024.
-- ÜYELİK: annvero_company_members.user_id (auth_user_id yasak).
-- security_invoker UYGULANMAZ; view envanteri preflight işidir.

create or replace function public.annvero_ensure_index_if_columns(
  p_schema text,
  p_table text,
  p_index_name text,
  p_create_sql text,
  p_required_columns text[],
  p_table_required boolean,
  p_expected_columns text[] default null,
  p_expect_unique boolean default false,
  p_expected_pred text default null
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_rel regclass;
  v_col text;
  v_table text;
  v_cols text[];
  v_dirs text[];
  v_pred text;
  v_unique boolean;
  v_valid boolean;
  v_ready boolean;
  v_pred_norm text;
  v_exp_pred_norm text;
  v_found boolean := false;
  v_expected_dirs text[];
begin
  v_rel := to_regclass(format('%I.%I', p_schema, p_table));
  if v_rel is null then
    if p_table_required then
      raise exception '025: zorunlu tablo yok: %.%', p_schema, p_table;
    end if;
    raise notice '025 skip: %.% yok', p_schema, p_table;
    return;
  end if;

  foreach v_col in array p_required_columns loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = p_schema
        and c.table_name = p_table
        and c.column_name = v_col
    ) then
      raise exception
        '025: %.%.% kolonu eksik — index % oluşturulamaz',
        p_schema, p_table, v_col, p_index_name;
    end if;
  end loop;

  -- Katalog oku: key kolonları indnkeyatts ile INCLUDE'dan ayrılır;
  -- yönler indkey/indoption paired WITH ORDINALITY (off-by-one yasak).
  select
    true,
    t.relname,
    coalesce((
      select array_agg(a.attname::text order by k.ord)
      from unnest(i.indkey) with ordinality as k(attnum, ord)
      join pg_catalog.pg_attribute a
        on a.attrelid = i.indrelid and a.attnum = k.attnum and a.attnum > 0
      where k.ord <= i.indnkeyatts
    ), array[]::text[]),
    coalesce((
      select array_agg(
        case when (o.opt & 1) = 1 then 'DESC' else 'ASC' end
        order by k.ord
      )
      from unnest(i.indkey) with ordinality as k(attnum, ord)
      join unnest(i.indoption) with ordinality as o(opt, ord) on o.ord = k.ord
      where k.ord <= i.indnkeyatts
    ), array[]::text[]),
    pg_catalog.pg_get_expr(i.indpred, i.indrelid),
    i.indisunique,
    i.indisvalid,
    i.indisready
  into v_found, v_table, v_cols, v_dirs, v_pred, v_unique, v_valid, v_ready
  from pg_catalog.pg_class idx
  join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
  join pg_catalog.pg_index i on i.indexrelid = idx.oid
  join pg_catalog.pg_class t on t.oid = i.indrelid
  where n.nspname = p_schema
    and idx.relname = p_index_name
    and idx.relkind = 'i';

  if not found then
    v_found := false;
  end if;

  if not v_found then
    execute p_create_sql;
    -- CREATE sonrası aynı katalog doğrulaması (yalnız EXECUTE + return yok)
    select
      true,
      t.relname,
      coalesce((
        select array_agg(a.attname::text order by k.ord)
        from unnest(i.indkey) with ordinality as k(attnum, ord)
        join pg_catalog.pg_attribute a
          on a.attrelid = i.indrelid and a.attnum = k.attnum and a.attnum > 0
        where k.ord <= i.indnkeyatts
      ), array[]::text[]),
      coalesce((
        select array_agg(
          case when (o.opt & 1) = 1 then 'DESC' else 'ASC' end
          order by k.ord
        )
        from unnest(i.indkey) with ordinality as k(attnum, ord)
        join unnest(i.indoption) with ordinality as o(opt, ord) on o.ord = k.ord
        where k.ord <= i.indnkeyatts
      ), array[]::text[]),
      pg_catalog.pg_get_expr(i.indpred, i.indrelid),
      i.indisunique,
      i.indisvalid,
      i.indisready
    into v_found, v_table, v_cols, v_dirs, v_pred, v_unique, v_valid, v_ready
    from pg_catalog.pg_class idx
    join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
    join pg_catalog.pg_index i on i.indexrelid = idx.oid
    join pg_catalog.pg_class t on t.oid = i.indrelid
    where n.nspname = p_schema
      and idx.relname = p_index_name
      and idx.relkind = 'i';

    if not coalesce(v_found, false) then
      raise exception '025: index % CREATE sonrası bulunamadı', p_index_name;
    end if;
  end if;

  if v_table is distinct from p_table then
    raise exception '025: index % yanlış tablo (%, beklenen %)', p_index_name, v_table, p_table;
  end if;
  if p_expected_columns is not null and v_cols is distinct from p_expected_columns then
    raise exception '025: index % kolon/sıra uyumsuz (%, beklenen %)', p_index_name, v_cols, p_expected_columns;
  end if;
  if v_unique is distinct from coalesce(p_expect_unique, false) then
    raise exception '025: index % unique uyumsuz', p_index_name;
  end if;
  v_pred_norm := lower(replace(coalesce(v_pred, ''), ' ', ''));
  v_exp_pred_norm := lower(replace(coalesce(p_expected_pred, ''), ' ', ''));
  if coalesce(v_pred_norm, '') is distinct from coalesce(v_exp_pred_norm, '') then
    raise exception '025: index % predicate uyumsuz (%, beklenen %)', p_index_name, v_pred, p_expected_pred;
  end if;
  if not coalesce(v_valid, false) or not coalesce(v_ready, false) then
    raise exception '025: index % valid/ready değil', p_index_name;
  end if;

  -- Helper ile oluşturulan bütün 025 index'leri ASC; aynı isimli DESC kabul edilmez
  v_expected_dirs := (
    select coalesce(array_agg('ASC'::text), array[]::text[])
    from generate_series(1, greatest(coalesce(array_length(v_cols, 1), 0), 0))
  );
  if v_dirs is distinct from v_expected_dirs then
    raise exception
      '025: index % yön uyumsuz (%, beklenen ASC-only %)',
      p_index_name, v_dirs, v_expected_dirs;
  end if;
end;
$$;

revoke all on function public.annvero_ensure_index_if_columns(text, text, text, text, text[], boolean, text[], boolean, text) from public;
revoke all on function public.annvero_ensure_index_if_columns(text, text, text, text, text[], boolean, text[], boolean, text) from anon, authenticated, service_role;

-- Eski 7-arg overload varsa DROP etme; yalnız EXECUTE revoke (owner-only)
do $$
begin
  if to_regprocedure('public.annvero_ensure_index_if_columns(text,text,text,text,text[],boolean,text)') is not null then
    revoke all on function public.annvero_ensure_index_if_columns(text, text, text, text, text[], boolean, text) from public;
    revoke all on function public.annvero_ensure_index_if_columns(text, text, text, text, text[], boolean, text) from anon, authenticated, service_role;
  end if;
end;
$$;

do $$
begin
  perform public.annvero_ensure_index_if_columns(
    'public', 'annvero_company_members',
    'idx_annvero_company_members_user_active',
    'create index idx_annvero_company_members_user_active on public.annvero_company_members (user_id) where (is_active = true)',
    array['user_id', 'is_active'], true,
    array['user_id'], false, '(is_active = true)'
  );
  perform public.annvero_ensure_index_if_columns(
    'public', 'annvero_company_members',
    'idx_annvero_company_members_company_active',
    'create index idx_annvero_company_members_company_active on public.annvero_company_members (company_id) where (is_active = true)',
    array['company_id', 'is_active'], true,
    array['company_id'], false, '(is_active = true)'
  );

  if to_regclass('public.learning_memory') is not null then
    perform public.annvero_ensure_index_if_columns(
      'public', 'learning_memory',
      'idx_learning_memory_company_deleted',
      'create index idx_learning_memory_company_deleted on public.learning_memory (company_id, deleted_at)',
      array['company_id', 'deleted_at'], false,
      array['company_id', 'deleted_at'], false, null
    );
  else
    raise notice '025 skip: learning_memory yok';
  end if;

  if to_regclass('public.reconciliation_matches') is not null then
    perform public.annvero_ensure_index_if_columns(
      'public', 'reconciliation_matches',
      'idx_reconciliation_matches_company_deleted',
      'create index idx_reconciliation_matches_company_deleted on public.reconciliation_matches (company_id, deleted_at)',
      array['company_id', 'deleted_at'], false,
      array['company_id', 'deleted_at'], false, null
    );
  else
    raise notice '025 skip: reconciliation_matches yok';
  end if;

  if to_regclass('public.normalized_financial_transactions') is not null then
    perform public.annvero_ensure_index_if_columns(
      'public', 'normalized_financial_transactions',
      'idx_nft_company_deleted',
      'create index idx_nft_company_deleted on public.normalized_financial_transactions (company_id, deleted_at)',
      array['company_id', 'deleted_at'], false,
      array['company_id', 'deleted_at'], false, null
    );
  else
    raise notice '025 skip: normalized_financial_transactions yok';
  end if;

  perform public.annvero_ensure_index_if_columns(
    'public', 'audit_events',
    'idx_audit_events_company_id',
    'create index idx_audit_events_company_id on public.audit_events (company_id)',
    array['company_id'], true,
    array['company_id'], false, null
  );

  perform public.annvero_ensure_index_if_columns(
    'public', 'recovery_restore_approvals',
    'idx_recovery_restore_approvals_record',
    'create index idx_recovery_restore_approvals_record on public.recovery_restore_approvals (table_name, record_id)',
    array['table_name', 'record_id'], true,
    array['table_name', 'record_id'], false, null
  );
end;
$$;

do $$
declare
  r record;
  v_permissive boolean;
  v_cmd char;
  v_roles name[];
  v_qual text;
  v_with_check text;
  priv text;
  role_name text;
  ok boolean;
begin
  if to_regclass('public.rate_limit_buckets') is null
     or to_regclass('public.audit_events') is null
     or to_regclass('public.login_events') is null
     or to_regclass('public.recovery_restore_approvals') is null then
    raise exception '025: 024 tabloları eksik';
  end if;

  revoke all on table public.rate_limit_buckets from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on table public.audit_events from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on table public.login_events from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on table public.recovery_restore_approvals from public, anon, authenticated;
  revoke delete, truncate, references, trigger
    on table public.recovery_restore_approvals from service_role;
  revoke update, delete, truncate, references, trigger
    on table public.audit_events from service_role;
  revoke update, delete, truncate, references, trigger
    on table public.login_events from service_role;

  -- Rate-limit: PUBLIC/anon/authenticated all 7 false; service_role S/I/U/D true; T/R/Trig false
  foreach role_name in array array['public', 'anon', 'authenticated'] loop
    foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(role_name, 'public.rate_limit_buckets', priv) then
        raise exception '025: rate_limit_buckets %.% true olmamalı', role_name, priv;
      end if;
    end loop;
  end loop;
  foreach priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if not has_table_privilege('service_role', 'public.rate_limit_buckets', priv) then
      raise exception '025: rate_limit_buckets service_role.% false', priv;
    end if;
  end loop;
  foreach priv in array array['TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('service_role', 'public.rate_limit_buckets', priv) then
      raise exception '025: rate_limit_buckets service_role.% true olmamalı', priv;
    end if;
  end loop;

  -- Recovery: PUBLIC/anon all false; authenticated SELECT only; service_role S/I/U
  foreach role_name in array array['public', 'anon'] loop
    foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(role_name, 'public.recovery_restore_approvals', priv) then
        raise exception '025: recovery %.% true olmamalı', role_name, priv;
      end if;
    end loop;
  end loop;
  if not has_table_privilege('authenticated', 'public.recovery_restore_approvals', 'SELECT') then
    raise exception '025: recovery authenticated SELECT false';
  end if;
  foreach priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.recovery_restore_approvals', priv) then
      raise exception '025: recovery authenticated.% true olmamalı', priv;
    end if;
  end loop;
  foreach priv in array array['SELECT','INSERT','UPDATE'] loop
    if not has_table_privilege('service_role', 'public.recovery_restore_approvals', priv) then
      raise exception '025: recovery service_role.% false', priv;
    end if;
  end loop;
  foreach priv in array array['DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('service_role', 'public.recovery_restore_approvals', priv) then
      raise exception '025: recovery service_role.% true olmamalı', priv;
    end if;
  end loop;

  -- Audit/login: client DML+T/R/Trig false; service_role SELECT+INSERT only
  foreach role_name in array array['public', 'anon', 'authenticated'] loop
    foreach priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(role_name, 'public.audit_events', priv)
         or has_table_privilege(role_name, 'public.login_events', priv) then
        raise exception '025: audit/login %.% true olmamalı', role_name, priv;
      end if;
    end loop;
  end loop;
  foreach priv in array array['SELECT','INSERT'] loop
    if not has_table_privilege('service_role', 'public.audit_events', priv)
       or not has_table_privilege('service_role', 'public.login_events', priv) then
      raise exception '025: audit/login service_role.% false', priv;
    end if;
  end loop;
  foreach priv in array array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('service_role', 'public.audit_events', priv)
       or has_table_privilege('service_role', 'public.login_events', priv) then
      raise exception '025: audit/login service_role.% true olmamalı', priv;
    end if;
  end loop;

  -- Function EXECUTE contracts
  if has_function_privilege('public', 'public.annvero_rate_limit_consume(text,integer,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.annvero_rate_limit_consume(text,integer,bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.annvero_rate_limit_consume(text,integer,bigint)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.annvero_rate_limit_consume(text,integer,bigint)', 'EXECUTE') then
    raise exception '025: rate_limit RPC EXECUTE sözleşmesi bozulmuş';
  end if;

  foreach role_name in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(role_name, 'public.annvero_ensure_restrictive_deny_policy(text,text,text,text)', 'EXECUTE')
       or has_function_privilege(role_name, 'public.annvero_assert_table_column(text,text,text,text,text,boolean)', 'EXECUTE')
       or has_function_privilege(role_name, 'public.annvero_ensure_index_if_columns(text,text,text,text,text[],boolean,text[],boolean,text)', 'EXECUTE') then
      raise exception '025: helper EXECUTE % için açık', role_name;
    end if;
    if to_regprocedure('public.annvero_assert_fn_contract(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text)') is not null
       and has_function_privilege(role_name, 'public.annvero_assert_fn_contract(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text)', 'EXECUTE') then
      raise exception '025: assert_fn_contract EXECUTE % için açık', role_name;
    end if;
    if to_regprocedure('public.annvero_ensure_index_if_columns(text,text,text,text,text[],boolean,text)') is not null
       and has_function_privilege(role_name, 'public.annvero_ensure_index_if_columns(text,text,text,text,text[],boolean,text)', 'EXECUTE') then
      raise exception '025: eski helper overload EXECUTE % için açık', role_name;
    end if;
  end loop;

  -- V4.5 defense-in-depth: re-assert 024 function + companies contracts (no body rewrite)
  if to_regprocedure('public.annvero_assert_fn_contract(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text)') is null then
    raise exception '025: annvero_assert_fn_contract eksik (024 gerekli)';
  end if;

  perform public.annvero_assert_fn_contract(
    'public.annvero_profile_role()', 'f', 'text', 'sql', 's', true, 'postgres',
    'pg_catalog,pg_temp', false, false, true, true,
    $body$
  select p.role
  from public.annvero_user_profiles p
  where p.is_active = true
    and p.auth_user_id = auth.uid()
  order by p.updated_at desc nulls last
  limit 1;
$body$
  );
  perform public.annvero_assert_fn_contract(
    'public.annvero_jwt_role()', 'f', 'text', 'sql', 's', true, 'postgres',
    'pg_catalog,pg_temp', false, false, true, true,
    $body$
  select coalesce(
    nullif(public.annvero_profile_role(), ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'annvero_role', ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    ''
  );
$body$
  );
  perform public.annvero_assert_fn_contract(
    'public.annvero_profile_company_ids()', 'f', 'text[]', 'sql', 's', true, 'postgres',
    'pg_catalog,pg_temp', false, false, true, true,
    $body$
  select coalesce(array_agg(m.company_id), array[]::text[])
  from public.annvero_company_members m
  where m.is_active = true
    and m.user_id = auth.uid();
$body$
  );
  perform public.annvero_assert_fn_contract(
    'public.annvero_jwt_company_ids()', 'f', 'text[]', 'sql', 's', true, 'postgres',
    'pg_catalog,pg_temp', false, false, true, true,
    $body$
  select public.annvero_profile_company_ids();
$body$
  );
  perform public.annvero_assert_fn_contract(
    'public.annvero_can_access_company(text)', 'f', 'boolean', 'plpgsql', 's', true, 'postgres',
    'pg_catalog,pg_temp', false, false, true, true,
    $body$
declare
  role text;
  ids text[];
begin
  if auth.uid() is null then
    return false;
  end if;

  if target_company_id is null or btrim(target_company_id) = '' then
    return false;
  end if;

  role := public.annvero_jwt_role();

  if role in ('admin', 'partner') then
    return true;
  end if;

  ids := public.annvero_jwt_company_ids();

  if coalesce(array_length(ids, 1), 0) = 0 then
    return false;
  end if;

  return target_company_id = any (ids);
end;
$body$
  );
  perform public.annvero_assert_fn_contract(
    'public.annvero_is_management()', 'f', 'boolean', 'sql', 's', false, 'postgres',
    'pg_catalog,pg_temp', false, false, true, true,
    $body$
  select public.annvero_jwt_role() in ('admin', 'partner', 'mudur');
$body$
  );
  perform public.annvero_assert_fn_contract(
    'public.annvero_sync_company_membership(uuid,text[],uuid)', 'f', 'void', 'plpgsql', 'v', true, 'postgres',
    'pg_catalog,pg_temp', false, false, false, true,
    $body$
declare
  v_ids text[];
begin
  if target_user_id is null then
    raise exception 'annvero_sync_company_membership: target_user_id zorunludur';
  end if;

  v_ids := (
    select coalesce(array_agg(distinct btrim(x)), array[]::text[])
    from unnest(coalesce(target_company_ids, array[]::text[])) as x
    where btrim(coalesce(x, '')) <> ''
  );

  update public.annvero_company_members m
  set is_active = false, updated_at = now()
  where m.user_id = target_user_id
    and m.is_active = true
    and m.company_id <> all (v_ids);

  if array_length(v_ids, 1) is not null then
    insert into public.annvero_company_members as m
      (user_id, company_id, is_active, created_by, updated_at)
    select target_user_id, cid, true, actor_user_id, now()
    from unnest(v_ids) as cid
    on conflict (user_id, company_id)
    do update set is_active = true, updated_at = now();
  end if;
end;
$body$
  );
  perform public.annvero_assert_fn_contract(
    'public.annvero_rate_limit_consume(text,integer,bigint)',
    'f',
    'TABLE(allowed boolean, current_count integer, reset_at timestamp with time zone, remaining integer)',
    'plpgsql', 'v', true, 'postgres',
    'pg_catalog,pg_temp', false, false, false, true,
    $body$
declare
  v_key text;
  v_limit integer;
  v_window_ms bigint;
  v_window interval;
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_reset timestamptz;
begin
  v_key := nullif(btrim(coalesce(p_bucket_key, '')), '');
  if v_key is null or char_length(v_key) <> 64 or v_key !~ '^[a-f0-9]{64}$' then
    raise exception 'annvero_rate_limit_consume: bucket_key tam 64 hex SHA-256 olmalı';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 1000000 then
    raise exception 'annvero_rate_limit_consume: p_limit 1..1000000 olmalı';
  end if;
  if p_window_ms is null or p_window_ms < 1000 or p_window_ms > 86400000 then
    raise exception 'annvero_rate_limit_consume: p_window_ms 1000..86400000 olmalı';
  end if;

  v_limit := p_limit;
  v_window_ms := p_window_ms;
  -- ms hassasiyeti korunur (integer saniye kesmesi yok)
  v_window := interval '1 second' * (v_window_ms::double precision / 1000.0);

  insert into public.rate_limit_buckets as b (bucket_key, count, reset_at, updated_at)
  values (v_key, 1, v_now + v_window, v_now)
  on conflict (bucket_key) do update
    set
      count = case
        when b.reset_at > v_now then
          least(b.count::bigint + 1, v_limit::bigint + 1)::integer
        else 1
      end,
      reset_at = case when b.reset_at > v_now then b.reset_at else v_now + v_window end,
      updated_at = v_now
  returning b.count, b.reset_at into v_count, v_reset;

  allowed := v_count <= v_limit;
  current_count := v_count;
  reset_at := v_reset;
  remaining := greatest(v_limit - v_count, 0);
  return next;
end;
$body$
  );

  if to_regclass('public.companies') is null then
    raise exception '025: public.companies yok';
  end if;
  foreach role_name in array array['public', 'anon'] loop
    foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(role_name, 'public.companies', priv) then
        raise exception '025: companies %.% true olmamalı', role_name, priv;
      end if;
    end loop;
  end loop;
  if not has_table_privilege('authenticated', 'public.companies', 'SELECT') then
    raise exception '025: companies authenticated SELECT eksik';
  end if;
  foreach priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.companies', priv) then
      raise exception '025: companies authenticated.% true olmamalı', priv;
    end if;
  end loop;
  foreach priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if not has_table_privilege('service_role', 'public.companies', priv) then
      raise exception '025: companies service_role.% eksik', priv;
    end if;
  end loop;
  foreach priv in array array['TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('service_role', 'public.companies', priv) then
      raise exception '025: companies service_role.% fazla', priv;
    end if;
  end loop;

  for r in
    select * from (values
      ('audit_events', 'audit_events_no_insert_client', 'a'),
      ('audit_events', 'audit_events_no_update', 'w'),
      ('audit_events', 'audit_events_no_delete', 'd'),
      ('login_events', 'login_events_no_insert_client', 'a'),
      ('login_events', 'login_events_no_update', 'w'),
      ('login_events', 'login_events_no_delete', 'd'),
      ('recovery_restore_approvals', 'recovery_restore_approvals_no_insert_client', 'a'),
      ('recovery_restore_approvals', 'recovery_restore_approvals_no_update', 'w'),
      ('recovery_restore_approvals', 'recovery_restore_approvals_no_delete', 'd')
    ) as t(tbl, pol, cmd)
  loop
    select
      pol.polpermissive,
      pol.polcmd,
      coalesce((
        select array_agg(rr.rolname order by rr.rolname)
        from pg_catalog.pg_roles rr where rr.oid = any (pol.polroles)
      ), array[]::name[]),
      pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
      pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
    into v_permissive, v_cmd, v_roles, v_qual, v_with_check
    from pg_catalog.pg_policy pol
    where pol.polrelid = ('public.' || r.tbl)::regclass
      and pol.polname = r.pol;

    if not found then
      raise exception '025: restrictive policy eksik: %.%', r.tbl, r.pol;
    end if;
    if v_permissive then
      raise exception '025: %.% PERMISSIVE — RESTRICTIVE zorunlu', r.tbl, r.pol;
    end if;
    if v_cmd is distinct from r.cmd then
      raise exception '025: %.% cmd uyumsuz', r.tbl, r.pol;
    end if;
    if v_roles is distinct from array['authenticated']::name[] then
      raise exception '025: %.% roller [authenticated] değil: %', r.tbl, r.pol, v_roles;
    end if;
    if r.cmd = 'a' then
      if lower(replace(coalesce(v_with_check, ''), ' ', '')) not in ('false', '(false)') then
        raise exception '025: %.% INSERT WITH CHECK false değil', r.tbl, r.pol;
      end if;
    elsif r.cmd = 'w' then
      if lower(replace(coalesce(v_qual, ''), ' ', '')) not in ('false', '(false)')
         or lower(replace(coalesce(v_with_check, ''), ' ', '')) not in ('false', '(false)') then
        raise exception '025: %.% UPDATE false sözleşmesi bozulmuş', r.tbl, r.pol;
      end if;
    else
      if lower(replace(coalesce(v_qual, ''), ' ', '')) not in ('false', '(false)') then
        raise exception '025: %.% DELETE USING false değil', r.tbl, r.pol;
      end if;
    end if;
  end loop;

  -- Recovery select
  select
    pol.polpermissive, pol.polcmd,
    coalesce((
      select array_agg(rr.rolname order by rr.rolname)
      from pg_catalog.pg_roles rr where rr.oid = any (pol.polroles)
    ), array[]::name[]),
    pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
  into v_permissive, v_cmd, v_roles, v_qual
  from pg_catalog.pg_policy pol
  where pol.polrelid = 'public.recovery_restore_approvals'::regclass
    and pol.polname = 'recovery_restore_approvals_select_management';

  if not found then
    raise exception '025: recovery_restore_approvals_select_management yok';
  end if;
  if not v_permissive or v_cmd is distinct from 'r'
     or v_roles is distinct from array['authenticated']::name[] then
    raise exception '025: recovery select policy rol/cmd/permissive uyumsuz';
  end if;
  if position(' or ' in lower(coalesce(v_qual, ''))) > 0 then
    raise exception '025: recovery select OR içeremez: %', v_qual;
  end if;
  if lower(replace(coalesce(v_qual, ''), ' ', '')) not in (
    '(annvero_is_management()andannvero_can_access_company(company_id))',
    '(public.annvero_is_management()andpublic.annvero_can_access_company(company_id))',
    '(public.annvero_is_management()andannvero_can_access_company(company_id))',
    '(annvero_is_management()andpublic.annvero_can_access_company(company_id))'
  ) then
    raise exception '025: recovery select AND sözleşmesi uyumsuz: %', v_qual;
  end if;

  -- Tenant-aware executed unique + company ASC/DESC (paired indoption)
  if not exists (
    select 1
    from pg_catalog.pg_class idx
    join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
    join pg_catalog.pg_index i on i.indexrelid = idx.oid
    join pg_catalog.pg_class t on t.oid = i.indrelid
    where n.nspname = 'public'
      and idx.relname = 'uq_recovery_restore_approvals_executed_record'
      and t.relname = 'recovery_restore_approvals'
      and i.indisunique and i.indisvalid and i.indisready
      and (
        select array_agg(a.attname::text order by k.ord)
        from unnest(i.indkey) with ordinality as k(attnum, ord)
        join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
        where k.ord <= i.indnkeyatts
      ) = array['company_id', 'table_name', 'record_id']::text[]
      and (
        select array_agg(
          case when (o.opt & 1) = 1 then 'DESC' else 'ASC' end
          order by k.ord
        )
        from unnest(i.indkey) with ordinality as k(attnum, ord)
        join unnest(i.indoption) with ordinality as o(opt, ord) on o.ord = k.ord
        where k.ord <= i.indnkeyatts
      ) = array['ASC', 'ASC', 'ASC']::text[]
      and lower(replace(coalesce(pg_catalog.pg_get_expr(i.indpred, i.indrelid), ''), ' ', ''))
          in ('(executedistrue)', '(executed=true)')
  ) then
    raise exception '025: tenant-aware executed unique index sözleşme uyumsuz';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class idx
    join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
    join pg_catalog.pg_index i on i.indexrelid = idx.oid
    join pg_catalog.pg_class t on t.oid = i.indrelid
    where n.nspname = 'public'
      and idx.relname = 'idx_recovery_restore_approvals_company'
      and t.relname = 'recovery_restore_approvals'
      and not i.indisunique and i.indisvalid and i.indisready
      and (
        select array_agg(a.attname::text order by k.ord)
        from unnest(i.indkey) with ordinality as k(attnum, ord)
        join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
        where k.ord <= i.indnkeyatts
      ) = array['company_id', 'created_at']::text[]
      and (
        select array_agg(
          case when (o.opt & 1) = 1 then 'DESC' else 'ASC' end
          order by k.ord
        )
        from unnest(i.indkey) with ordinality as k(attnum, ord)
        join unnest(i.indoption) with ordinality as o(opt, ord) on o.ord = k.ord
        where k.ord <= i.indnkeyatts
      ) = array['ASC', 'DESC']::text[]
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) is null
  ) then
    raise exception '025: idx_recovery_restore_approvals_company ASC/DESC sözleşme uyumsuz';
  end if;
end;
$$;
