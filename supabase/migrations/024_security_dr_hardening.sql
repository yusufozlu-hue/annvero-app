-- ANNVERO Güvenlik / DR paketi — forward-only migration 024 (V3 sözleşme)
-- ÖNKOŞUL: 020→021→022→023. Destructive SQL YOK. DROP POLICY YOK.
-- Hiçbir ortama otomatik uygulanmaz.

-- ---------------------------------------------------------------------------
-- Yardımcı: restrictive deny — tam sözleşme; uyumsuzsa EXCEPTION
-- ---------------------------------------------------------------------------

create or replace function public.annvero_ensure_restrictive_deny_policy(
  p_schema text,
  p_table text,
  p_policy_name text,
  p_cmd text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_relid oid;
  v_exists boolean := false;
  v_permissive boolean;
  v_polcmd char;
  v_roles name[];
  v_qual text;
  v_with_check text;
  v_expected_cmd char;
  v_sql text;
  v_false_ok boolean;
begin
  v_relid := to_regclass(format('%I.%I', p_schema, p_table));
  if v_relid is null then
    raise exception '024: tablo yok: %.%', p_schema, p_table;
  end if;

  v_expected_cmd := case upper(p_cmd)
    when 'INSERT' then 'a'
    when 'UPDATE' then 'w'
    when 'DELETE' then 'd'
    else null
  end;
  if v_expected_cmd is null then
    raise exception '024: desteklenmeyen cmd %', p_cmd;
  end if;

  select
    true,
    pol.polpermissive,
    pol.polcmd,
    coalesce(
      (
        select array_agg(r.rolname order by r.rolname)
        from pg_catalog.pg_roles r
        where r.oid = any (pol.polroles)
      ),
      array[]::name[]
    ),
    pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
    pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
  into
    v_exists, v_permissive, v_polcmd, v_roles, v_qual, v_with_check
  from pg_catalog.pg_policy pol
  where pol.polrelid = v_relid
    and pol.polname = p_policy_name;

  if not found then
    v_exists := false;
  end if;

  if not v_exists then
    if v_expected_cmd = 'a' then
      v_sql := format(
        'create policy %I on %I.%I as restrictive for insert to authenticated with check (false)',
        p_policy_name, p_schema, p_table
      );
    elsif v_expected_cmd = 'w' then
      v_sql := format(
        'create policy %I on %I.%I as restrictive for update to authenticated using (false) with check (false)',
        p_policy_name, p_schema, p_table
      );
    else
      v_sql := format(
        'create policy %I on %I.%I as restrictive for delete to authenticated using (false)',
        p_policy_name, p_schema, p_table
      );
    end if;
    execute v_sql;
    return;
  end if;

  if v_permissive then
    raise exception
      '024: policy % on %.% PERMISSIVE — RESTRICTIVE zorunlu (DROP POLICY yasak)',
      p_policy_name, p_schema, p_table;
  end if;

  if v_polcmd is distinct from v_expected_cmd then
    raise exception
      '024: policy % on %.% cmd uyumsuz (beklenen %, bulunan %)',
      p_policy_name, p_schema, p_table, p_cmd, v_polcmd;
  end if;

  -- Tam rol sözleşmesi: yalnız authenticated (boş = ALL/PUBLIC → fail)
  if v_roles is distinct from array['authenticated']::name[] then
    raise exception
      '024: policy % on %.% roller uyumsuz (beklenen [authenticated], bulunan %)',
      p_policy_name, p_schema, p_table, v_roles;
  end if;

  v_false_ok := lower(replace(coalesce(v_qual, ''), ' ', '')) in ('false', '(false)');
  if v_expected_cmd = 'a' then
    if lower(replace(coalesce(v_with_check, ''), ' ', '')) not in ('false', '(false)') then
      raise exception '024: policy % INSERT WITH CHECK false değil: %', p_policy_name, v_with_check;
    end if;
    if v_qual is not null and v_qual <> '' then
      raise exception '024: policy % INSERT USING beklenmiyor: %', p_policy_name, v_qual;
    end if;
  elsif v_expected_cmd = 'w' then
    if not v_false_ok
       or lower(replace(coalesce(v_with_check, ''), ' ', '')) not in ('false', '(false)') then
      raise exception '024: policy % UPDATE USING/WITH CHECK false değil', p_policy_name;
    end if;
  else
    if not v_false_ok then
      raise exception '024: policy % DELETE USING false değil: %', p_policy_name, v_qual;
    end if;
  end if;
end;
$$;

revoke all on function public.annvero_ensure_restrictive_deny_policy(text, text, text, text) from public;
revoke all on function public.annvero_ensure_restrictive_deny_policy(text, text, text, text) from anon, authenticated, service_role;

create or replace function public.annvero_assert_table_column(
  p_schema text,
  p_table text,
  p_column text,
  p_udt text,
  p_nullable text,
  p_has_default boolean default null
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_udt text;
  v_null text;
  v_default text;
begin
  select c.udt_name, c.is_nullable, c.column_default
  into v_udt, v_null, v_default
  from information_schema.columns c
  where c.table_schema = p_schema
    and c.table_name = p_table
    and c.column_name = p_column;

  if not found then
    raise exception '024: %.%.% kolonu eksik', p_schema, p_table, p_column;
  end if;
  if lower(v_udt) is distinct from lower(p_udt) then
    raise exception '024: %.%.% tip uyumsuz (beklenen %, bulunan %)',
      p_schema, p_table, p_column, p_udt, v_udt;
  end if;
  if v_null is distinct from p_nullable then
    raise exception '024: %.%.% nullability uyumsuz (beklenen %, bulunan %)',
      p_schema, p_table, p_column, p_nullable, v_null;
  end if;
  if p_has_default is true and v_default is null then
    raise exception '024: %.%.% default bekleniyordu', p_schema, p_table, p_column;
  end if;
  if p_has_default is false and v_default is not null then
    raise exception '024: %.%.% default beklenmiyordu: %', p_schema, p_table, p_column, v_default;
  end if;
end;
$$;

revoke all on function public.annvero_assert_table_column(text, text, text, text, text, boolean) from public;
revoke all on function public.annvero_assert_table_column(text, text, text, text, text, boolean) from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- rate_limit_buckets
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

do $$
declare
  v_pk text[];
  v_idx_cols text[];
  v_pred text;
  v_unique boolean;
  v_valid boolean;
  v_ready boolean;
begin
  perform public.annvero_assert_table_column('public', 'rate_limit_buckets', 'bucket_key', 'text', 'NO', false);
  perform public.annvero_assert_table_column('public', 'rate_limit_buckets', 'count', 'int4', 'NO', true);
  perform public.annvero_assert_table_column('public', 'rate_limit_buckets', 'reset_at', 'timestamptz', 'NO', false);
  perform public.annvero_assert_table_column('public', 'rate_limit_buckets', 'updated_at', 'timestamptz', 'NO', true);

  select coalesce(array_agg(a.attname::text order by x.ordinality), array[]::text[])
  into v_pk
  from pg_catalog.pg_index i
  join lateral unnest(i.indkey) with ordinality as x(attnum, ordinality) on true
  join pg_catalog.pg_attribute a
    on a.attrelid = i.indrelid and a.attnum = x.attnum
  where i.indrelid = 'public.rate_limit_buckets'::regclass
    and i.indisprimary;

  if v_pk is distinct from array['bucket_key']::text[] then
    raise exception '024: rate_limit_buckets PK tam olarak (bucket_key) olmalı, bulunan %', v_pk;
  end if;
end;
$$;

create index if not exists idx_rate_limit_buckets_reset
  on public.rate_limit_buckets (reset_at);

do $$
declare
  v_cols text[];
  v_dirs text[];
  v_pred text;
  v_unique boolean;
  v_valid boolean;
  v_ready boolean;
  v_table text;
begin
  select
    t.relname,
    coalesce(array_agg(a.attname::text order by k.ord), array[]::text[]),
    coalesce(array_agg(
      case when (o.opt & 1) = 1 then 'DESC' else 'ASC' end
      order by k.ord
    ), array[]::text[]),
    pg_catalog.pg_get_expr(i.indpred, i.indrelid),
    i.indisunique,
    i.indisvalid,
    i.indisready
  into v_table, v_cols, v_dirs, v_pred, v_unique, v_valid, v_ready
  from pg_catalog.pg_class idx
  join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
  join pg_catalog.pg_index i on i.indexrelid = idx.oid
  join pg_catalog.pg_class t on t.oid = i.indrelid
  join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
  join lateral unnest(i.indoption) with ordinality as o(opt, ord) on o.ord = k.ord
  join pg_catalog.pg_attribute a
    on a.attrelid = i.indrelid and a.attnum = k.attnum
  where n.nspname = 'public'
    and idx.relname = 'idx_rate_limit_buckets_reset'
    and idx.relkind = 'i'
    and k.ord <= i.indnkeyatts
  group by t.relname, i.indpred, i.indrelid, i.indisunique, i.indisvalid, i.indisready;

  if v_table is distinct from 'rate_limit_buckets'
     or v_cols is distinct from array['reset_at']::text[]
     or v_dirs is distinct from array['ASC']::text[]
     or v_unique
     or v_pred is not null
     or not v_valid
     or not v_ready then
    raise exception
      '024: idx_rate_limit_buckets_reset sözleşme uyumsuz (table=%, cols=%, dirs=%, unique=%, pred=%, valid=%, ready=%)',
      v_table, v_cols, v_dirs, v_unique, v_pred, v_valid, v_ready;
  end if;
end;
$$;

alter table public.rate_limit_buckets enable row level security;

revoke all on table public.rate_limit_buckets from public;
revoke all on table public.rate_limit_buckets from anon, authenticated;
grant select, insert, update, delete on table public.rate_limit_buckets to service_role;
revoke truncate, references, trigger on table public.rate_limit_buckets from service_role;

comment on table public.rate_limit_buckets is
  'Kalıcı rate limit bucket — anahtar SHA-256 hex; yazma service_role / atomik RPC.';

-- Atomik RPC: search_path'te public YOK; nesneler schema-qualified
create or replace function public.annvero_rate_limit_consume(
  p_bucket_key text,
  p_limit integer,
  p_window_ms bigint
)
returns table (
  allowed boolean,
  current_count integer,
  reset_at timestamptz,
  remaining integer
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
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
$$;

revoke all on function public.annvero_rate_limit_consume(text, integer, bigint) from public;
revoke all on function public.annvero_rate_limit_consume(text, integer, bigint) from anon, authenticated;
grant execute on function public.annvero_rate_limit_consume(text, integer, bigint) to service_role;

comment on function public.annvero_rate_limit_consume(text, integer, bigint) is
  'Atomik rate limit. SECURITY DEFINER search_path=pg_catalog,pg_temp. EXECUTE yalnız service_role.';

-- ---------------------------------------------------------------------------
-- audit_events / login_events — append-only + restrictive deny
-- ---------------------------------------------------------------------------

do $$
declare
  v_pred text;
  v_cols text[];
  v_dirs text[];
  v_unique boolean;
  v_valid boolean;
  v_ready boolean;
  v_table text;
  v_pred_norm text;
begin
  if to_regclass('public.audit_events') is null then
    raise exception '024: public.audit_events yok — önce 015';
  end if;

  alter table public.audit_events
    add column if not exists request_id text not null default '',
    add column if not exists result text not null default 'success';

  -- Drift fail-closed: ADD COLUMN IF NOT EXISTS tip/null/default doğrulamaz
  perform public.annvero_assert_table_column('public', 'audit_events', 'request_id', 'text', 'NO', true);
  perform public.annvero_assert_table_column('public', 'audit_events', 'result', 'text', 'NO', true);

  create index if not exists idx_audit_events_request_id
    on public.audit_events (request_id)
    where (request_id <> '');

  select
    t.relname,
    coalesce(array_agg(a.attname::text order by k.ord), array[]::text[]),
    coalesce(array_agg(
      case when (o.opt & 1) = 1 then 'DESC' else 'ASC' end
      order by k.ord
    ), array[]::text[]),
    pg_catalog.pg_get_expr(i.indpred, i.indrelid),
    i.indisunique,
    i.indisvalid,
    i.indisready
  into v_table, v_cols, v_dirs, v_pred, v_unique, v_valid, v_ready
  from pg_catalog.pg_class idx
  join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
  join pg_catalog.pg_index i on i.indexrelid = idx.oid
  join pg_catalog.pg_class t on t.oid = i.indrelid
  join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
  join lateral unnest(i.indoption) with ordinality as o(opt, ord) on o.ord = k.ord
  join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  where n.nspname = 'public'
    and idx.relname = 'idx_audit_events_request_id'
    and idx.relkind = 'i'
    and k.ord <= i.indnkeyatts
  group by t.relname, i.indpred, i.indrelid, i.indisunique, i.indisvalid, i.indisready;

  v_pred_norm := lower(replace(replace(coalesce(v_pred, ''), ' ', ''), '::text', ''));
  if v_table is distinct from 'audit_events'
     or v_cols is distinct from array['request_id']::text[]
     or v_dirs is distinct from array['ASC']::text[]
     or coalesce(v_unique, true)
     or not coalesce(v_valid, false)
     or not coalesce(v_ready, false)
     or v_pred_norm !~ '^\(request_id(<>|!=)''''\)$' then
    raise exception '024: idx_audit_events_request_id sözleşme uyumsuz (table=%, cols=%, dirs=%, pred=%)',
      v_table, v_cols, v_dirs, v_pred;
  end if;

  perform public.annvero_ensure_restrictive_deny_policy(
    'public', 'audit_events', 'audit_events_no_insert_client', 'INSERT'
  );
  perform public.annvero_ensure_restrictive_deny_policy(
    'public', 'audit_events', 'audit_events_no_update', 'UPDATE'
  );
  perform public.annvero_ensure_restrictive_deny_policy(
    'public', 'audit_events', 'audit_events_no_delete', 'DELETE'
  );

  revoke all on table public.audit_events from public;
  revoke insert, update, delete, truncate, references, trigger
    on table public.audit_events from anon, authenticated, public;
  revoke update, delete, truncate, references, trigger
    on table public.audit_events from service_role;
  grant select, insert on table public.audit_events to service_role;
end;
$$;

do $$
begin
  if to_regclass('public.login_events') is null then
    raise exception '024: public.login_events yok — önce 016';
  end if;

  perform public.annvero_ensure_restrictive_deny_policy(
    'public', 'login_events', 'login_events_no_insert_client', 'INSERT'
  );
  perform public.annvero_ensure_restrictive_deny_policy(
    'public', 'login_events', 'login_events_no_update', 'UPDATE'
  );
  perform public.annvero_ensure_restrictive_deny_policy(
    'public', 'login_events', 'login_events_no_delete', 'DELETE'
  );

  revoke all on table public.login_events from public;
  revoke insert, update, delete, truncate, references, trigger
    on table public.login_events from anon, authenticated, public;
  revoke update, delete, truncate, references, trigger
    on table public.login_events from service_role;
  grant select, insert on table public.login_events to service_role;
end;
$$;

-- ---------------------------------------------------------------------------
-- recovery_restore_approvals
-- ---------------------------------------------------------------------------

create table if not exists public.recovery_restore_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  table_name text not null,
  record_id text not null,
  approved_by uuid null,
  request_id text not null,
  dry_run_summary jsonb not null default '{}'::jsonb,
  executed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint recovery_restore_approvals_company_id_nonempty
    check (btrim(company_id) <> ''),
  constraint recovery_restore_approvals_table_name_nonempty
    check (btrim(table_name) <> ''),
  constraint recovery_restore_approvals_record_id_nonempty
    check (btrim(record_id) <> ''),
  constraint recovery_restore_approvals_request_id_nonempty
    check (btrim(request_id) <> '')
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recovery_restore_approvals'
      and column_name = 'approved_by'
      and udt_name = 'text'
  ) then
    raise exception
      '024: recovery_restore_approvals.approved_by text — uuid bekleniyor (şema drift)';
  end if;

  perform public.annvero_assert_table_column('public', 'recovery_restore_approvals', 'id', 'uuid', 'NO', true);
  perform public.annvero_assert_table_column('public', 'recovery_restore_approvals', 'company_id', 'text', 'NO', false);
  perform public.annvero_assert_table_column('public', 'recovery_restore_approvals', 'table_name', 'text', 'NO', false);
  perform public.annvero_assert_table_column('public', 'recovery_restore_approvals', 'record_id', 'text', 'NO', false);
  perform public.annvero_assert_table_column('public', 'recovery_restore_approvals', 'approved_by', 'uuid', 'YES', false);
  perform public.annvero_assert_table_column('public', 'recovery_restore_approvals', 'request_id', 'text', 'NO', false);
  perform public.annvero_assert_table_column('public', 'recovery_restore_approvals', 'dry_run_summary', 'jsonb', 'NO', true);
  perform public.annvero_assert_table_column('public', 'recovery_restore_approvals', 'executed', 'bool', 'NO', true);
  perform public.annvero_assert_table_column('public', 'recovery_restore_approvals', 'created_at', 'timestamptz', 'NO', true);
end;
$$;

do $$
declare
  v_contype char;
  v_validated boolean;
  v_deltype char;
  v_src text[];
  v_tgt_schema text;
  v_tgt_table text;
  v_tgt_cols text[];
  r record;
begin
  if to_regclass('public.companies') is null then
    raise exception '024: public.companies yok — recovery company_id FK kurulamaz';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'recovery_restore_approvals_company_id_fkey'
      and conrelid = 'public.recovery_restore_approvals'::regclass
  ) then
    alter table public.recovery_restore_approvals
      add constraint recovery_restore_approvals_company_id_fkey
      foreign key (company_id) references public.companies(id)
      on delete restrict
      not valid;
  end if;

  alter table public.recovery_restore_approvals
    validate constraint recovery_restore_approvals_company_id_fkey;

  select
    c.contype,
    c.convalidated,
    c.confdeltype,
    (
      select array_agg(a.attname::text order by u.ordinality)
      from unnest(c.conkey) with ordinality as u(attnum, ordinality)
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
    ),
    n2.nspname,
    t2.relname,
    (
      select array_agg(a.attname::text order by u.ordinality)
      from unnest(c.confkey) with ordinality as u(attnum, ordinality)
      join pg_catalog.pg_attribute a on a.attrelid = c.confrelid and a.attnum = u.attnum
    )
  into v_contype, v_validated, v_deltype, v_src, v_tgt_schema, v_tgt_table, v_tgt_cols
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class t2 on t2.oid = c.confrelid
  join pg_catalog.pg_namespace n2 on n2.oid = t2.relnamespace
  where c.conname = 'recovery_restore_approvals_company_id_fkey'
    and c.conrelid = 'public.recovery_restore_approvals'::regclass;

  if v_contype is distinct from 'f'
     or not v_validated
     or v_deltype is distinct from 'r'  -- restrict
     or v_src is distinct from array['company_id']::text[]
     or v_tgt_schema is distinct from 'public'
     or v_tgt_table is distinct from 'companies'
     or v_tgt_cols is distinct from array['id']::text[] then
    raise exception
      '024: recovery company_id FK sözleşme uyumsuz (type=%, validated=%, del=%, src=%, tgt=%.%.%)',
      v_contype, v_validated, v_deltype, v_src, v_tgt_schema, v_tgt_table, v_tgt_cols;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'recovery_restore_approvals_approved_by_fkey'
      and conrelid = 'public.recovery_restore_approvals'::regclass
  ) then
    alter table public.recovery_restore_approvals
      add constraint recovery_restore_approvals_approved_by_fkey
      foreign key (approved_by) references auth.users(id)
      on delete set null
      not valid;
  end if;

  alter table public.recovery_restore_approvals
    validate constraint recovery_restore_approvals_approved_by_fkey;

  select
    c.contype,
    c.convalidated,
    c.confdeltype,
    (
      select array_agg(a.attname::text order by u.ordinality)
      from unnest(c.conkey) with ordinality as u(attnum, ordinality)
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
    ),
    n2.nspname,
    t2.relname,
    (
      select array_agg(a.attname::text order by u.ordinality)
      from unnest(c.confkey) with ordinality as u(attnum, ordinality)
      join pg_catalog.pg_attribute a on a.attrelid = c.confrelid and a.attnum = u.attnum
    )
  into v_contype, v_validated, v_deltype, v_src, v_tgt_schema, v_tgt_table, v_tgt_cols
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class t2 on t2.oid = c.confrelid
  join pg_catalog.pg_namespace n2 on n2.oid = t2.relnamespace
  where c.conname = 'recovery_restore_approvals_approved_by_fkey'
    and c.conrelid = 'public.recovery_restore_approvals'::regclass;

  if v_contype is distinct from 'f'
     or not v_validated
     or v_deltype is distinct from 'n'  -- set null
     or v_src is distinct from array['approved_by']::text[]
     or v_tgt_schema is distinct from 'auth'
     or v_tgt_table is distinct from 'users'
     or v_tgt_cols is distinct from array['id']::text[] then
    raise exception
      '024: recovery approved_by FK sözleşme uyumsuz (type=%, validated=%, del=%, src=%, tgt=%.%.%)',
      v_contype, v_validated, v_deltype, v_src, v_tgt_schema, v_tgt_table, v_tgt_cols;
  end if;

  -- Nonempty CHECK: exact column + expression (isim yetmez)
  for r in
    select * from (values
      ('recovery_restore_approvals_company_id_nonempty', 'company_id'),
      ('recovery_restore_approvals_table_name_nonempty', 'table_name'),
      ('recovery_restore_approvals_record_id_nonempty', 'record_id'),
      ('recovery_restore_approvals_request_id_nonempty', 'request_id')
    ) as t(cname, col)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.recovery_restore_approvals'::regclass
        and c.conname = r.cname
        and c.contype = 'c'
        and c.convalidated
        and (
          select array_agg(a.attname::text order by u.ordinality)
          from unnest(c.conkey) with ordinality as u(attnum, ordinality)
          join pg_catalog.pg_attribute a
            on a.attrelid = c.conrelid and a.attnum = u.attnum
        ) = array[r.col]::text[]
        and regexp_replace(
              lower(replace(coalesce(pg_catalog.pg_get_constraintdef(c.oid), ''), ' ', '')),
              '::[a-z0-9_]+',
              '',
              'g'
            ) in (
              'check(btrim(' || r.col || ')<>'''')',
              'check((btrim(' || r.col || ')<>''''))'
            )
    ) then
      raise exception
        '024: CHECK % kolon/expression sözleşmesi uyumsuz (beklenen btrim(%))',
        r.cname, r.col;
    end if;
  end loop;
end;
$$;

create unique index if not exists uq_recovery_restore_approvals_request_id
  on public.recovery_restore_approvals (request_id);

-- Tenant-aware executed uniqueness
create unique index if not exists uq_recovery_restore_approvals_executed_record
  on public.recovery_restore_approvals (company_id, table_name, record_id)
  where (executed is true);

create index if not exists idx_recovery_restore_approvals_company
  on public.recovery_restore_approvals (company_id asc, created_at desc);

do $$
declare
  v_cols text[];
  v_dirs text[];
  v_pred text;
  v_unique boolean;
  v_valid boolean;
  v_ready boolean;
  v_table text;
  v_pred_norm text;
begin
  -- request_id unique
  select
    t.relname,
    coalesce(array_agg(a.attname::text order by k.ord), array[]::text[]),
    coalesce(array_agg(
      case when (o.opt & 1) = 1 then 'DESC' else 'ASC' end
      order by k.ord
    ), array[]::text[]),
    i.indisunique, i.indisvalid, i.indisready,
    pg_catalog.pg_get_expr(i.indpred, i.indrelid)
  into v_table, v_cols, v_dirs, v_unique, v_valid, v_ready, v_pred
  from pg_catalog.pg_class idx
  join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
  join pg_catalog.pg_index i on i.indexrelid = idx.oid
  join pg_catalog.pg_class t on t.oid = i.indrelid
  join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
  join lateral unnest(i.indoption) with ordinality as o(opt, ord) on o.ord = k.ord
  join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  where n.nspname = 'public' and idx.relname = 'uq_recovery_restore_approvals_request_id'
    and k.ord <= i.indnkeyatts
  group by t.relname, i.indisunique, i.indisvalid, i.indisready, i.indpred, i.indrelid;

  if v_table is distinct from 'recovery_restore_approvals'
     or v_cols is distinct from array['request_id']::text[]
     or v_dirs is distinct from array['ASC']::text[]
     or not v_unique or not v_valid or not v_ready
     or v_pred is not null then
    raise exception '024: uq_recovery_restore_approvals_request_id sözleşme uyumsuz';
  end if;

  -- executed unique tenant-aware
  select
    t.relname,
    coalesce(array_agg(a.attname::text order by k.ord), array[]::text[]),
    coalesce(array_agg(
      case when (o.opt & 1) = 1 then 'DESC' else 'ASC' end
      order by k.ord
    ), array[]::text[]),
    i.indisunique, i.indisvalid, i.indisready,
    pg_catalog.pg_get_expr(i.indpred, i.indrelid)
  into v_table, v_cols, v_dirs, v_unique, v_valid, v_ready, v_pred
  from pg_catalog.pg_class idx
  join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
  join pg_catalog.pg_index i on i.indexrelid = idx.oid
  join pg_catalog.pg_class t on t.oid = i.indrelid
  join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
  join lateral unnest(i.indoption) with ordinality as o(opt, ord) on o.ord = k.ord
  join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  where n.nspname = 'public' and idx.relname = 'uq_recovery_restore_approvals_executed_record'
    and k.ord <= i.indnkeyatts
  group by t.relname, i.indisunique, i.indisvalid, i.indisready, i.indpred, i.indrelid;

  v_pred_norm := lower(replace(coalesce(v_pred, ''), ' ', ''));
  if v_table is distinct from 'recovery_restore_approvals'
     or v_cols is distinct from array['company_id', 'table_name', 'record_id']::text[]
     or v_dirs is distinct from array['ASC', 'ASC', 'ASC']::text[]
     or not v_unique or not v_valid or not v_ready
     or v_pred_norm not in ('(executedistrue)', '(executed=true)') then
    raise exception '024: executed unique index sözleşme uyumsuz (cols=%, dirs=%, pred=%)', v_cols, v_dirs, v_pred;
  end if;

  -- company index: company_id ASC, created_at DESC
  -- indoption: paired unnest (int2vector 0-tabanlı subscript yerine ordinality eşleşmesi)
  select
    t.relname,
    coalesce(array_agg(a.attname::text order by k.ord), array[]::text[]),
    coalesce(array_agg(
      case when (o.opt & 1) = 1 then 'DESC' else 'ASC' end
      order by k.ord
    ), array[]::text[]),
    i.indisunique, i.indisvalid, i.indisready,
    pg_catalog.pg_get_expr(i.indpred, i.indrelid)
  into v_table, v_cols, v_dirs, v_unique, v_valid, v_ready, v_pred
  from pg_catalog.pg_class idx
  join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
  join pg_catalog.pg_index i on i.indexrelid = idx.oid
  join pg_catalog.pg_class t on t.oid = i.indrelid
  join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
  join lateral unnest(i.indoption) with ordinality as o(opt, ord) on o.ord = k.ord
  join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  where n.nspname = 'public' and idx.relname = 'idx_recovery_restore_approvals_company'
    and k.ord <= i.indnkeyatts
  group by t.relname, i.indisunique, i.indisvalid, i.indisready, i.indpred, i.indrelid;

  if v_table is distinct from 'recovery_restore_approvals'
     or v_cols is distinct from array['company_id', 'created_at']::text[]
     or v_dirs is distinct from array['ASC', 'DESC']::text[]
     or v_unique or not v_valid or not v_ready
     or v_pred is not null then
    raise exception
      '024: idx_recovery_restore_approvals_company sözleşme uyumsuz (cols=%, dirs=%)',
      v_cols, v_dirs;
  end if;

  -- PK on id
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.recovery_restore_approvals'::regclass
      and c.contype = 'p'
      and (
        select array_agg(a.attname::text order by u.ordinality)
        from unnest(c.conkey) with ordinality as u(attnum, ordinality)
        join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
      ) = array['id']::text[]
  ) then
    raise exception '024: recovery_restore_approvals PK (id) uyumsuz';
  end if;
end;
$$;

alter table public.recovery_restore_approvals enable row level security;

revoke all on table public.recovery_restore_approvals from public;
revoke all on table public.recovery_restore_approvals from anon, authenticated;
grant select, insert, update on table public.recovery_restore_approvals to service_role;
revoke delete, truncate, references, trigger
  on table public.recovery_restore_approvals from service_role;

do $$
declare
  v_exists boolean := false;
  v_qual text;
  v_permissive boolean;
  v_roles name[];
  v_cmd char;
  v_norm text;
begin
  perform public.annvero_ensure_restrictive_deny_policy(
    'public', 'recovery_restore_approvals', 'recovery_restore_approvals_no_insert_client', 'INSERT'
  );
  perform public.annvero_ensure_restrictive_deny_policy(
    'public', 'recovery_restore_approvals', 'recovery_restore_approvals_no_update', 'UPDATE'
  );
  perform public.annvero_ensure_restrictive_deny_policy(
    'public', 'recovery_restore_approvals', 'recovery_restore_approvals_no_delete', 'DELETE'
  );

  if to_regprocedure('public.annvero_is_management()') is null then
    raise exception '024: public.annvero_is_management() yok (fail-closed)';
  end if;
  if to_regprocedure('public.annvero_can_access_company(text)') is null then
    raise exception '024: public.annvero_can_access_company(text) yok (fail-closed)';
  end if;

  select
    true,
    pol.polpermissive,
    pol.polcmd,
    coalesce(
      (
        select array_agg(r.rolname order by r.rolname)
        from pg_catalog.pg_roles r
        where r.oid = any (pol.polroles)
      ),
      array[]::name[]
    ),
    pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
  into v_exists, v_permissive, v_cmd, v_roles, v_qual
  from pg_catalog.pg_policy pol
  where pol.polrelid = 'public.recovery_restore_approvals'::regclass
    and pol.polname = 'recovery_restore_approvals_select_management';

  if not found then
    v_exists := false;
  end if;

  if not v_exists then
    create policy recovery_restore_approvals_select_management
      on public.recovery_restore_approvals
      as permissive
      for select
      to authenticated
      using (
        public.annvero_is_management()
        and public.annvero_can_access_company(company_id)
      );
  else
    if v_permissive is not true then
      raise exception '024: recovery select policy PERMISSIVE olmalı';
    end if;
    if v_cmd is distinct from 'r' then
      raise exception '024: recovery select policy cmd SELECT olmalı';
    end if;
    if v_roles is distinct from array['authenticated']::name[] then
      raise exception '024: recovery select policy roller [authenticated] olmalı: %', v_roles;
    end if;

    v_norm := lower(replace(coalesce(v_qual, ''), ' ', ''));
    if position(' or ' in lower(coalesce(v_qual, ''))) > 0
       or position(')or(' in v_norm) > 0 then
      raise exception '024: recovery select policy OR içeremez: %', v_qual;
    end if;

    if v_norm not in (
      '(annvero_is_management()andannvero_can_access_company(company_id))',
      '(public.annvero_is_management()andpublic.annvero_can_access_company(company_id))',
      '(public.annvero_is_management()andannvero_can_access_company(company_id))',
      '(annvero_is_management()andpublic.annvero_can_access_company(company_id))'
    ) then
      raise exception
        '024: recovery select qual tam AND sözleşmesi değil: %',
        v_qual;
    end if;
  end if;

  -- Policy grant'ten bağımsız; authenticated SELECT idempotent
  grant select on table public.recovery_restore_approvals to authenticated;
end;
$$;

comment on table public.recovery_restore_approvals is
  'Restore onay izleri — service_role yazma; client DML restrictive deny; select management AND company.';

-- ---------------------------------------------------------------------------
-- V4.5: Forward harden + fail-closed catalog/body/owner/grant asserts
-- (no DROP FUNCTION; 015/020–023 untouched)
-- ---------------------------------------------------------------------------

-- Migration-only assert helper (EXECUTE revoked from all client roles)
create or replace function public.annvero_assert_fn_contract(
  p_signature text,
  p_prokind "char",
  p_result_norm text,
  p_lang text,
  p_volatile "char",
  p_prosecdef boolean,
  p_owner text,
  p_path_norm text,
  p_exec_public boolean,
  p_exec_anon boolean,
  p_exec_auth boolean,
  p_exec_svc boolean,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_oid regprocedure;
  v_prokind "char";
  v_result text;
  v_lang text;
  v_vol "char";
  v_secdef boolean;
  v_owner text;
  v_path text;
  v_path_norm text;
  v_body_actual text;
  v_body_expect text;
  v_ep boolean;
  v_ea boolean;
  v_eu boolean;
  v_es boolean;
begin
  v_oid := to_regprocedure(p_signature);
  if v_oid is null then
    raise exception '024: function missing: %', p_signature;
  end if;

  select
    p.prokind,
    lower(replace(pg_catalog.pg_get_function_result(p.oid), ' ', '')),
    l.lanname,
    p.provolatile,
    p.prosecdef,
    pg_catalog.pg_get_userbyid(p.proowner),
    coalesce(
      (select substring(cfg from 13)
       from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
       where cfg like 'search_path=%' limit 1),
      ''
    ),
    replace(coalesce(p.prosrc, ''), E'\r\n', E'\n')
  into v_prokind, v_result, v_lang, v_vol, v_secdef, v_owner, v_path, v_body_actual
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = v_oid;

  v_path_norm := lower(replace(coalesce(v_path, ''), ' ', ''));
  -- Exact body equality after CRLF→LF only (no lower, no whitespace strip)
  v_body_expect := replace(coalesce(p_body, ''), E'\r\n', E'\n');

  v_ep := has_function_privilege('public', v_oid, 'EXECUTE');
  v_ea := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_eu := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  v_es := has_function_privilege('service_role', v_oid, 'EXECUTE');

  if v_prokind is distinct from p_prokind
     or v_result is distinct from lower(replace(p_result_norm, ' ', ''))
     or v_lang is distinct from p_lang
     or v_vol is distinct from p_volatile
     or v_secdef is distinct from p_prosecdef
     or v_owner is distinct from p_owner
     or v_path_norm is distinct from lower(replace(p_path_norm, ' ', ''))
     or v_body_actual is distinct from v_body_expect
     or v_ep is distinct from p_exec_public
     or v_ea is distinct from p_exec_anon
     or v_eu is distinct from p_exec_auth
     or v_es is distinct from p_exec_svc then
    raise exception
      '024: fn contract drift % (kind=%/% result=%/% lang=%/% vol=%/% secdef=%/% owner=%/% path=%/% body_md5=%/% exec P/A/U/S=%/%/%/% vs %/%/%/%)',
      p_signature,
      v_prokind, p_prokind, v_result, p_result_norm, v_lang, p_lang, v_vol, p_volatile,
      v_secdef, p_prosecdef, v_owner, p_owner, v_path_norm, p_path_norm,
      md5(v_body_actual), md5(v_body_expect), v_ep, v_ea, v_eu, v_es,
      p_exec_public, p_exec_anon, p_exec_auth, p_exec_svc;
  end if;
end;
$$;

revoke all on function public.annvero_assert_fn_contract(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text) from public;
revoke all on function public.annvero_assert_fn_contract(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text) from anon;
revoke all on function public.annvero_assert_fn_contract(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text) from authenticated;
revoke all on function public.annvero_assert_fn_contract(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text) from service_role;

create or replace function public.annvero_profile_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select p.role
  from public.annvero_user_profiles p
  where p.is_active = true
    and p.auth_user_id = auth.uid()
  order by p.updated_at desc nulls last
  limit 1;
$fn$;

create or replace function public.annvero_jwt_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select coalesce(
    nullif(public.annvero_profile_role(), ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'annvero_role', ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    ''
  );
$fn$;

create or replace function public.annvero_profile_company_ids()
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select coalesce(array_agg(m.company_id), array[]::text[])
  from public.annvero_company_members m
  where m.is_active = true
    and m.user_id = auth.uid();
$fn$;

create or replace function public.annvero_jwt_company_ids()
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.annvero_profile_company_ids();
$fn$;

create or replace function public.annvero_can_access_company(target_company_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
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
$fn$;

-- INVOKER by design (canonical 015) — do not convert to DEFINER
create or replace function public.annvero_is_management()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $fn$
  select public.annvero_jwt_role() in ('admin', 'partner', 'mudur');
$fn$;

create or replace function public.annvero_sync_company_membership(
  target_user_id uuid,
  target_company_ids text[],
  actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
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
$fn$;

do $$
declare
  v_sig text;
  v_priv text;
begin
  foreach v_sig in array array[
    'public.annvero_profile_role()',
    'public.annvero_jwt_role()',
    'public.annvero_profile_company_ids()',
    'public.annvero_jwt_company_ids()',
    'public.annvero_can_access_company(text)',
    'public.annvero_is_management()'
  ]
  loop
    if to_regprocedure(v_sig) is null then
      raise exception '024: harden hedefi eksik: %', v_sig;
    end if;
    execute format('revoke all on function %s from public', v_sig);
    execute format('revoke all on function %s from anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;

  revoke all on function public.annvero_sync_company_membership(uuid, text[], uuid) from public;
  revoke all on function public.annvero_sync_company_membership(uuid, text[], uuid) from anon;
  revoke all on function public.annvero_sync_company_membership(uuid, text[], uuid) from authenticated;
  grant execute on function public.annvero_sync_company_membership(uuid, text[], uuid) to service_role;

  revoke all on function public.annvero_rate_limit_consume(text, integer, bigint) from public;
  revoke all on function public.annvero_rate_limit_consume(text, integer, bigint) from anon, authenticated;
  grant execute on function public.annvero_rate_limit_consume(text, integer, bigint) to service_role;

  -- Exact catalog + body fingerprint (whitespace-normalized md5)
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

  -- rate_limit: exact canonical body + fixed return contract (no live self-compare)
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

  -- companies exact 4-role × 7-privilege matrix (effective privileges)
  if to_regclass('public.companies') is null then
    raise exception '024: public.companies yok';
  end if;
  revoke all on table public.companies from public;
  revoke all on table public.companies from anon;
  revoke insert, update, delete, truncate, references, trigger
    on table public.companies from authenticated;
  grant select on table public.companies to authenticated;
  grant select, insert, update, delete on table public.companies to service_role;
  revoke truncate, references, trigger on table public.companies from service_role;

  foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('public', 'public.companies', v_priv)
       or has_table_privilege('anon', 'public.companies', v_priv) then
      raise exception '024: companies PUBLIC/anon % açık', v_priv;
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.companies', 'SELECT') then
    raise exception '024: companies authenticated SELECT eksik';
  end if;
  foreach v_priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.companies', v_priv) then
      raise exception '024: companies authenticated % açık', v_priv;
    end if;
  end loop;
  foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if not has_table_privilege('service_role', 'public.companies', v_priv) then
      raise exception '024: companies service_role % eksik', v_priv;
    end if;
  end loop;
  foreach v_priv in array array['TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('service_role', 'public.companies', v_priv) then
      raise exception '024: companies service_role % fazla', v_priv;
    end if;
  end loop;
end;
$$;

do $$
begin
  if to_regclass('public.official_notifications') is not null then
    alter table public.official_notifications
      add column if not exists deleted_at timestamptz,
      add column if not exists deleted_by text;
  end if;
end;
$$;
