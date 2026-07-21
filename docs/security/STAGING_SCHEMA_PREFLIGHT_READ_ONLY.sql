-- =============================================================================
-- ANNVERO STAGING SCHEMA PREFLIGHT — READ ONLY (COMPLETE CONTRACT)
-- =============================================================================
-- Amaç: Staging'te 020→025 güvenlik/DR önkoşullarını yalnız
--       information_schema / pg_catalog metadata ile denetlemek.
--
-- KURALLAR:
--   - Yalnız SELECT / WITH / VALUES
--   - CREATE/ALTER/INSERT/UPDATE/DELETE/DROP/TRUNCATE/GRANT/REVOKE/DO/CALL YOK
--   - Müşteri/business satırı okunmaz
--   - supabase_migrations.schema_migrations satırları ANA sorguda okunMAZ
--     (varlık yalnız information_schema.tables ile)
--   - 020–023 migration dosyaları bu pakette DEĞİŞTİRİLMEZ (referans kopya).
--   - 022/023 DEFINER helpers: public,pg_temp + PUBLIC/anon EXECUTE →
--     READY_TO_REMEDIATE (024 forward harden); irreconcilable drift → CONFLICT.
--   - Index/trigger beklenenleri canonical 020/023 ile aynıdır (false CONFLICT yok).
--
-- Çıktı: migration, category, object_name, expected_state, actual_state, status
-- status: READY | READY_TO_REMEDIATE | MISSING | CONFLICT | ALREADY_APPLIED | MANUAL_REVIEW
-- =============================================================================

with
public_tables as (
  select c.oid as relid, c.relname as table_name,
         c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),

public_columns as (
  select c.table_name, c.column_name, c.data_type, c.udt_name,
         c.is_nullable, c.column_default
  from information_schema.columns c
  where c.table_schema = 'public'
),

-- Index catalog: table, column order via indkey, unique, exact pred, dirs, valid/ready
index_catalog as (
  select
    t.relname as table_name,
    i.relname as index_name,
    ix.indisunique as is_unique,
    ix.indisvalid,
    ix.indisready,
    pg_catalog.pg_get_expr(ix.indpred, ix.indrelid) as predicate,
    lower(replace(coalesce(pg_catalog.pg_get_expr(ix.indpred, ix.indrelid), ''), ' ', ''))
      as predicate_norm,
    coalesce(
      (
        select array_agg(a.attname order by ord.ordinality)
        from unnest(ix.indkey) with ordinality as ord(attnum, ordinality)
        join pg_catalog.pg_attribute a
          on a.attrelid = ix.indrelid and a.attnum = ord.attnum
        where ord.attnum > 0
          and ord.ordinality <= ix.indnkeyatts
      ),
      array[]::name[]
    ) as columns,
    coalesce(
      (
        -- paired unnest: indoption ile indkey aynı ordinality (off-by-one yasak)
        select array_agg(
          case when (o.opt & 1) = 1 then 'DESC' else 'ASC' end
          order by k.ord
        )
        from unnest(ix.indkey) with ordinality as k(attnum, ord)
        join unnest(ix.indoption) with ordinality as o(opt, ord) on o.ord = k.ord
        where k.attnum > 0
          and k.ord <= ix.indnkeyatts
      ),
      array[]::text[]
    ) as column_dirs,
    pg_catalog.pg_get_indexdef(ix.indexrelid) as index_def
  from pg_catalog.pg_index ix
  join pg_catalog.pg_class i on i.oid = ix.indexrelid
  join pg_catalog.pg_class t on t.oid = ix.indrelid
  join pg_catalog.pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
),

-- Full policy contract: permissive, cmd, roles (polroles→rolname), qual, with_check
policy_catalog as (
  select
    c.relname as tablename,
    p.polname as policyname,
    p.polcmd as cmd,
    p.polpermissive as is_permissive,
    coalesce(
      (
        select array_agg(r.rolname order by r.rolname)
        from pg_catalog.pg_roles r
        where r.oid = any (p.polroles)
      ),
      array[]::name[]
    ) as roles,
    pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual_expr,
    pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
  from pg_catalog.pg_policy p
  join pg_catalog.pg_class c on c.oid = p.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
),

-- Trigger catalog: table (tgrelid), name, exact function signature (tgfoid), def, enabled
public_triggers as (
  select
    c.relname as table_name,
    t.tgname as trigger_name,
    format(
      '%s.%s(%s)',
      n_fn.nspname,
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(t.tgfoid)
    ) as function_signature,
    pg_catalog.pg_get_triggerdef(t.oid) as trigger_def,
    t.tgenabled as tgenabled
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace n_fn on n_fn.oid = p.pronamespace
  where n.nspname = 'public' and not t.tgisinternal
),

-- Constraint/FK catalog: full contract for READY (esp recovery + 023 auth_user_id)
public_constraints as (
  select
    x.conname,
    t.relname as table_name,
    case when x.confrelid <> 0 then n2.nspname else null end as conf_schema,
    case when x.confrelid <> 0 then t2.relname else null end as conf_table,
    x.contype,
    coalesce(
      (
        select array_agg(a.attname order by u.ordinality)
        from unnest(x.conkey) with ordinality as u(attnum, ordinality)
        join pg_catalog.pg_attribute a
          on a.attrelid = x.conrelid and a.attnum = u.attnum
      ),
      array[]::name[]
    ) as src_cols,
    case when x.confrelid <> 0 then coalesce(
      (
        select array_agg(a.attname order by u.ordinality)
        from unnest(x.confkey) with ordinality as u(attnum, ordinality)
        join pg_catalog.pg_attribute a
          on a.attrelid = x.confrelid and a.attnum = u.attnum
      ),
      array[]::name[]
    ) else null end as tgt_cols,
    x.convalidated,
    x.confdeltype,
    case when x.contype = 'c'
      then pg_catalog.pg_get_constraintdef(x.oid)
      else null end as check_expr,
    lower(replace(coalesce(
      case when x.contype = 'c' then pg_catalog.pg_get_constraintdef(x.oid) else '' end,
      ''
    ), ' ', '')) as check_expr_norm
  from pg_catalog.pg_constraint x
  join pg_catalog.pg_class t on t.oid = x.conrelid
  join pg_catalog.pg_namespace n on n.oid = t.relnamespace
  left join pg_catalog.pg_class t2 on t2.oid = nullif(x.confrelid, 0)
  left join pg_catalog.pg_namespace n2 on n2.oid = t2.relnamespace
  where n.nspname = 'public'
),

schema_migrations_meta as (
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
  ) as table_exists
),

-- Privilege matrix: PUBLIC / anon / authenticated / service_role × 7 privs
-- Display label stays PUBLIC; privilege lookup uses lowercase public (role PUBLIC yok).
grant_matrix as (
  select
    pt.table_name,
    r.rolename,
    has_table_privilege(
      case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
      'public.' || pt.table_name, 'SELECT'
    ) as can_select,
    has_table_privilege(
      case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
      'public.' || pt.table_name, 'INSERT'
    ) as can_insert,
    has_table_privilege(
      case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
      'public.' || pt.table_name, 'UPDATE'
    ) as can_update,
    has_table_privilege(
      case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
      'public.' || pt.table_name, 'DELETE'
    ) as can_delete,
    has_table_privilege(
      case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
      'public.' || pt.table_name, 'TRUNCATE'
    ) as can_truncate,
    has_table_privilege(
      case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
      'public.' || pt.table_name, 'REFERENCES'
    ) as can_references,
    has_table_privilege(
      case when r.rolename = 'PUBLIC' then 'public' else r.rolename end,
      'public.' || pt.table_name, 'TRIGGER'
    ) as can_trigger
  from public_tables pt
  cross join (
    values ('PUBLIC'), ('anon'), ('authenticated'), ('service_role')
  ) as r(rolename)
),

extension_ok as (
  select
    exists (select 1 from pg_catalog.pg_extension where extname = 'pgcrypto')
    or exists (
      select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where p.proname = 'gen_random_uuid'
        and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
        and n.nspname in ('public', 'extensions', 'pg_catalog')
    ) as available
),

-- Exact-signature SECURITY DEFINER / INVOKER targets (V4.5 body+owner+type)
-- Note: 022/023 local defs use search_path = public, pg_temp (files NOT modified).
-- Rate-limit MUST be exactly pg_catalog, pg_temp (public → CONFLICT).
secdef_targets as (
  select * from (
    values
      ('022', 'public.annvero_profile_role()', 'harden_024', 'pg_catalog,pg_temp',
       'f'::char, 'text', 'sql', 's'::char, true, 'postgres',
       false, false, true, true),
      ('022', 'public.annvero_jwt_role()', 'harden_024', 'pg_catalog,pg_temp',
       'f'::char, 'text', 'sql', 's'::char, true, 'postgres',
       false, false, true, true),
      ('023', 'public.annvero_sync_company_membership(uuid,text[],uuid)', 'service_role_only', 'pg_catalog,pg_temp',
       'f'::char, 'void', 'plpgsql', 'v'::char, true, 'postgres',
       false, false, false, true),
      ('023', 'public.annvero_profile_company_ids()', 'harden_024', 'pg_catalog,pg_temp',
       'f'::char, 'text[]', 'sql', 's'::char, true, 'postgres',
       false, false, true, true),
      ('023', 'public.annvero_jwt_company_ids()', 'harden_024', 'pg_catalog,pg_temp',
       'f'::char, 'text[]', 'sql', 's'::char, true, 'postgres',
       false, false, true, true),
      ('023', 'public.annvero_can_access_company(text)', 'harden_024', 'pg_catalog,pg_temp',
       'f'::char, 'boolean', 'plpgsql', 's'::char, true, 'postgres',
       false, false, true, true),
      ('024', 'public.annvero_is_management()', 'invoker_rls_helper', 'pg_catalog,pg_temp',
       'f'::char, 'boolean', 'sql', 's'::char, false, 'postgres',
       false, false, true, true),
      ('024', 'public.annvero_rate_limit_consume(text,integer,bigint)', 'exact_no_public', 'pg_catalog,pg_temp',
       'f'::char,
       'table(allowedboolean,current_countinteger,reset_attimestampwithtimezone,remaininginteger)',
       'plpgsql', 'v'::char, true, 'postgres',
       false, false, false, true)
  ) as t(
    migration, signature, path_mode, expected_path_norm,
    expect_prokind, expect_result_norm, expect_lang, expect_volatile, expect_prosecdef, expect_owner,
    expect_exec_public, expect_exec_anon, expect_exec_auth, expect_exec_svc
  )
),

-- Canonical bodies (hardened = 024; legacy = 022/023). Exact text after CRLF→LF only.
fn_body_expect as (
  select * from (
    values
      ('public.annvero_profile_role()', 'hardened', $fp$
  select p.role
  from public.annvero_user_profiles p
  where p.is_active = true
    and p.auth_user_id = auth.uid()
  order by p.updated_at desc nulls last
  limit 1;
$fp$),
      ('public.annvero_profile_role()', 'legacy', $fp$
  select p.role
  from public.annvero_user_profiles p
  where p.is_active = true
    and p.auth_user_id = auth.uid()
  order by p.updated_at desc nulls last
  limit 1;
$fp$),
      ('public.annvero_profile_role()', 'legacy', $fp$
  select p.role
  from public.annvero_user_profiles p
  where p.is_active = true
    and lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by p.updated_at desc nulls last
  limit 1;
$fp$),
      ('public.annvero_jwt_role()', 'hardened', $fp$
  select coalesce(
    nullif(public.annvero_profile_role(), ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'annvero_role', ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    ''
  );
$fp$),
      ('public.annvero_jwt_role()', 'legacy', $fp$
  select coalesce(
    nullif(public.annvero_profile_role(), ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'annvero_role', ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    ''
  );
$fp$),
      ('public.annvero_profile_company_ids()', 'hardened', $fp$
  select coalesce(array_agg(m.company_id), array[]::text[])
  from public.annvero_company_members m
  where m.is_active = true
    and m.user_id = auth.uid();
$fp$),
      ('public.annvero_profile_company_ids()', 'legacy', $fp$
  select coalesce(array_agg(m.company_id), array[]::text[])
  from public.annvero_company_members m
  where m.is_active = true
    and m.user_id = auth.uid();
$fp$),
      ('public.annvero_jwt_company_ids()', 'hardened', $fp$
  select public.annvero_profile_company_ids();
$fp$),
      ('public.annvero_jwt_company_ids()', 'legacy', $fp$
  select public.annvero_profile_company_ids();
$fp$),
      ('public.annvero_can_access_company(text)', 'hardened', $fp$
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
$fp$),
      ('public.annvero_can_access_company(text)', 'legacy', $fp$
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

  return target_company_id = any(ids);
end;
$fp$),
      ('public.annvero_is_management()', 'hardened', $fp$
  select public.annvero_jwt_role() in ('admin', 'partner', 'mudur');
$fp$),
      ('public.annvero_is_management()', 'legacy', $fp$
  select public.annvero_jwt_role() in ('admin', 'partner', 'mudur');
$fp$),
      ('public.annvero_sync_company_membership(uuid,text[],uuid)', 'hardened', $fp$
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
$fp$),
      ('public.annvero_sync_company_membership(uuid,text[],uuid)', 'legacy', $fp$
declare
  v_ids text[];
begin
  if target_user_id is null then
    raise exception 'annvero_sync_company_membership: target_user_id zorunludur';
  end if;

  -- Normalize: null/boş temizle, tekilleştir.
  v_ids := (
    select coalesce(array_agg(distinct btrim(x)), array[]::text[])
    from unnest(coalesce(target_company_ids, array[]::text[])) as x
    where btrim(coalesce(x, '')) <> ''
  );

  -- 1) İstenen listede olmayan mevcut aktif üyelikleri pasifleştir (erişim daraltma).
  update public.annvero_company_members m
  set is_active = false, updated_at = now()
  where m.user_id = target_user_id
    and m.is_active = true
    and m.company_id <> all(v_ids);

  -- 2) İstenen firmaları aktif upsert et. Geçersiz company_id → FK ihlali → rollback.
  if array_length(v_ids, 1) is not null then
    insert into public.annvero_company_members as m
      (user_id, company_id, is_active, created_by, updated_at)
    select target_user_id, cid, true, actor_user_id, now()
    from unnest(v_ids) as cid
    on conflict (user_id, company_id)
    do update set is_active = true, updated_at = now();
  end if;
end;
$fp$),
      ('public.annvero_rate_limit_consume(text,integer,bigint)', 'hardened', $fp$
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
$fp$)
  ) as v(signature, body_kind, body_text)
),

secdef_evaluated as (
  select
    t.migration,
    t.signature,
    t.path_mode,
    t.expected_path_norm,
    t.expect_prokind,
    t.expect_result_norm,
    t.expect_lang,
    t.expect_volatile,
    t.expect_prosecdef,
    t.expect_owner,
    t.expect_exec_public,
    t.expect_exec_anon,
    t.expect_exec_auth,
    t.expect_exec_svc,
    to_regprocedure(t.signature) as proc_oid,
    case when to_regprocedure(t.signature) is null then null
         else (select p.prokind from pg_catalog.pg_proc p where p.oid = to_regprocedure(t.signature))
    end as prokind,
    case when to_regprocedure(t.signature) is null then null
         else (select p.prosecdef from pg_catalog.pg_proc p where p.oid = to_regprocedure(t.signature))
    end as prosecdef,
    case when to_regprocedure(t.signature) is null then null
         else (select pg_catalog.pg_get_userbyid(p.proowner)
               from pg_catalog.pg_proc p where p.oid = to_regprocedure(t.signature))
    end as owner_name,
    case when to_regprocedure(t.signature) is null then null
         else (select lower(replace(pg_catalog.pg_get_function_result(p.oid), ' ', ''))
               from pg_catalog.pg_proc p where p.oid = to_regprocedure(t.signature))
    end as result_norm,
    case when to_regprocedure(t.signature) is null then null
         else (select l.lanname from pg_catalog.pg_proc p
               join pg_catalog.pg_language l on l.oid = p.prolang
               where p.oid = to_regprocedure(t.signature))
    end as lang_name,
    case when to_regprocedure(t.signature) is null then null
         else (select p.provolatile from pg_catalog.pg_proc p where p.oid = to_regprocedure(t.signature))
    end as provolatile,
    case when to_regprocedure(t.signature) is null then null
         else (select replace(coalesce(p.prosrc, ''), E'\r\n', E'\n')
               from pg_catalog.pg_proc p where p.oid = to_regprocedure(t.signature))
    end as body_norm,
    case when to_regprocedure(t.signature) is null then null
         else (
           select coalesce(
             (select substring(cfg from 13)
              from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
              where cfg like 'search_path=%' limit 1),
             ''
           )
           from pg_catalog.pg_proc p where p.oid = to_regprocedure(t.signature)
         )
    end as search_path,
    case when to_regprocedure(t.signature) is null then null
         else has_function_privilege('public', to_regprocedure(t.signature), 'EXECUTE') end as exec_public,
    case when to_regprocedure(t.signature) is null then null
         else has_function_privilege('anon', to_regprocedure(t.signature), 'EXECUTE') end as exec_anon,
    case when to_regprocedure(t.signature) is null then null
         else has_function_privilege('authenticated', to_regprocedure(t.signature), 'EXECUTE') end as exec_authenticated,
    case when to_regprocedure(t.signature) is null then null
         else has_function_privilege('service_role', to_regprocedure(t.signature), 'EXECUTE') end as exec_service_role
  from secdef_targets t
),

-- Normalize search_path; body = exact equality after CRLF→LF only
norm_path as (
  select se.*,
         lower(replace(coalesce(se.search_path, ''), ' ', '')) as search_path_norm,
         position('public' in lower(replace(coalesce(se.search_path, ''), ' ', ''))) > 0
           as has_public_in_path,
         exists (
           select 1 from fn_body_expect fb
           where fb.signature = se.signature and fb.body_kind = 'hardened'
             and se.body_norm is not distinct from replace(fb.body_text, E'\r\n', E'\n')
         ) as body_hardened,
         exists (
           select 1 from fn_body_expect fb
           where fb.signature = se.signature and fb.body_kind = 'legacy'
             and se.body_norm is not distinct from replace(fb.body_text, E'\r\n', E'\n')
         ) as body_legacy
  from secdef_evaluated se
),

-- Deny policy expectations
deny_policy_expect as (
  select * from (
    values
      ('audit_events', 'audit_events_no_insert_client', 'a'),
      ('audit_events', 'audit_events_no_update', 'w'),
      ('audit_events', 'audit_events_no_delete', 'd'),
      ('login_events', 'login_events_no_insert_client', 'a'),
      ('login_events', 'login_events_no_update', 'w'),
      ('login_events', 'login_events_no_delete', 'd'),
      ('recovery_restore_approvals', 'recovery_restore_approvals_no_insert_client', 'a'),
      ('recovery_restore_approvals', 'recovery_restore_approvals_no_update', 'w'),
      ('recovery_restore_approvals', 'recovery_restore_approvals_no_delete', 'd')
  ) as v(tbl, pol, expected_cmd)
),

-- Helper EXECUTE must be false for all client + service_role
helper_sigs as (
  select * from (
    values
      ('024', 'public.annvero_ensure_restrictive_deny_policy(text,text,text,text)'),
      ('024', 'public.annvero_assert_table_column(text,text,text,text,text,boolean)'),
      ('024', 'public.annvero_assert_fn_contract(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text)'),
      ('025', 'public.annvero_ensure_index_if_columns(text,text,text,text,text[],boolean,text[],boolean,text)')
  ) as v(migration, signature)
),

-- Helpers are NOT in secdef_targets/norm_path — evaluate EXECUTE separately
helper_evaluated as (
  select
    h.migration,
    h.signature,
    to_regprocedure(h.signature) as proc_oid,
    case when to_regprocedure(h.signature) is null then null
         else has_function_privilege('public', to_regprocedure(h.signature), 'EXECUTE') end as exec_public,
    case when to_regprocedure(h.signature) is null then null
         else has_function_privilege('anon', to_regprocedure(h.signature), 'EXECUTE') end as exec_anon,
    case when to_regprocedure(h.signature) is null then null
         else has_function_privilege('authenticated', to_regprocedure(h.signature), 'EXECUTE') end as exec_authenticated,
    case when to_regprocedure(h.signature) is null then null
         else has_function_privilege('service_role', to_regprocedure(h.signature), 'EXECUTE') end as exec_service_role
  from helper_sigs h
),

-- Index expectations (column order + unique + exact normalized predicate + ASC/DESC)
-- pred_exact_norm: null = no predicate; otherwise exact match after lower(replace spaces)
-- expected_dirs: null = tüm key kolonları ASC kabul et (kontrol atlama değil); else exact ASC/DESC
index_expect as (
  select * from (
    values
      -- Canonical 020 (do not weaken composite/partial indexes)
      ('020', 'uq_document_index_company_hash', 'document_index',
       array['company_id','file_hash']::text[], true,
       '(file_hashisnotnullandfile_hash<>''''andparse_status<>''soft_deleted'')',
       array['ASC','ASC']::text[]),
      ('020', 'idx_cloud_connections_user', 'cloud_storage_connections',
       array['user_id','provider']::text[], false, null::text, array['ASC','ASC']::text[]),
      ('020', 'idx_cloud_folders_company', 'company_cloud_folders',
       array['company_id']::text[], false, null::text, array['ASC']::text[]),
      ('020', 'idx_document_index_company_period', 'document_index',
       array['company_id','period_key']::text[], false, null::text, array['ASC','ASC']::text[]),
      ('020', 'idx_document_sync_events_company', 'document_sync_events',
       array['company_id','created_at']::text[], false, null::text, array['ASC','DESC']::text[]),
      ('023', 'uq_annvero_user_profiles_auth_user_id', 'annvero_user_profiles',
       array['auth_user_id']::text[], true, '(auth_user_idisnotnull)', array['ASC']::text[]),
      ('023', 'idx_annvero_company_members_user', 'annvero_company_members',
       array['user_id']::text[], false, '(is_active)', array['ASC']::text[]),
      ('023', 'idx_annvero_company_members_company', 'annvero_company_members',
       array['company_id']::text[], false, null::text, array['ASC']::text[]),
      ('024', 'idx_rate_limit_buckets_reset', 'rate_limit_buckets',
       array['reset_at']::text[], false, null::text, null::text[]),
      ('024', 'idx_audit_events_request_id', 'audit_events',
       array['request_id']::text[], false, '(request_id<>'''')', array['ASC']::text[]),
      ('024', 'uq_recovery_restore_approvals_request_id', 'recovery_restore_approvals',
       array['request_id']::text[], true, null::text, array['ASC']::text[]),
      ('024', 'uq_recovery_restore_approvals_executed_record', 'recovery_restore_approvals',
       array['company_id','table_name','record_id']::text[], true,
       '(executedistrue)', array['ASC','ASC','ASC']::text[]),
      ('024', 'idx_recovery_restore_approvals_company', 'recovery_restore_approvals',
       array['company_id','created_at']::text[], false, null::text, array['ASC','DESC']::text[]),
      ('025', 'idx_annvero_company_members_user_active', 'annvero_company_members',
       array['user_id']::text[], false, '(is_active=true)', array['ASC']::text[]),
      ('025', 'idx_annvero_company_members_company_active', 'annvero_company_members',
       array['company_id']::text[], false, '(is_active=true)', array['ASC']::text[]),
      ('025', 'idx_learning_memory_company_deleted', 'learning_memory',
       array['company_id','deleted_at']::text[], false, null::text, null::text[]),
      ('025', 'idx_reconciliation_matches_company_deleted', 'reconciliation_matches',
       array['company_id','deleted_at']::text[], false, null::text, null::text[]),
      ('025', 'idx_nft_company_deleted', 'normalized_financial_transactions',
       array['company_id','deleted_at']::text[], false, null::text, null::text[]),
      ('025', 'idx_audit_events_company_id', 'audit_events',
       array['company_id']::text[], false, null::text, array['ASC']::text[]),
      ('025', 'idx_recovery_restore_approvals_record', 'recovery_restore_approvals',
       array['table_name','record_id']::text[], false, null::text, array['ASC','ASC']::text[])
  ) as v(migration, index_name, table_name, expected_cols, expect_unique, pred_exact_norm, expected_dirs)
),

-- Trigger expectations: READY only with table + function signature + def match (not name alone)
trigger_expect as (
  select * from (
    values
      ('020', 'trg_cloud_connections_updated_at', 'cloud_storage_connections',
       'public.cloud_storage_set_updated_at()', 'BEFORE UPDATE'),
      ('020', 'trg_company_cloud_folders_updated_at', 'company_cloud_folders',
       'public.cloud_storage_set_updated_at()', 'BEFORE UPDATE'),
      ('020', 'trg_document_index_updated_at', 'document_index',
       'public.cloud_storage_set_updated_at()', 'BEFORE UPDATE'),
      ('023', 'trg_annvero_company_members_set_updated_at', 'annvero_company_members',
       'public.annvero_company_members_set_updated_at()', 'BEFORE UPDATE')
  ) as v(migration, trigger_name, table_name, function_signature, timing_event)
),

-- Constraint expectations: full FK/CHECK catalog contract
constraint_expect as (
  select * from (
    values
      ('023', 'annvero_user_profiles_auth_user_id_fkey', 'annvero_user_profiles', 'f'::char,
       array['auth_user_id']::text[], 'auth', 'users', array['id']::text[], 'n'::char, null::text),
      ('024', 'recovery_restore_approvals_company_id_fkey', 'recovery_restore_approvals', 'f'::char,
       array['company_id']::text[], 'public', 'companies', array['id']::text[], 'r'::char, null::text),
      ('024', 'recovery_restore_approvals_approved_by_fkey', 'recovery_restore_approvals', 'f'::char,
       array['approved_by']::text[], 'auth', 'users', array['id']::text[], 'n'::char, null::text),
      ('024', 'recovery_restore_approvals_company_id_nonempty', 'recovery_restore_approvals', 'c'::char,
       array['company_id']::text[], null::text, null::text, null::text[], null::char,
       'check(btrim(company_id)<>'''')'),
      ('024', 'recovery_restore_approvals_table_name_nonempty', 'recovery_restore_approvals', 'c'::char,
       array['table_name']::text[], null::text, null::text, null::text[], null::char,
       'check(btrim(table_name)<>'''')'),
      ('024', 'recovery_restore_approvals_record_id_nonempty', 'recovery_restore_approvals', 'c'::char,
       array['record_id']::text[], null::text, null::text, null::text[], null::char,
       'check(btrim(record_id)<>'''')'),
      ('024', 'recovery_restore_approvals_request_id_nonempty', 'recovery_restore_approvals', 'c'::char,
       array['request_id']::text[], null::text, null::text, null::text[], null::char,
       'check(btrim(request_id)<>'''')')
  ) as v(migration, conname, table_name, contype, src_cols, conf_schema, conf_table, tgt_cols, confdeltype, check_exact_norm)
),

-- ===========================================================================
-- DETAIL ROWS
-- ===========================================================================
detail_rows as (
  -- META
  select
    'META'::text as migration,
    'migration_history'::text as category,
    'supabase_migrations.schema_migrations'::text as object_name,
    'table exists (optional; do not read rows)'::text as expected_state,
    case when (select table_exists from schema_migrations_meta)
      then 'table_exists' else 'table_absent' end as actual_state,
    case when (select table_exists from schema_migrations_meta)
      then 'READY' else 'MANUAL_REVIEW' end as status
  union all
  select 'META', 'extension', 'pgcrypto_or_gen_random_uuid',
         'pgcrypto OR gen_random_uuid() available',
         case when (select available from extension_ok) then 'available' else 'missing' end,
         case when (select available from extension_ok) then 'READY' else 'MISSING' end

  -- 020 tables
  union all select * from (
    select '020'::text, 'table'::text, 'public.' || v.tbl, 'exists'::text,
      case when exists (select 1 from public_tables pt where pt.table_name = v.tbl)
        then 'exists' else 'missing' end,
      case when exists (select 1 from public_tables pt where pt.table_name = v.tbl)
        then 'READY' else 'MISSING' end
    from (values
      ('cloud_storage_connections'), ('company_cloud_folders'),
      ('document_index'), ('document_sync_events'), ('companies')
    ) as v(tbl)
  ) s

  union all select * from (
    select '020'::text, 'column'::text, v.obj, 'exists'::text,
      case when exists (select 1 from public_columns pc
        where pc.table_name = v.tbl and pc.column_name = v.col)
        then 'exists' else 'missing' end,
      case when exists (select 1 from public_columns pc
        where pc.table_name = v.tbl and pc.column_name = v.col)
        then 'READY' else 'MISSING' end
    from (values
      ('public.cloud_storage_connections.token_reference', 'cloud_storage_connections', 'token_reference'),
      ('public.document_index.file_hash', 'document_index', 'file_hash')
    ) as v(obj, tbl, col)
  ) s

  union all select * from (
    select '020'::text, 'rls'::text, 'public.' || v.tbl, 'enabled'::text,
      case when not exists (select 1 from public_tables pt where pt.table_name = v.tbl) then 'table_missing'
           when exists (select 1 from public_tables pt where pt.table_name = v.tbl and pt.rls_enabled) then 'enabled'
           else 'disabled' end,
      case when not exists (select 1 from public_tables pt where pt.table_name = v.tbl) then 'MISSING'
           when exists (select 1 from public_tables pt where pt.table_name = v.tbl and pt.rls_enabled) then 'READY'
           else 'CONFLICT' end
    from (values
      ('cloud_storage_connections'), ('company_cloud_folders'),
      ('document_index'), ('document_sync_events')
    ) as v(tbl)
  ) s

  union all
  select '020', 'function', 'public.cloud_storage_set_updated_at()', 'exists',
    case when to_regprocedure('public.cloud_storage_set_updated_at()') is not null
      then 'exists' else 'missing' end,
    case when to_regprocedure('public.cloud_storage_set_updated_at()') is not null
      then 'READY' else 'MISSING' end

  union all
  select
    te.migration,
    'trigger',
    te.trigger_name,
    format('table=%s fn=%s timing~%s enabled', te.table_name, te.function_signature, te.timing_event),
    case
      when not exists (
        select 1 from public_triggers t
        where t.trigger_name = te.trigger_name and t.table_name = te.table_name
      ) then 'missing'
      else (
        select format(
          'table=%s fn=%s enabled=%s def=%s',
          t.table_name, t.function_signature, t.tgenabled,
          left(coalesce(t.trigger_def, ''), 120)
        )
        from public_triggers t
        where t.trigger_name = te.trigger_name and t.table_name = te.table_name
        limit 1
      )
    end,
    case
      when exists (
        select 1 from public_triggers t
        where t.trigger_name = te.trigger_name
          and t.table_name = te.table_name
          and t.function_signature = te.function_signature
          and t.tgenabled in ('O', 'A')
          and position(upper(te.timing_event) in upper(coalesce(t.trigger_def, ''))) > 0
          -- tgfoid/signature is authoritative; do NOT require schema-qualified name inside pg_get_triggerdef
      ) then 'READY'
      when exists (
        select 1 from public_triggers t where t.trigger_name = te.trigger_name
      ) then 'CONFLICT'
      else 'MISSING'
    end
  from trigger_expect te

  -- 020 grants: PUBLIC/anon/authenticated no privileges on cloud tables
  union all select * from (
    select '020'::text, 'grant'::text, g.table_name || ':' || g.rolename,
      'no SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER'::text,
      format('S=%s I=%s U=%s D=%s T=%s R=%s Trig=%s',
        g.can_select, g.can_insert, g.can_update, g.can_delete,
        g.can_truncate, g.can_references, g.can_trigger),
      case when not (g.can_select or g.can_insert or g.can_update or g.can_delete
                     or g.can_truncate or g.can_references or g.can_trigger)
        then 'READY' else 'CONFLICT' end
    from grant_matrix g
    where g.table_name in (
      'cloud_storage_connections', 'company_cloud_folders',
      'document_index', 'document_sync_events'
    )
    and g.rolename in ('PUBLIC', 'anon', 'authenticated')
  ) s

  -- 021
  union all
  select '021', 'table', 'public.learning_memory', 'exists (skip-safe if missing)',
    case when exists (select 1 from public_tables where table_name = 'learning_memory')
      then 'exists' else 'absent_skip_ok' end,
    case when exists (select 1 from public_tables where table_name = 'learning_memory')
      then 'READY' else 'MANUAL_REVIEW' end
  union all
  select '021', 'rls', 'public.learning_memory', 'enabled if table exists',
    case when not exists (select 1 from public_tables where table_name = 'learning_memory')
      then 'table_absent_skip_ok'
     when exists (select 1 from public_tables where table_name = 'learning_memory' and rls_enabled)
      then 'enabled' else 'disabled' end,
    case when not exists (select 1 from public_tables where table_name = 'learning_memory')
      then 'MANUAL_REVIEW'
     when exists (select 1 from public_tables where table_name = 'learning_memory' and rls_enabled)
      then 'READY' else 'CONFLICT' end
  union all select * from (
    select '021'::text, 'policy_absent'::text, 'learning_memory:' || v.pol, 'absent'::text,
      case when exists (select 1 from policy_catalog pc
        where pc.tablename = 'learning_memory' and pc.policyname = v.pol)
        then 'present_conflict' else 'absent' end,
      case when exists (select 1 from policy_catalog pc
        where pc.tablename = 'learning_memory' and pc.policyname = v.pol)
        then 'CONFLICT' else 'READY' end
    from (values
      ('allow learning memory delete'), ('allow learning memory insert'),
      ('allow learning memory read'), ('allow learning memory update')
    ) as v(pol)
  ) s

  -- 022
  union all
  select '022', 'dependency', 'public.annvero_user_profiles', 'exists',
    case when exists (select 1 from public_tables where table_name = 'annvero_user_profiles')
      then 'exists' else 'missing' end,
    case when exists (select 1 from public_tables where table_name = 'annvero_user_profiles')
      then 'READY' else 'MISSING' end
  union all
  select '022', 'grant', 'companies:authenticated',
    'SELECT only; INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER false (024 matrix)',
    case when not exists (select 1 from public_tables where table_name = 'companies') then 'table_missing'
         when has_table_privilege('authenticated', 'public.companies', 'SELECT')
          and not has_table_privilege('authenticated', 'public.companies', 'INSERT')
          and not has_table_privilege('authenticated', 'public.companies', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.companies', 'DELETE')
          and not has_table_privilege('authenticated', 'public.companies', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'public.companies', 'REFERENCES')
          and not has_table_privilege('authenticated', 'public.companies', 'TRIGGER')
          then 'select_only'
         when has_table_privilege('authenticated', 'public.companies', 'SELECT') then 'select_plus_write'
         else 'no_select' end,
    case when not exists (select 1 from public_tables where table_name = 'companies') then 'MISSING'
         when has_table_privilege('authenticated', 'public.companies', 'SELECT')
          and not has_table_privilege('authenticated', 'public.companies', 'INSERT')
          and not has_table_privilege('authenticated', 'public.companies', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.companies', 'DELETE')
          and not has_table_privilege('authenticated', 'public.companies', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'public.companies', 'REFERENCES')
          and not has_table_privilege('authenticated', 'public.companies', 'TRIGGER')
          then 'READY'
         when has_table_privilege('authenticated', 'public.companies', 'SELECT') then 'READY_TO_REMEDIATE'
         else 'CONFLICT' end

  union all select * from (
    select '024'::text, 'grant'::text, 'companies:' || g.rolename,
      case when g.rolename in ('PUBLIC', 'anon') then 'all 7 privileges false'
           when g.rolename = 'authenticated' then 'SELECT true; write/DDL false'
           else 'service_role SELECT/INSERT/UPDATE/DELETE true; TRUNCATE/REFERENCES/TRIGGER false' end,
      format('S=%s I=%s U=%s D=%s T=%s R=%s Trig=%s',
        g.can_select, g.can_insert, g.can_update, g.can_delete,
        g.can_truncate, g.can_references, g.can_trigger),
      case when not exists (select 1 from public_tables where table_name = 'companies')
        then 'MISSING'
       when g.rolename in ('PUBLIC', 'anon')
         and not (g.can_select or g.can_insert or g.can_update or g.can_delete
                  or g.can_truncate or g.can_references or g.can_trigger)
        then 'ALREADY_APPLIED'
       when g.rolename = 'authenticated'
         and g.can_select
         and not (g.can_insert or g.can_update or g.can_delete
                  or g.can_truncate or g.can_references or g.can_trigger)
        then 'ALREADY_APPLIED'
       when g.rolename = 'service_role'
         and g.can_select and g.can_insert and g.can_update and g.can_delete
         and not (g.can_truncate or g.can_references or g.can_trigger)
        then 'ALREADY_APPLIED'
       when g.rolename in ('PUBLIC', 'anon', 'authenticated', 'service_role')
        then 'READY_TO_REMEDIATE'
       else 'CONFLICT' end
    from grant_matrix g
    where g.table_name = 'companies'
      and g.rolename in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) s

  -- 023
  union all
  select '023', 'column', 'public.annvero_user_profiles.auth_user_id', 'exists uuid',
    case when exists (select 1 from public_columns
      where table_name = 'annvero_user_profiles' and column_name = 'auth_user_id' and udt_name = 'uuid')
      then 'exists_uuid'
     when exists (select 1 from public_columns
      where table_name = 'annvero_user_profiles' and column_name = 'auth_user_id')
      then 'exists_wrong_type' else 'missing' end,
    case when exists (select 1 from public_columns
      where table_name = 'annvero_user_profiles' and column_name = 'auth_user_id' and udt_name = 'uuid')
      then 'READY'
     when exists (select 1 from public_columns
      where table_name = 'annvero_user_profiles' and column_name = 'auth_user_id')
      then 'CONFLICT' else 'MISSING' end
  -- 023 auth_user_id FK + 024 recovery FKs/CHECKs covered by constraint_expect below
  union all
  select '023', 'table', 'public.annvero_company_members', 'exists',
    case when exists (select 1 from public_tables where table_name = 'annvero_company_members')
      then 'exists' else 'missing' end,
    case when exists (select 1 from public_tables where table_name = 'annvero_company_members')
      then 'READY' else 'MISSING' end
  union all select * from (
    select '023'::text, 'column'::text, v.obj, v.expected,
      case when exists (select 1 from public_columns pc
        where pc.table_name = 'annvero_company_members' and pc.column_name = v.col
          and (v.udt is null or pc.udt_name = v.udt)) then 'exists' else 'missing' end,
      case when exists (select 1 from public_columns pc
        where pc.table_name = 'annvero_company_members' and pc.column_name = v.col
          and (v.udt is null or pc.udt_name = v.udt)) then 'READY' else 'MISSING' end
    from (values
      ('public.annvero_company_members.user_id', 'exists uuid', 'user_id', 'uuid'),
      ('public.annvero_company_members.company_id', 'exists text', 'company_id', 'text'),
      ('public.annvero_company_members.is_active', 'exists boolean', 'is_active', 'bool')
    ) as v(obj, expected, col, udt)
  ) s
  union all
  select '023', 'column_absent', 'public.annvero_company_members.auth_user_id',
    'must NOT exist (canonical is user_id)',
    case when not exists (select 1 from public_tables where table_name = 'annvero_company_members')
      then 'table_missing'
     when exists (select 1 from public_columns
      where table_name = 'annvero_company_members' and column_name = 'auth_user_id')
      then 'auth_user_id_present_forbidden' else 'absent_ok' end,
    case when not exists (select 1 from public_tables where table_name = 'annvero_company_members')
      then 'MISSING'
     when exists (select 1 from public_columns
      where table_name = 'annvero_company_members' and column_name = 'auth_user_id')
      then 'CONFLICT' else 'READY' end
  union all
  select '023', 'rls', 'public.annvero_company_members', 'enabled',
    case when not exists (select 1 from public_tables where table_name = 'annvero_company_members') then 'table_missing'
         when exists (select 1 from public_tables where table_name = 'annvero_company_members' and rls_enabled) then 'enabled'
         else 'disabled' end,
    case when not exists (select 1 from public_tables where table_name = 'annvero_company_members') then 'MISSING'
         when exists (select 1 from public_tables where table_name = 'annvero_company_members' and rls_enabled) then 'READY'
         else 'CONFLICT' end
  union all
  select '023', 'function', 'public.annvero_company_members_set_updated_at()', 'exists',
    case when to_regprocedure('public.annvero_company_members_set_updated_at()') is not null
      then 'exists' else 'missing' end,
    case when to_regprocedure('public.annvero_company_members_set_updated_at()') is not null
      then 'READY' else 'MISSING' end
  -- 023 trigger covered by trigger_expect (table+fn+def)
  union all select * from (
    select '023'::text, 'grant'::text, 'annvero_company_members:' || g.rolename,
      'no client privileges'::text,
      format('S=%s I=%s U=%s D=%s T=%s R=%s Trig=%s',
        g.can_select, g.can_insert, g.can_update, g.can_delete,
        g.can_truncate, g.can_references, g.can_trigger),
      case when not exists (select 1 from public_tables where table_name = 'annvero_company_members')
        then 'MISSING'
       when not (g.can_select or g.can_insert or g.can_update or g.can_delete
                 or g.can_truncate or g.can_references or g.can_trigger)
        then 'READY' else 'CONFLICT' end
    from grant_matrix g
    where g.table_name = 'annvero_company_members'
      and g.rolename in ('PUBLIC', 'anon', 'authenticated')
  ) s
  union all select * from (
    select '023'::text, 'policy_absent'::text,
      'annvero_company_members:' || v.pol, 'absent'::text,
      case when exists (select 1 from policy_catalog pc
        where pc.tablename = 'annvero_company_members' and pc.policyname = v.pol)
        then 'present_conflict' else 'absent' end,
      case when exists (select 1 from policy_catalog pc
        where pc.tablename = 'annvero_company_members' and pc.policyname = v.pol)
        then 'CONFLICT' else 'READY' end
    from (values
      ('annvero_company_members_authenticated_all'),
      ('annvero_company_members_select_authenticated')
    ) as v(pol)
  ) s

  -- Constraint/FK full catalog contract (READY only with full match)
  union all
  select
    ce.migration,
    case when ce.contype = 'f' then 'constraint_fk' else 'constraint_check' end,
    ce.conname,
    case when ce.contype = 'f' then
      format('FK table=%s src=%s -> %s.%s(%s) del=%s validated',
        ce.table_name, array_to_string(ce.src_cols, ','),
        ce.conf_schema, ce.conf_table, array_to_string(ce.tgt_cols, ','), ce.confdeltype)
    else
      format('CHECK table=%s expr=%s', ce.table_name, coalesce(ce.check_exact_norm, ''))
    end,
    case
      when not exists (select 1 from public_tables pt where pt.table_name = ce.table_name)
        then case when ce.migration = '024' then 'table_absent' else 'table_missing' end
      when not exists (
        select 1 from public_constraints pc
        where pc.conname = ce.conname and pc.table_name = ce.table_name
      ) then 'missing'
      else (
        select format(
          'type=%s src=%s tgt=%s.%s(%s) validated=%s del=%s check=%s',
          pc.contype, array_to_string(pc.src_cols, ','),
          coalesce(pc.conf_schema, ''), coalesce(pc.conf_table, ''),
          coalesce(array_to_string(pc.tgt_cols, ','), ''),
          pc.convalidated, coalesce(pc.confdeltype::text, ''),
          coalesce(pc.check_expr_norm, '')
        )
        from public_constraints pc
        where pc.conname = ce.conname and pc.table_name = ce.table_name
        limit 1
      )
    end,
    case
      when not exists (select 1 from public_tables pt where pt.table_name = ce.table_name)
        then case when ce.migration = '024' then 'READY' else 'MISSING' end
      when not exists (
        select 1 from public_constraints pc
        where pc.conname = ce.conname and pc.table_name = ce.table_name
      ) then case when ce.migration = '024' then 'READY' else 'MISSING' end
      when exists (
        select 1 from public_constraints pc
        where pc.conname = ce.conname
          and pc.table_name = ce.table_name
          and pc.contype = ce.contype
          and pc.src_cols::text[] = ce.src_cols
          and (
            (
              ce.contype = 'c'
              and pc.convalidated
              and (
                -- exact match after stripping ::text / extra parens Postgres may emit
                replace(replace(replace(pc.check_expr_norm, '::text', ''), '((', '('), '))', ')')
                  = replace(replace(replace(ce.check_exact_norm, '::text', ''), '((', '('), '))', ')')
                or (
                  -- catalog-equivalent nonempty btrim CHECK
                  position('btrim(' in pc.check_expr_norm) > 0
                  and position(lower(ce.src_cols[1]) in pc.check_expr_norm) > 0
                  and (
                    position('<>''''' in pc.check_expr_norm) > 0
                    or position('<>''''::' in pc.check_expr_norm) > 0
                  )
                )
              )
            )
            or (
              ce.contype = 'f'
              and pc.conf_schema = ce.conf_schema
              and pc.conf_table = ce.conf_table
              and pc.tgt_cols::text[] = ce.tgt_cols
              and pc.confdeltype = ce.confdeltype
              and pc.convalidated
            )
          )
      ) then case when ce.migration = '024' then 'ALREADY_APPLIED' else 'READY' end
      else 'CONFLICT'
    end
  from constraint_expect ce

  -- Index catalog checks (indkey order, unique, exact pred_norm, indoption dirs, valid/ready)
  union all
  select
    ie.migration,
    'index',
    ie.index_name,
    format('table=%s cols=%s unique=%s dirs=%s pred=%s indisvalid/ready',
      ie.table_name, array_to_string(ie.expected_cols, ','), ie.expect_unique,
      coalesce(array_to_string(ie.expected_dirs, ','), 'ASC*'),
      coalesce(ie.pred_exact_norm, 'none')),
    case
      when ie.table_name is not null
       and not exists (select 1 from public_tables pt where pt.table_name = ie.table_name)
        and ie.migration in ('021', '025')
        and ie.table_name in ('learning_memory', 'reconciliation_matches',
                              'normalized_financial_transactions')
        then 'table_absent_skip_ok'
      when not exists (select 1 from index_catalog ic where ic.index_name = ie.index_name)
        then 'missing'
      else (
        select format(
          'table=%s cols=%s dirs=%s unique=%s pred=%s valid=%s ready=%s',
          ic.table_name, array_to_string(ic.columns, ','),
          array_to_string(ic.column_dirs, ','), ic.is_unique,
          coalesce(ic.predicate_norm, ''), ic.indisvalid, ic.indisready
        )
        from index_catalog ic where ic.index_name = ie.index_name limit 1
      )
    end,
    case
      when ie.table_name is not null
       and not exists (select 1 from public_tables pt where pt.table_name = ie.table_name)
        and ie.migration = '025'
        and ie.table_name in ('learning_memory', 'reconciliation_matches',
                              'normalized_financial_transactions')
        then 'MANUAL_REVIEW'
      when not exists (select 1 from index_catalog ic where ic.index_name = ie.index_name)
        then case
          when ie.migration in ('024', '025') then 'READY'  -- not yet applied
          else 'MISSING'
        end
      when exists (
        select 1 from index_catalog ic
        where ic.index_name = ie.index_name
          and ic.table_name = ie.table_name
          and ic.columns::text[] = ie.expected_cols
          and ic.is_unique = ie.expect_unique
          and ic.indisvalid and ic.indisready
          -- exact normalized predicate (not substring); allow executed=true alias
          and (
            (ie.pred_exact_norm is null and (ic.predicate_norm is null or ic.predicate_norm = ''))
            or (
              ie.pred_exact_norm is not null
              and (
                ic.predicate_norm = ie.pred_exact_norm
                or (
                  ie.index_name = 'uq_recovery_restore_approvals_executed_record'
                  and ic.predicate_norm in ('(executedistrue)', '(executed=true)')
                )
                or (
                  -- V4.5.4: exact aliases only (pg may emit ''::text); no global ::text strip
                  ie.index_name = 'idx_audit_events_request_id'
                  and ic.predicate_norm in (
                    '(request_id<>'''')',
                    '(request_id<>''''::text)',
                    '(request_id!='''')',
                    '(request_id!=''''::text)'
                  )
                )
                or (
                  -- V4.5.2: controlled normalize ONLY for this canonical hash predicate
                  ie.index_name = 'uq_document_index_company_hash'
                  and position(' or ' in lower(coalesce(ic.predicate, ''))) = 0
                  and position(')or(' in lower(replace(coalesce(ic.predicate, ''), ' ', ''))) = 0
                  and replace(
                        replace(
                          replace(
                            replace(
                              lower(replace(replace(coalesce(ic.predicate, ''), E'\r\n', E'\n'), ' ', '')),
                              '::text', ''
                            ),
                            '(', ''
                          ),
                          ')', ''
                        ),
                        '!=', '<>'
                      )
                      = 'file_hashisnotnullandfile_hash<>''''andparse_status<>''soft_deleted'''
                )
                or (
                  -- V4.5.2: exact safe aliases for members user partial index
                  ie.index_name = 'idx_annvero_company_members_user'
                  and ic.predicate_norm in (
                    'is_active',
                    '(is_active)',
                    'is_active=true',
                    '(is_active=true)',
                    'is_activeistrue',
                    '(is_activeistrue)'
                  )
                )
                or (
                  ie.index_name in (
                    'idx_annvero_company_members_user_active',
                    'idx_annvero_company_members_company_active'
                  )
                  and ic.predicate_norm in ('(is_active=true)', '(is_activeistrue)', '(is_active)', 'is_active')
                )
              )
            )
          )
          -- ASC/DESC: expected_dirs null = tüm key kolonları ASC (kontrol atlama değil)
          and (
            ic.column_dirs = coalesce(
              ie.expected_dirs,
              (
                select coalesce(array_agg('ASC'::text), array[]::text[])
                from generate_series(
                  1,
                  greatest(coalesce(array_length(ie.expected_cols, 1), 0), 0)
                )
              )
            )
          )
          -- members user indexes must not be on auth_user_id
          and (
            ie.index_name not like 'idx_annvero_company_members_user%'
            or (
              ic.columns[1] = 'user_id'
              and not ('auth_user_id' = any (ic.columns))
            )
          )
      ) then case when ie.migration in ('024', '025') then 'ALREADY_APPLIED' else 'READY' end
      else 'CONFLICT'
    end
  from index_expect ie

  -- SECURITY DEFINER matrix
  union all
  select
    np.migration,
    'function_secdef',
    np.signature,
    case np.path_mode
      when 'exact_no_public' then
        'SECURITY DEFINER; owner postgres; search_path EXACT pg_catalog,pg_temp; EXEC service_role only; body markers'
      when 'harden_024' then
        'SECURITY DEFINER; owner postgres; exact type/lang/vol; hardened body+path+ACL OR legacy body+old ACL'
      when 'service_role_only' then
        'SECURITY DEFINER; owner postgres; search_path EXACT; EXECUTE service_role only; body fp'
      when 'invoker_rls_helper' then
        'SECURITY INVOKER; owner postgres; exact type/lang/vol/path/body; PUBLIC/anon false; auth+svc true'
      else 'exists; inspect search_path'
    end,
    case when np.proc_oid is null then 'missing'
         else format(
           'kind=%s prosecdef=%s owner=%s result=%s lang=%s vol=%s path=%s body_h=%s body_l=%s exec_public=%s exec_anon=%s exec_auth=%s exec_svc=%s',
           coalesce(np.prokind::text, ''), coalesce(np.prosecdef::text, ''), coalesce(np.owner_name, ''),
           coalesce(np.result_norm, ''), coalesce(np.lang_name, ''), coalesce(np.provolatile::text, ''),
           coalesce(np.search_path, ''), coalesce(np.body_hardened::text, ''), coalesce(np.body_legacy::text, ''),
           np.exec_public, np.exec_anon, np.exec_authenticated, np.exec_service_role
         )
    end,
    case
      when np.proc_oid is null then
        case when np.signature = 'public.annvero_rate_limit_consume(text,integer,bigint)'
          then 'READY'
          when np.path_mode = 'invoker_rls_helper' then 'MISSING'
          else 'MISSING'
        end
      -- Shared structural fails → CONFLICT
      when np.prokind is distinct from np.expect_prokind then 'CONFLICT'
      when np.expect_result_norm is not null
        and np.result_norm is distinct from np.expect_result_norm then 'CONFLICT'
      when np.lang_name is distinct from np.expect_lang then 'CONFLICT'
      when np.provolatile is distinct from np.expect_volatile then 'CONFLICT'
      when np.owner_name is distinct from np.expect_owner then 'CONFLICT'
      when np.prosecdef is distinct from np.expect_prosecdef then 'CONFLICT'
      when not coalesce(np.body_hardened, false)
        and not coalesce(np.body_legacy, false) then 'CONFLICT'
      when position('user_metadata' in lower(coalesce(np.body_norm, ''))) > 0
        then 'CONFLICT'
      when np.path_mode = 'invoker_rls_helper' then
        case
          when coalesce(np.prosecdef, false) then 'CONFLICT'
          when not (coalesce(np.body_hardened, false) or coalesce(np.body_legacy, false)) then 'CONFLICT'
          when coalesce(np.body_hardened, false)
            and np.search_path_norm = 'pg_catalog,pg_temp'
            and not coalesce(np.exec_public, false)
            and not coalesce(np.exec_anon, false)
            and coalesce(np.exec_authenticated, false)
            and coalesce(np.exec_service_role, false)
            then 'ALREADY_APPLIED'
          when coalesce(np.body_hardened, false) or coalesce(np.body_legacy, false)
            then 'READY_TO_REMEDIATE'
          else 'CONFLICT'
        end
      when np.path_mode = 'exact_no_public' then
        case
          when np.prosecdef is not true then 'CONFLICT'
          when np.has_public_in_path then 'CONFLICT'
          when np.search_path_norm is distinct from 'pg_catalog,pg_temp' then 'CONFLICT'
          when coalesce(np.exec_public, false) or coalesce(np.exec_anon, false)
            or coalesce(np.exec_authenticated, false) then 'CONFLICT'
          when not coalesce(np.exec_service_role, false) then 'CONFLICT'
          when not coalesce(np.body_hardened, false) then 'CONFLICT'
          else 'ALREADY_APPLIED'
        end
      when np.path_mode = 'service_role_only' then
        case
          when np.prosecdef is not true then 'CONFLICT'
          when coalesce(np.body_hardened, false)
            and np.search_path_norm = 'pg_catalog,pg_temp'
            and not np.has_public_in_path
            and not coalesce(np.exec_public, false)
            and not coalesce(np.exec_anon, false)
            and not coalesce(np.exec_authenticated, false)
            and coalesce(np.exec_service_role, false)
            then 'ALREADY_APPLIED'
          when coalesce(np.body_legacy, false)
            and (np.has_public_in_path
              or np.search_path_norm is distinct from 'pg_catalog,pg_temp'
              or coalesce(np.exec_public, false)
              or coalesce(np.exec_anon, false)
              or coalesce(np.exec_authenticated, false)
              or not coalesce(np.exec_service_role, false))
            then 'READY_TO_REMEDIATE'
          when coalesce(np.body_hardened, false)
            and (np.has_public_in_path
              or np.search_path_norm is distinct from 'pg_catalog,pg_temp'
              or coalesce(np.exec_public, false)
              or coalesce(np.exec_anon, false)
              or coalesce(np.exec_authenticated, false))
            then 'READY_TO_REMEDIATE'
          else 'CONFLICT'
        end
      when np.path_mode = 'harden_024' then
        case
          when np.prosecdef is not true then 'CONFLICT'
          when coalesce(np.body_hardened, false)
            and np.search_path_norm = 'pg_catalog,pg_temp'
            and not np.has_public_in_path
            and not coalesce(np.exec_public, false)
            and not coalesce(np.exec_anon, false)
            and coalesce(np.exec_authenticated, false)
            and coalesce(np.exec_service_role, false)
            then 'ALREADY_APPLIED'
          when (coalesce(np.body_legacy, false) or coalesce(np.body_hardened, false))
            and (
              np.has_public_in_path
              or np.search_path_norm is distinct from 'pg_catalog,pg_temp'
              or coalesce(np.exec_public, false)
              or coalesce(np.exec_anon, false)
              or not coalesce(np.exec_authenticated, false)
              or not coalesce(np.exec_service_role, false)
            )
            then 'READY_TO_REMEDIATE'
          else 'CONFLICT'
        end
      else 'MANUAL_REVIEW'
    end
  from norm_path np

  -- Per-privilege EXECUTE rows for secdef
  union all
  select np.migration, 'function_privilege', np.signature || ':PUBLIC EXECUTE',
    'false (revoked)',
    case when np.proc_oid is null then 'missing' when np.exec_public then 'true' else 'false' end,
    case when np.proc_oid is null then
           case when np.path_mode in ('exact_no_public', 'harden_024', 'service_role_only', 'invoker_rls_helper')
             then 'READY' else 'MISSING' end
         when np.exec_public and np.path_mode in ('harden_024', 'service_role_only', 'invoker_rls_helper')
           then 'READY_TO_REMEDIATE'
         when np.exec_public then 'CONFLICT'
         else 'READY' end
  from norm_path np
  where np.path_mode in ('exact_no_public', 'harden_024', 'service_role_only', 'invoker_rls_helper')
  union all
  select np.migration, 'function_privilege', np.signature || ':anon EXECUTE',
    'false (revoked)',
    case when np.proc_oid is null then 'missing' when np.exec_anon then 'true' else 'false' end,
    case when np.proc_oid is null then
           case when np.path_mode in ('exact_no_public', 'harden_024', 'service_role_only', 'invoker_rls_helper')
             then 'READY' else 'MISSING' end
         when np.exec_anon and np.path_mode in ('harden_024', 'service_role_only', 'invoker_rls_helper')
           then 'READY_TO_REMEDIATE'
         when np.exec_anon then 'CONFLICT'
         else 'READY' end
  from norm_path np
  where np.path_mode in ('exact_no_public', 'harden_024', 'service_role_only', 'invoker_rls_helper')
  union all
  select np.migration, 'function_privilege', np.signature || ':authenticated EXECUTE',
    case when np.path_mode in ('exact_no_public', 'service_role_only') then 'false (revoked)'
      when np.path_mode in ('harden_024', 'invoker_rls_helper') then 'true OK for RLS helpers'
      else 'inspect' end,
    case when np.proc_oid is null then 'missing'
         when np.exec_authenticated then 'true' else 'false' end,
    case when np.proc_oid is null then
           case when np.path_mode in ('exact_no_public', 'harden_024', 'service_role_only', 'invoker_rls_helper')
             then 'READY' else 'MISSING' end
         when np.path_mode in ('exact_no_public', 'service_role_only') and np.exec_authenticated
           then 'CONFLICT'
         when np.path_mode in ('harden_024', 'invoker_rls_helper') and not np.exec_authenticated
           then 'READY_TO_REMEDIATE'
         else 'READY' end
  from norm_path np
  where np.path_mode in ('exact_no_public', 'harden_024', 'service_role_only', 'invoker_rls_helper')
  union all
  select np.migration, 'function_privilege', np.signature || ':service_role EXECUTE',
    case when np.path_mode in ('exact_no_public', 'service_role_only') then 'true (required)'
      else 'true preferred' end,
    case when np.proc_oid is null then 'missing'
         when np.exec_service_role then 'true' else 'false' end,
    case when np.proc_oid is null then
           case when np.path_mode in ('exact_no_public', 'harden_024', 'service_role_only')
             then 'READY' else 'MISSING' end
         when np.path_mode in ('exact_no_public', 'service_role_only')
           and not np.exec_service_role then 'CONFLICT'
         when np.path_mode in ('exact_no_public', 'service_role_only')
           then 'ALREADY_APPLIED'
         else 'READY' end
  from norm_path np
  where np.path_mode in ('exact_no_public', 'harden_024', 'service_role_only', 'invoker_rls_helper')

  -- Migration helpers: EXECUTE false for public/anon/authenticated/service_role
  union all
  select
    he.migration,
    'helper_privilege',
    he.signature,
    'EXECUTE false for PUBLIC/anon/authenticated/service_role',
    case when he.proc_oid is null then 'missing'
         else format(
           'public=%s anon=%s auth=%s svc=%s',
           he.exec_public, he.exec_anon, he.exec_authenticated, he.exec_service_role
         )
    end,
    case when he.proc_oid is null then 'READY'  -- not applied yet
         when coalesce(he.exec_public, false)
           or coalesce(he.exec_anon, false)
           or coalesce(he.exec_authenticated, false)
           or coalesce(he.exec_service_role, false)
           then 'CONFLICT'
         else 'ALREADY_APPLIED' end
  from helper_evaluated he

  -- 024 deps
  union all
  select '024', 'dependency', 'public.audit_events', 'exists (015+)',
    case when exists (select 1 from public_tables where table_name = 'audit_events')
      then 'exists' else 'missing' end,
    case when exists (select 1 from public_tables where table_name = 'audit_events')
      then 'READY' else 'MISSING' end
  union all
  select '024', 'dependency', 'public.login_events', 'exists (016+)',
    case when exists (select 1 from public_tables where table_name = 'login_events')
      then 'exists' else 'missing' end,
    case when exists (select 1 from public_tables where table_name = 'login_events')
      then 'READY' else 'MISSING' end

  -- 024 rate_limit_buckets
  union all
  select '024', 'table', 'public.rate_limit_buckets', 'exists after 024',
    case when exists (select 1 from public_tables where table_name = 'rate_limit_buckets')
      then 'exists' else 'missing' end,
    case when exists (select 1 from public_tables where table_name = 'rate_limit_buckets')
      then 'ALREADY_APPLIED' else 'READY' end
  union all select * from (
    select '024'::text, 'column'::text, v.obj, v.expected,
      case when not exists (select 1 from public_tables where table_name = 'rate_limit_buckets')
        then 'table_absent'
       when exists (select 1 from public_columns pc
         where pc.table_name = 'rate_limit_buckets' and pc.column_name = v.col
           and pc.udt_name = v.udt and pc.is_nullable = v.nullable)
        then 'matches'
       when exists (select 1 from public_columns pc
         where pc.table_name = 'rate_limit_buckets' and pc.column_name = v.col)
        then 'type_or_null_mismatch' else 'missing' end,
      case when not exists (select 1 from public_tables where table_name = 'rate_limit_buckets')
        then 'READY'
       when exists (select 1 from public_columns pc
         where pc.table_name = 'rate_limit_buckets' and pc.column_name = v.col
           and pc.udt_name = v.udt and pc.is_nullable = v.nullable)
        then 'ALREADY_APPLIED'
       when exists (select 1 from public_columns pc
         where pc.table_name = 'rate_limit_buckets' and pc.column_name = v.col)
        then 'CONFLICT' else 'MISSING' end
    from (values
      ('public.rate_limit_buckets.bucket_key', 'text NOT NULL', 'bucket_key', 'text', 'NO'),
      ('public.rate_limit_buckets.count', 'int4 NOT NULL', 'count', 'int4', 'NO'),
      ('public.rate_limit_buckets.reset_at', 'timestamptz NOT NULL', 'reset_at', 'timestamptz', 'NO'),
      ('public.rate_limit_buckets.updated_at', 'timestamptz NOT NULL', 'updated_at', 'timestamptz', 'NO')
    ) as v(obj, expected, col, udt, nullable)
  ) s
  union all
  select '024', 'rls', 'public.rate_limit_buckets', 'enabled after 024',
    case when not exists (select 1 from public_tables where table_name = 'rate_limit_buckets') then 'table_absent'
         when exists (select 1 from public_tables where table_name = 'rate_limit_buckets' and rls_enabled) then 'enabled'
         else 'disabled' end,
    case when not exists (select 1 from public_tables where table_name = 'rate_limit_buckets') then 'READY'
         when exists (select 1 from public_tables where table_name = 'rate_limit_buckets' and rls_enabled) then 'ALREADY_APPLIED'
         else 'CONFLICT' end

  -- rate_limit grants: PUBLIC/anon/authenticated fully revoked
  union all select * from (
    select '024'::text, 'grant'::text, 'rate_limit_buckets:' || g.rolename,
      'all revoked (client/PUBLIC)'::text,
      format('S=%s I=%s U=%s D=%s T=%s R=%s Trig=%s',
        g.can_select, g.can_insert, g.can_update, g.can_delete,
        g.can_truncate, g.can_references, g.can_trigger),
      case when not exists (select 1 from public_tables where table_name = 'rate_limit_buckets')
        then 'READY'
       when not (g.can_select or g.can_insert or g.can_update or g.can_delete
                 or g.can_truncate or g.can_references or g.can_trigger)
        then 'ALREADY_APPLIED' else 'CONFLICT' end
    from grant_matrix g
    where g.table_name = 'rate_limit_buckets'
      and g.rolename in ('PUBLIC', 'anon', 'authenticated')
  ) s

  -- audit columns
  union all select * from (
    select '024'::text, 'column'::text, v.obj, 'exists after 024'::text,
      case when not exists (select 1 from public_tables where table_name = 'audit_events') then 'table_missing'
           when exists (select 1 from public_columns
             where table_name = 'audit_events' and column_name = v.col) then 'exists'
           else 'missing' end,
      case when not exists (select 1 from public_tables where table_name = 'audit_events') then 'MISSING'
           when exists (select 1 from public_columns
             where table_name = 'audit_events' and column_name = v.col) then 'ALREADY_APPLIED'
           else 'READY' end
    from (values
      ('public.audit_events.request_id', 'request_id'),
      ('public.audit_events.result', 'result')
    ) as v(obj, col)
  ) s

  -- Full deny policy contract
  union all
  select
    '024',
    'policy_restrictive',
    d.tbl || ':' || d.pol,
    format('RESTRICTIVE cmd=%s roles=[authenticated] false USING/WITH CHECK', d.expected_cmd),
    case
      when not exists (select 1 from public_tables where table_name = d.tbl) then 'table_missing'
      when not exists (select 1 from policy_catalog pc
        where pc.tablename = d.tbl and pc.policyname = d.pol) then 'missing'
      else (
        select format(
          'permissive=%s cmd=%s roles=%s qual=%s with_check=%s',
          pc.is_permissive, pc.cmd, array_to_string(pc.roles, ','),
          coalesce(pc.qual_expr, ''), coalesce(pc.with_check_expr, '')
        )
        from policy_catalog pc
        where pc.tablename = d.tbl and pc.policyname = d.pol limit 1
      )
    end,
    case
      when not exists (select 1 from public_tables where table_name = d.tbl)
        then case when d.tbl in ('audit_events', 'login_events') then 'MISSING' else 'READY' end
      when not exists (select 1 from policy_catalog pc
        where pc.tablename = d.tbl and pc.policyname = d.pol) then 'READY'
      when exists (
        select 1 from policy_catalog pc
        where pc.tablename = d.tbl and pc.policyname = d.pol
          and pc.is_permissive = false
          and pc.cmd = d.expected_cmd
          and pc.roles = array['authenticated']::name[]
          and (
            (d.expected_cmd = 'a'
              and lower(replace(coalesce(pc.with_check_expr, ''), ' ', '')) in ('false', '(false)')
              and (pc.qual_expr is null or pc.qual_expr = ''))
            or (d.expected_cmd = 'w'
              and lower(replace(coalesce(pc.qual_expr, ''), ' ', '')) in ('false', '(false)')
              and lower(replace(coalesce(pc.with_check_expr, ''), ' ', '')) in ('false', '(false)'))
            or (d.expected_cmd = 'd'
              and lower(replace(coalesce(pc.qual_expr, ''), ' ', '')) in ('false', '(false)'))
          )
      ) then 'ALREADY_APPLIED'
      else 'CONFLICT'
    end
  from deny_policy_expect d

  -- recovery_restore_approvals table/cols
  union all
  select '024', 'table', 'public.recovery_restore_approvals', 'exists after 024',
    case when exists (select 1 from public_tables where table_name = 'recovery_restore_approvals')
      then 'exists' else 'missing' end,
    case when exists (select 1 from public_tables where table_name = 'recovery_restore_approvals')
      then 'ALREADY_APPLIED' else 'READY' end
  union all
  select '024', 'column', 'public.recovery_restore_approvals.approved_by', 'uuid nullable',
    case when not exists (select 1 from public_tables where table_name = 'recovery_restore_approvals')
      then 'table_absent'
     when exists (select 1 from public_columns
       where table_name = 'recovery_restore_approvals' and column_name = 'approved_by'
         and udt_name = 'uuid' and is_nullable = 'YES') then 'uuid_nullable'
     when exists (select 1 from public_columns
       where table_name = 'recovery_restore_approvals' and column_name = 'approved_by'
         and udt_name = 'text') then 'text_drift_forbidden'
     else 'missing_or_wrong' end,
    case when not exists (select 1 from public_tables where table_name = 'recovery_restore_approvals')
      then 'READY'
     when exists (select 1 from public_columns
       where table_name = 'recovery_restore_approvals' and column_name = 'approved_by'
         and udt_name = 'uuid' and is_nullable = 'YES') then 'ALREADY_APPLIED'
     else 'CONFLICT' end
  union all select * from (
    select '024'::text, 'column'::text, v.obj, v.expected,
      case when not exists (select 1 from public_tables where table_name = 'recovery_restore_approvals')
        then 'table_absent'
       when exists (select 1 from public_columns pc
         where pc.table_name = 'recovery_restore_approvals'
           and pc.column_name = v.col and pc.udt_name = v.udt)
        then 'exists' else 'missing' end,
      case when not exists (select 1 from public_tables where table_name = 'recovery_restore_approvals')
        then 'READY'
       when exists (select 1 from public_columns pc
         where pc.table_name = 'recovery_restore_approvals'
           and pc.column_name = v.col and pc.udt_name = v.udt)
        then 'ALREADY_APPLIED' else 'MISSING' end
    from (values
      ('public.recovery_restore_approvals.company_id', 'text', 'company_id', 'text'),
      ('public.recovery_restore_approvals.table_name', 'text', 'table_name', 'text'),
      ('public.recovery_restore_approvals.record_id', 'text', 'record_id', 'text'),
      ('public.recovery_restore_approvals.request_id', 'text', 'request_id', 'text'),
      ('public.recovery_restore_approvals.executed', 'bool', 'executed', 'bool')
    ) as v(obj, expected, col, udt)
  ) s
  union all
  select '024', 'rls', 'public.recovery_restore_approvals', 'enabled after 024',
    case when not exists (select 1 from public_tables where table_name = 'recovery_restore_approvals') then 'table_absent'
         when exists (select 1 from public_tables where table_name = 'recovery_restore_approvals' and rls_enabled) then 'enabled'
         else 'disabled' end,
    case when not exists (select 1 from public_tables where table_name = 'recovery_restore_approvals') then 'READY'
         when exists (select 1 from public_tables where table_name = 'recovery_restore_approvals' and rls_enabled) then 'ALREADY_APPLIED'
         else 'CONFLICT' end

  -- Recovery SELECT: exact AND of is_management + can_access_company, no OR
  union all
  select '024', 'policy',
    'recovery_restore_approvals:recovery_restore_approvals_select_management',
    'PERMISSIVE SELECT to authenticated; exact AND(is_management, can_access_company); no OR',
    case when not exists (select 1 from public_tables where table_name = 'recovery_restore_approvals')
      then 'table_absent'
     when not exists (select 1 from policy_catalog
       where tablename = 'recovery_restore_approvals'
         and policyname = 'recovery_restore_approvals_select_management')
      then 'missing'
     else (
       select format('permissive=%s cmd=%s roles=%s qual=%s',
         pc.is_permissive, pc.cmd, array_to_string(pc.roles, ','), coalesce(pc.qual_expr, ''))
       from policy_catalog pc
       where pc.tablename = 'recovery_restore_approvals'
         and pc.policyname = 'recovery_restore_approvals_select_management' limit 1
     ) end,
    case when not exists (select 1 from public_tables where table_name = 'recovery_restore_approvals')
      then 'READY'
     when not exists (select 1 from policy_catalog
       where tablename = 'recovery_restore_approvals'
         and policyname = 'recovery_restore_approvals_select_management')
      then 'READY'
     when exists (
       select 1 from policy_catalog pc
       where pc.tablename = 'recovery_restore_approvals'
         and pc.policyname = 'recovery_restore_approvals_select_management'
         and pc.is_permissive = true
         and pc.cmd = 'r'
         and pc.roles = array['authenticated']::name[]
         and position(' or ' in lower(coalesce(pc.qual_expr, ''))) = 0
         and position(')or(' in lower(replace(coalesce(pc.qual_expr, ''), ' ', ''))) = 0
         and lower(replace(coalesce(pc.qual_expr, ''), ' ', '')) in (
           '(annvero_is_management()andannvero_can_access_company(company_id))',
           '(public.annvero_is_management()andpublic.annvero_can_access_company(company_id))',
           '(public.annvero_is_management()andannvero_can_access_company(company_id))',
           '(annvero_is_management()andpublic.annvero_can_access_company(company_id))'
         )
     ) then 'ALREADY_APPLIED'
     else 'CONFLICT' end

  -- recovery grants
  union all select * from (
    select '024'::text, 'grant'::text, 'recovery_restore_approvals:' || g.rolename,
      case when g.rolename in ('PUBLIC', 'anon') then 'all revoked'
           when g.rolename = 'authenticated'
             then 'SELECT ok; no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER'
           else 'service_role: SELECT+INSERT+UPDATE; no DELETE/TRUNCATE/REFERENCES/TRIGGER' end,
      format('S=%s I=%s U=%s D=%s T=%s R=%s Trig=%s',
        g.can_select, g.can_insert, g.can_update, g.can_delete,
        g.can_truncate, g.can_references, g.can_trigger),
      case when not exists (select 1 from public_tables where table_name = 'recovery_restore_approvals')
        then 'READY'
       when g.rolename in ('PUBLIC', 'anon')
         and not (g.can_select or g.can_insert or g.can_update or g.can_delete
                  or g.can_truncate or g.can_references or g.can_trigger)
        then 'ALREADY_APPLIED'
       when g.rolename = 'authenticated'
         and not (g.can_insert or g.can_update or g.can_delete
                  or g.can_truncate or g.can_references or g.can_trigger)
        then 'ALREADY_APPLIED'
       when g.rolename = 'service_role'
         and g.can_select and g.can_insert and g.can_update
         and not (g.can_delete or g.can_truncate or g.can_references or g.can_trigger)
        then 'ALREADY_APPLIED'
       when g.rolename = 'authenticated'
         and (g.can_insert or g.can_update or g.can_delete
              or g.can_truncate or g.can_references or g.can_trigger)
        then 'CONFLICT'
       when g.rolename in ('PUBLIC', 'anon') then 'CONFLICT'
       when g.rolename = 'service_role' then 'CONFLICT'
       else 'MANUAL_REVIEW' end
    from grant_matrix g
    where g.table_name = 'recovery_restore_approvals'
  ) s

  -- audit/login: 024 remediates excess grants; pending ≠ CONFLICT
  union all select * from (
    select '024'::text, 'grant'::text, g.table_name || ':' || g.rolename,
      case when g.rolename = 'service_role' then 'SELECT+INSERT only (append-only)'
           when g.rolename = 'authenticated'
             then 'no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER; SELECT may remain via 015 policy'
           else 'no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER' end,
      format('S=%s I=%s U=%s D=%s T=%s R=%s Trig=%s',
        g.can_select, g.can_insert, g.can_update, g.can_delete,
        g.can_truncate, g.can_references, g.can_trigger),
      case when not exists (select 1 from public_tables where table_name = g.table_name)
        then 'MISSING'
       when g.rolename = 'service_role'
         and g.can_select and g.can_insert
         and not (g.can_update or g.can_delete or g.can_truncate
                  or g.can_references or g.can_trigger)
        then 'ALREADY_APPLIED'
       when g.rolename = 'service_role'
         and (g.can_update or g.can_delete or g.can_truncate
              or g.can_references or g.can_trigger)
        then 'READY_TO_REMEDIATE'
       when g.rolename = 'service_role' then 'CONFLICT'
       when g.rolename in ('PUBLIC', 'anon', 'authenticated')
         and (g.can_insert or g.can_update or g.can_delete
              or g.can_truncate or g.can_references or g.can_trigger)
        then 'READY_TO_REMEDIATE'
       when g.rolename = 'authenticated' and g.can_select
        then 'MANUAL_REVIEW'
       when g.rolename in ('PUBLIC', 'anon', 'authenticated')
         and not (g.can_insert or g.can_update or g.can_delete
                  or g.can_truncate or g.can_references or g.can_trigger)
        then 'ALREADY_APPLIED'
       else 'CONFLICT' end
    from grant_matrix g
    where g.table_name in ('audit_events', 'login_events')
  ) s

  -- official_notifications soft-delete (optional)
  union all select * from (
    select '024'::text, 'column'::text, v.obj,
      'exists after 024 if table present'::text,
      case when not exists (select 1 from public_tables where table_name = 'official_notifications')
        then 'table_absent_skip_ok'
       when exists (select 1 from public_columns
         where table_name = 'official_notifications' and column_name = v.col)
        then 'exists' else 'missing' end,
      case when not exists (select 1 from public_tables where table_name = 'official_notifications')
        then 'MANUAL_REVIEW'
       when exists (select 1 from public_columns
         where table_name = 'official_notifications' and column_name = v.col)
        then 'ALREADY_APPLIED' else 'READY' end
    from (values
      ('public.official_notifications.deleted_at', 'deleted_at'),
      ('public.official_notifications.deleted_by', 'deleted_by')
    ) as v(obj, col)
  ) s
),

-- Dynamic public view/matview inventory + security_invoker + client SELECT
view_rows as (
  select
    '025'::text as migration,
    case when c.relkind = 'v' then 'view' else 'matview' end as category,
    'public.' || c.relname as object_name,
    case when c.relkind = 'm'
      then 'matview — MANUAL_REVIEW (security_invoker N/A)'
      else 'security_invoker=true OR no client SELECT' end as expected_state,
    format(
      'relkind=%s security_invoker=%s anon_select=%s authenticated_select=%s',
      c.relkind,
      case
        when c.reloptions is null then 'unset'
        when exists (select 1 from unnest(c.reloptions) opt
          where lower(opt) in ('security_invoker=true', 'security_invoker=on')) then 'true'
        when exists (select 1 from unnest(c.reloptions) opt
          where lower(opt) like 'security_invoker=%') then 'false_or_other'
        else 'unset' end,
      has_table_privilege('anon', c.oid, 'SELECT'),
      has_table_privilege('authenticated', c.oid, 'SELECT')
    ) as actual_state,
    case
      when c.relkind = 'm' then 'MANUAL_REVIEW'
      when (has_table_privilege('anon', c.oid, 'SELECT')
            or has_table_privilege('authenticated', c.oid, 'SELECT'))
       and not exists (
         select 1 from unnest(coalesce(c.reloptions, array[]::text[])) opt
         where lower(opt) in ('security_invoker=true', 'security_invoker=on')
       ) then 'CONFLICT'
      else 'READY'
    end as status
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
),

all_detail as (
  select * from detail_rows
  union all
  select * from view_rows
),

ready_flags as (
  select
    not exists (
      select 1 from all_detail d
      where d.migration = '020' and d.status in ('MISSING', 'CONFLICT')
    ) as r020,
    not exists (
      select 1 from all_detail d
      where d.migration = '021' and d.status in ('MISSING', 'CONFLICT')
    ) as r021,
    -- CRITICAL: MANUAL_REVIEW on secdef no longer blocks; READY_TO_REMEDIATE is OK for 024 apply
    not exists (
      select 1 from all_detail d
      where d.migration = '022' and d.status in ('MISSING', 'CONFLICT')
    )
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_profile_role()'
        and np.proc_oid is not null and np.prosecdef
    )
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_jwt_role()'
        and np.proc_oid is not null and np.prosecdef
    ) as r022,
    not exists (
      select 1 from all_detail d
      where d.migration = '023' and d.status in ('MISSING', 'CONFLICT')
    )
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_can_access_company(text)'
        and np.proc_oid is not null and np.prosecdef
    ) as r023,
    -- Manual-review block flags (true MANUAL_REVIEW only; READY_TO_REMEDIATE excluded)
    exists (
      select 1 from all_detail d
      where d.migration = '022' and d.category = 'function_secdef'
        and d.status = 'MANUAL_REVIEW'
    ) as mr022,
    exists (
      select 1 from all_detail d
      where d.migration = '023' and d.category = 'function_secdef'
        and d.status = 'MANUAL_REVIEW'
    ) as mr023,
    -- applied024: ALL required 024 objects with full contract (missing ≠ applied / READY-to-create)
    -- Helpers MUST come from helper_evaluated (not norm_path — helpers are absent there).
    exists (select 1 from public_tables where table_name = 'rate_limit_buckets')
    and exists (
      select 1 from public_columns
      where table_name = 'rate_limit_buckets' and column_name = 'bucket_key'
        and udt_name = 'text' and is_nullable = 'NO' and column_default is null
    )
    and exists (
      select 1 from public_columns
      where table_name = 'rate_limit_buckets' and column_name = 'count'
        and udt_name = 'int4' and is_nullable = 'NO'
        and column_default is not null
        and position('0' in column_default) > 0
    )
    and exists (
      select 1 from public_columns
      where table_name = 'rate_limit_buckets' and column_name = 'reset_at'
        and udt_name = 'timestamptz' and is_nullable = 'NO' and column_default is null
    )
    and exists (
      select 1 from public_columns
      where table_name = 'rate_limit_buckets' and column_name = 'updated_at'
        and udt_name = 'timestamptz' and is_nullable = 'NO'
        and column_default is not null
        and (
          position('now()' in lower(column_default)) > 0
          or position('current_timestamp' in lower(column_default)) > 0
        )
    )
    and exists (
      select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'rate_limit_buckets' and c.contype = 'p'
        and (
          select array_agg(a.attname order by u.ordinality)
          from unnest(c.conkey) with ordinality as u(attnum, ordinality)
          join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
        ) = array['bucket_key']::name[]
    )
    and exists (
      select 1 from index_catalog
      where index_name = 'idx_rate_limit_buckets_reset'
        and table_name = 'rate_limit_buckets'
        and columns = array['reset_at']::name[]
        and column_dirs = array['ASC']::text[]
        and indisvalid and indisready
    )
    and exists (
      select 1 from grant_matrix g
      where g.table_name = 'rate_limit_buckets' and g.rolename = 'service_role'
        and g.can_select and g.can_insert and g.can_update and g.can_delete
        and not g.can_truncate and not g.can_references and not g.can_trigger
    )
    and exists (
      select 1 from grant_matrix g
      where g.table_name = 'rate_limit_buckets' and g.rolename = 'authenticated'
        and not (g.can_select or g.can_insert or g.can_update or g.can_delete
                 or g.can_truncate or g.can_references or g.can_trigger)
    )
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_rate_limit_consume(text,integer,bigint)'
        and np.proc_oid is not null and np.prosecdef
        and not np.has_public_in_path
        and np.search_path_norm = 'pg_catalog,pg_temp'
        and coalesce(np.exec_service_role, false)
        and not coalesce(np.exec_public, false)
        and not coalesce(np.exec_anon, false)
        and not coalesce(np.exec_authenticated, false)
    )
    and exists (
      select 1 from public_columns
      where table_name = 'audit_events' and column_name = 'request_id'
        and udt_name = 'text' and is_nullable = 'NO'
        and column_default is not null
        and (
          position('''''::' in column_default) > 0
          or replace(column_default, ' ', '') in ('''''', '('''''')')
        )
    )
    and exists (
      select 1 from public_columns
      where table_name = 'audit_events' and column_name = 'result'
        and udt_name = 'text' and is_nullable = 'NO'
        and column_default is not null
        and position('success' in lower(column_default)) > 0
    )
    and exists (
      select 1 from index_catalog
      where index_name = 'idx_audit_events_request_id'
        and table_name = 'audit_events'
        and columns = array['request_id']::name[]
        and column_dirs = array['ASC']::text[]
        and indisvalid and indisready
        -- V4.5.4: same exact IN list as index detail status (no substring / no global cast strip)
        and predicate_norm in (
          '(request_id<>'''')',
          '(request_id<>''''::text)',
          '(request_id!='''')',
          '(request_id!=''''::text)'
        )
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'audit_events' and policyname = 'audit_events_no_insert_client'
        and is_permissive = false and cmd = 'a'
        and roles = array['authenticated']::name[]
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'audit_events' and policyname = 'audit_events_no_update'
        and is_permissive = false and cmd = 'w'
        and roles = array['authenticated']::name[]
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'audit_events' and policyname = 'audit_events_no_delete'
        and is_permissive = false and cmd = 'd'
        and roles = array['authenticated']::name[]
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'login_events' and policyname = 'login_events_no_insert_client'
        and is_permissive = false and cmd = 'a'
        and roles = array['authenticated']::name[]
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'login_events' and policyname = 'login_events_no_update'
        and is_permissive = false and cmd = 'w'
        and roles = array['authenticated']::name[]
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'login_events' and policyname = 'login_events_no_delete'
        and is_permissive = false and cmd = 'd'
        and roles = array['authenticated']::name[]
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'recovery_restore_approvals'
        and policyname = 'recovery_restore_approvals_no_insert_client'
        and is_permissive = false and cmd = 'a'
        and roles = array['authenticated']::name[]
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'recovery_restore_approvals'
        and policyname = 'recovery_restore_approvals_no_update'
        and is_permissive = false and cmd = 'w'
        and roles = array['authenticated']::name[]
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'recovery_restore_approvals'
        and policyname = 'recovery_restore_approvals_no_delete'
        and is_permissive = false and cmd = 'd'
        and roles = array['authenticated']::name[]
    )
    and exists (select 1 from public_tables where table_name = 'recovery_restore_approvals')
    and exists (
      select 1 from public_columns
      where table_name = 'recovery_restore_approvals' and column_name = 'id'
        and udt_name = 'uuid' and is_nullable = 'NO'
        and column_default is not null
        and position('gen_random_uuid' in lower(column_default)) > 0
    )
    and exists (
      select 1 from public_columns
      where table_name = 'recovery_restore_approvals' and column_name = 'company_id'
        and udt_name = 'text' and is_nullable = 'NO' and column_default is null
    )
    and exists (
      select 1 from public_columns
      where table_name = 'recovery_restore_approvals' and column_name = 'table_name'
        and udt_name = 'text' and is_nullable = 'NO' and column_default is null
    )
    and exists (
      select 1 from public_columns
      where table_name = 'recovery_restore_approvals' and column_name = 'record_id'
        and udt_name = 'text' and is_nullable = 'NO' and column_default is null
    )
    and exists (
      select 1 from public_columns
      where table_name = 'recovery_restore_approvals' and column_name = 'approved_by'
        and udt_name = 'uuid' and is_nullable = 'YES' and column_default is null
    )
    and exists (
      select 1 from public_columns
      where table_name = 'recovery_restore_approvals' and column_name = 'request_id'
        and udt_name = 'text' and is_nullable = 'NO' and column_default is null
    )
    and exists (
      select 1 from public_columns
      where table_name = 'recovery_restore_approvals' and column_name = 'dry_run_summary'
        and udt_name = 'jsonb' and is_nullable = 'NO'
        and column_default is not null
        and (
          position('{}' in column_default) > 0
          or position('jsonb_build_object' in lower(column_default)) > 0
        )
    )
    and exists (
      select 1 from public_columns
      where table_name = 'recovery_restore_approvals' and column_name = 'executed'
        and udt_name = 'bool' and is_nullable = 'NO'
        and column_default is not null
        and position('false' in lower(column_default)) > 0
    )
    and exists (
      select 1 from public_columns
      where table_name = 'recovery_restore_approvals' and column_name = 'created_at'
        and udt_name = 'timestamptz' and is_nullable = 'NO'
        and column_default is not null
        and (
          position('now()' in lower(column_default)) > 0
          or position('current_timestamp' in lower(column_default)) > 0
        )
    )
    and exists (
      select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'recovery_restore_approvals' and c.contype = 'p'
        and (
          select array_agg(a.attname order by u.ordinality)
          from unnest(c.conkey) with ordinality as u(attnum, ordinality)
          join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
        ) = array['id']::name[]
    )
    and exists (
      select 1 from public_constraints
      where conname = 'recovery_restore_approvals_company_id_fkey'
        and table_name = 'recovery_restore_approvals'
        and contype = 'f' and conf_schema = 'public' and conf_table = 'companies'
        and src_cols = array['company_id']::name[]
        and tgt_cols = array['id']::name[]
        and confdeltype = 'r' and convalidated
    )
    and exists (
      select 1 from public_constraints
      where conname = 'recovery_restore_approvals_approved_by_fkey'
        and table_name = 'recovery_restore_approvals'
        and contype = 'f' and conf_schema = 'auth' and conf_table = 'users'
        and src_cols = array['approved_by']::name[]
        and tgt_cols = array['id']::name[]
        and confdeltype = 'n' and convalidated
    )
    and exists (
      select 1 from public_constraints pc
      where pc.conname = 'recovery_restore_approvals_company_id_nonempty'
        and pc.table_name = 'recovery_restore_approvals'
        and pc.contype = 'c' and pc.convalidated
        and pc.src_cols = array['company_id']::name[]
    )
    and exists (
      select 1 from public_constraints pc
      where pc.conname = 'recovery_restore_approvals_table_name_nonempty'
        and pc.table_name = 'recovery_restore_approvals'
        and pc.contype = 'c' and pc.convalidated
        and pc.src_cols = array['table_name']::name[]
    )
    and exists (
      select 1 from public_constraints pc
      where pc.conname = 'recovery_restore_approvals_record_id_nonempty'
        and pc.table_name = 'recovery_restore_approvals'
        and pc.contype = 'c' and pc.convalidated
        and pc.src_cols = array['record_id']::name[]
    )
    and exists (
      select 1 from public_constraints pc
      where pc.conname = 'recovery_restore_approvals_request_id_nonempty'
        and pc.table_name = 'recovery_restore_approvals'
        and pc.contype = 'c' and pc.convalidated
        and pc.src_cols = array['request_id']::name[]
    )
    and exists (
      select 1 from index_catalog
      where index_name = 'uq_recovery_restore_approvals_request_id'
        and table_name = 'recovery_restore_approvals'
        and is_unique
        and columns = array['request_id']::name[]
        and column_dirs = array['ASC']::text[]
        and indisvalid and indisready
    )
    and exists (
      select 1 from index_catalog
      where index_name = 'uq_recovery_restore_approvals_executed_record'
        and table_name = 'recovery_restore_approvals'
        and is_unique
        and columns = array['company_id','table_name','record_id']::name[]
        and column_dirs = array['ASC','ASC','ASC']::text[]
        and predicate_norm in ('(executedistrue)', '(executed=true)')
        and indisvalid and indisready
    )
    and exists (
      select 1 from index_catalog
      where index_name = 'idx_recovery_restore_approvals_company'
        and table_name = 'recovery_restore_approvals'
        and columns = array['company_id','created_at']::name[]
        and column_dirs = array['ASC','DESC']::text[]
        and not is_unique
        and indisvalid and indisready
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'recovery_restore_approvals'
        and policyname = 'recovery_restore_approvals_select_management'
        and is_permissive = true and cmd = 'r'
        and roles = array['authenticated']::name[]
        and lower(replace(coalesce(qual_expr, ''), ' ', '')) in (
          '(annvero_is_management()andannvero_can_access_company(company_id))',
          '(public.annvero_is_management()andpublic.annvero_can_access_company(company_id))',
          '(public.annvero_is_management()andannvero_can_access_company(company_id))',
          '(annvero_is_management()andpublic.annvero_can_access_company(company_id))'
        )
        and position(' or ' in lower(coalesce(qual_expr, ''))) = 0
    )
    and exists (
      select 1 from grant_matrix g
      where g.table_name = 'recovery_restore_approvals' and g.rolename = 'service_role'
        and g.can_select and g.can_insert and g.can_update
        and not (g.can_delete or g.can_truncate or g.can_references or g.can_trigger)
    )
    and exists (
      select 1 from helper_evaluated he
      where he.signature = 'public.annvero_ensure_restrictive_deny_policy(text,text,text,text)'
        and he.proc_oid is not null
        and not coalesce(he.exec_public, false)
        and not coalesce(he.exec_anon, false)
        and not coalesce(he.exec_authenticated, false)
        and not coalesce(he.exec_service_role, false)
    )
    and exists (
      select 1 from helper_evaluated he
      where he.signature = 'public.annvero_assert_table_column(text,text,text,text,text,boolean)'
        and he.proc_oid is not null
        and not coalesce(he.exec_public, false)
        and not coalesce(he.exec_anon, false)
        and not coalesce(he.exec_authenticated, false)
        and not coalesce(he.exec_service_role, false)
    )
    and exists (
      select 1 from helper_evaluated he
      where he.signature = 'public.annvero_assert_fn_contract(text,"char",text,text,"char",boolean,text,text,boolean,boolean,boolean,boolean,text)'
        and he.proc_oid is not null
        and not coalesce(he.exec_public, false)
        and not coalesce(he.exec_anon, false)
        and not coalesce(he.exec_authenticated, false)
        and not coalesce(he.exec_service_role, false)
    )
    -- V4.5: hardened RLS helpers + is_management + sync + rate_limit full contract
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_profile_role()'
        and np.body_hardened and np.prosecdef and np.owner_name = 'postgres'
        and np.prokind = 'f' and np.result_norm = 'text' and np.lang_name = 'sql' and np.provolatile = 's'
        and np.search_path_norm = 'pg_catalog,pg_temp'
        and not coalesce(np.exec_public, false) and not coalesce(np.exec_anon, false)
        and coalesce(np.exec_authenticated, false) and coalesce(np.exec_service_role, false)
    )
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_jwt_role()'
        and np.body_hardened and np.prosecdef and np.owner_name = 'postgres'
        and np.prokind = 'f' and np.result_norm = 'text' and np.lang_name = 'sql' and np.provolatile = 's'
        and np.search_path_norm = 'pg_catalog,pg_temp'
        and not coalesce(np.exec_public, false) and not coalesce(np.exec_anon, false)
        and coalesce(np.exec_authenticated, false) and coalesce(np.exec_service_role, false)
    )
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_profile_company_ids()'
        and np.body_hardened and np.prosecdef and np.owner_name = 'postgres'
        and np.prokind = 'f' and np.result_norm = 'text[]' and np.lang_name = 'sql' and np.provolatile = 's'
        and np.search_path_norm = 'pg_catalog,pg_temp'
        and not coalesce(np.exec_public, false) and not coalesce(np.exec_anon, false)
        and coalesce(np.exec_authenticated, false) and coalesce(np.exec_service_role, false)
    )
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_jwt_company_ids()'
        and np.body_hardened and np.prosecdef and np.owner_name = 'postgres'
        and np.prokind = 'f' and np.result_norm = 'text[]' and np.lang_name = 'sql' and np.provolatile = 's'
        and np.search_path_norm = 'pg_catalog,pg_temp'
        and not coalesce(np.exec_public, false) and not coalesce(np.exec_anon, false)
        and coalesce(np.exec_authenticated, false) and coalesce(np.exec_service_role, false)
    )
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_can_access_company(text)'
        and np.body_hardened and np.prosecdef and np.owner_name = 'postgres'
        and np.prokind = 'f' and np.result_norm = 'boolean' and np.lang_name = 'plpgsql' and np.provolatile = 's'
        and np.search_path_norm = 'pg_catalog,pg_temp'
        and not coalesce(np.exec_public, false) and not coalesce(np.exec_anon, false)
        and coalesce(np.exec_authenticated, false) and coalesce(np.exec_service_role, false)
    )
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_is_management()'
        and np.body_hardened and np.prosecdef is not true and np.owner_name = 'postgres'
        and np.prokind = 'f' and np.result_norm = 'boolean' and np.lang_name = 'sql' and np.provolatile = 's'
        and np.search_path_norm = 'pg_catalog,pg_temp'
        and not coalesce(np.exec_public, false) and not coalesce(np.exec_anon, false)
        and coalesce(np.exec_authenticated, false) and coalesce(np.exec_service_role, false)
    )
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_sync_company_membership(uuid,text[],uuid)'
        and np.body_hardened and np.prosecdef and np.owner_name = 'postgres'
        and np.prokind = 'f' and np.result_norm = 'void' and np.lang_name = 'plpgsql' and np.provolatile = 'v'
        and np.search_path_norm = 'pg_catalog,pg_temp'
        and not coalesce(np.exec_public, false) and not coalesce(np.exec_anon, false)
        and not coalesce(np.exec_authenticated, false) and coalesce(np.exec_service_role, false)
    )
    and exists (
      select 1 from norm_path np
      where np.signature = 'public.annvero_rate_limit_consume(text,integer,bigint)'
        and np.body_hardened and np.prosecdef and np.owner_name = 'postgres'
        and np.prokind = 'f' and np.lang_name = 'plpgsql' and np.provolatile = 'v'
        and np.result_norm = 'table(allowedboolean,current_countinteger,reset_attimestampwithtimezone,remaininginteger)'
        and np.search_path_norm = 'pg_catalog,pg_temp'
        and not coalesce(np.exec_public, false) and not coalesce(np.exec_anon, false)
        and not coalesce(np.exec_authenticated, false) and coalesce(np.exec_service_role, false)
    )
    -- companies exact 4-role matrix
    and exists (
      select 1 from grant_matrix g
      where g.table_name = 'companies' and g.rolename = 'PUBLIC'
        and not (g.can_select or g.can_insert or g.can_update or g.can_delete
                 or g.can_truncate or g.can_references or g.can_trigger)
    )
    and exists (
      select 1 from grant_matrix g
      where g.table_name = 'companies' and g.rolename = 'anon'
        and not (g.can_select or g.can_insert or g.can_update or g.can_delete
                 or g.can_truncate or g.can_references or g.can_trigger)
    )
    and exists (
      select 1 from grant_matrix g
      where g.table_name = 'companies' and g.rolename = 'authenticated'
        and g.can_select
        and not (g.can_insert or g.can_update or g.can_delete
                 or g.can_truncate or g.can_references or g.can_trigger)
    )
    and exists (
      select 1 from grant_matrix g
      where g.table_name = 'companies' and g.rolename = 'service_role'
        and g.can_select and g.can_insert and g.can_update and g.can_delete
        and not (g.can_truncate or g.can_references or g.can_trigger)
    )
    and not exists (
      select 1 from all_detail d
      where d.migration = '024' and d.status = 'CONFLICT'
    ) as applied024,
    -- applied025: ALL required indexes + optional-if-present + helper EXECUTE + privilege + policies
    exists (
      select 1 from index_catalog
      where index_name = 'idx_annvero_company_members_user_active'
        and columns[1] = 'user_id'
        and not ('auth_user_id' = any (columns))
        and column_dirs = array['ASC']::text[]
        and predicate_norm in ('(is_active=true)', '(is_activeistrue)')
        and indisvalid and indisready
    )
    and exists (
      select 1 from index_catalog
      where index_name = 'idx_annvero_company_members_company_active'
        and columns = array['company_id']::name[]
        and column_dirs = array['ASC']::text[]
        and predicate_norm in ('(is_active=true)', '(is_activeistrue)')
        and indisvalid and indisready
    )
    and exists (
      select 1 from index_catalog
      where index_name = 'idx_audit_events_company_id'
        and table_name = 'audit_events'
        and columns = array['company_id']::name[]
        and column_dirs = array['ASC']::text[]
        and indisvalid and indisready
    )
    and exists (
      select 1 from index_catalog
      where index_name = 'idx_recovery_restore_approvals_record'
        and table_name = 'recovery_restore_approvals'
        and columns = array['table_name','record_id']::name[]
        and column_dirs = array['ASC','ASC']::text[]
        and indisvalid and indisready
    )
    and (
      not exists (select 1 from public_tables where table_name = 'learning_memory')
      or exists (
        select 1 from index_catalog
        where index_name = 'idx_learning_memory_company_deleted'
          and table_name = 'learning_memory'
          and columns = array['company_id','deleted_at']::name[]
          and column_dirs = array['ASC','ASC']::text[]
          and indisvalid and indisready
      )
    )
    and (
      not exists (select 1 from public_tables where table_name = 'reconciliation_matches')
      or exists (
        select 1 from index_catalog
        where index_name = 'idx_reconciliation_matches_company_deleted'
          and table_name = 'reconciliation_matches'
          and columns = array['company_id','deleted_at']::name[]
          and column_dirs = array['ASC','ASC']::text[]
          and indisvalid and indisready
      )
    )
    and (
      not exists (select 1 from public_tables where table_name = 'normalized_financial_transactions')
      or exists (
        select 1 from index_catalog
        where index_name = 'idx_nft_company_deleted'
          and table_name = 'normalized_financial_transactions'
          and columns = array['company_id','deleted_at']::name[]
          and column_dirs = array['ASC','ASC']::text[]
          and indisvalid and indisready
      )
    )
    and exists (
      select 1 from helper_evaluated he
      where he.signature = 'public.annvero_ensure_index_if_columns(text,text,text,text,text[],boolean,text[],boolean,text)'
        and he.proc_oid is not null
        and not coalesce(he.exec_public, false)
        and not coalesce(he.exec_anon, false)
        and not coalesce(he.exec_authenticated, false)
        and not coalesce(he.exec_service_role, false)
    )
    and (
      not exists (
        select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'annvero_ensure_index_if_columns'
          and pg_catalog.pg_get_function_identity_arguments(p.oid)
              = 'text, text, text, text, text[], boolean, text'
      )
      or exists (
        select 1
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'annvero_ensure_index_if_columns'
          and pg_catalog.pg_get_function_identity_arguments(p.oid)
              = 'text, text, text, text, text[], boolean, text'
          and not has_function_privilege('public', p.oid, 'EXECUTE')
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and not has_function_privilege('service_role', p.oid, 'EXECUTE')
      )
    )
    and exists (
      select 1 from grant_matrix g
      where g.table_name = 'rate_limit_buckets' and g.rolename = 'authenticated'
        and not (g.can_select or g.can_insert or g.can_update or g.can_delete
                 or g.can_truncate or g.can_references or g.can_trigger)
    )
    and exists (
      select 1 from grant_matrix g
      where g.table_name = 'recovery_restore_approvals' and g.rolename = 'service_role'
        and g.can_select and g.can_insert and g.can_update
        and not (g.can_delete or g.can_truncate or g.can_references or g.can_trigger)
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'audit_events' and policyname = 'audit_events_no_update'
        and is_permissive = false
    )
    and exists (
      select 1 from policy_catalog
      where tablename = 'recovery_restore_approvals'
        and policyname = 'recovery_restore_approvals_select_management'
        and is_permissive = true
    )
    and not exists (
      select 1 from all_detail d
      where d.migration = '025' and d.status = 'CONFLICT'
    ) as applied025
),

summary_rows as (
  select 'SUMMARY'::text, '020_READY'::text, 'prerequisites_020'::text,
    'all 020 checks READY (no MISSING/CONFLICT)'::text,
    case when (select r020 from ready_flags) then 'ready' else 'blocked' end,
    case when (select r020 from ready_flags) then 'READY' else 'MISSING' end
  union all
  select 'SUMMARY', '021_READY', 'prerequisites_021',
    'all 021 checks READY (no MISSING/CONFLICT)',
    case when (select r021 from ready_flags) then 'ready' else 'blocked' end,
    case when (select r021 from ready_flags) then 'READY' else 'MISSING' end
  union all
  select 'SUMMARY', '022_READY', 'prerequisites_022',
    'all 022 checks READY; SECURITY DEFINER MANUAL_REVIEW blocks (020-023 files not modified)',
    case when (select r022 from ready_flags) then 'ready'
         when (select mr022 from ready_flags) then 'manual_review_blocked'
         else 'blocked' end,
    case when (select r022 from ready_flags) then 'READY'
         when (select mr022 from ready_flags) then 'MANUAL_REVIEW'
         else 'MISSING' end
  union all
  select 'SUMMARY', '023_READY', 'prerequisites_023',
    'all 023 checks READY; SECURITY DEFINER MANUAL_REVIEW blocks (020-023 files not modified)',
    case when (select r023 from ready_flags) then 'ready'
         when (select mr023 from ready_flags) then 'manual_review_blocked'
         else 'blocked' end,
    case when (select r023 from ready_flags) then 'READY'
         when (select mr023 from ready_flags) then 'MANUAL_REVIEW'
         else 'MISSING' end
  union all
  select 'SUMMARY', '024_READY_TO_APPLY', 'migration_024',
    '020-023 ready (READY_TO_REMEDIATE OK) AND 024 full contract not yet applied',
    case
      when (select mr022 from ready_flags) or (select mr023 from ready_flags)
        then 'prerequisites_manual_review_blocked'
      when not ((select r020 from ready_flags) and (select r021 from ready_flags)
                and (select r022 from ready_flags) and (select r023 from ready_flags))
        then 'prerequisites_blocked'
      when (select applied024 from ready_flags) then 'already_applied'
      else 'ready_to_apply' end,
    case
      when (select mr022 from ready_flags) or (select mr023 from ready_flags)
        then 'MANUAL_REVIEW'
      when not ((select r020 from ready_flags) and (select r021 from ready_flags)
                and (select r022 from ready_flags) and (select r023 from ready_flags))
        then 'MISSING'
      when (select applied024 from ready_flags) then 'ALREADY_APPLIED'
      else 'READY' end
  union all
  select 'SUMMARY', '025_READY_TO_APPLY', 'migration_025',
    '020-024 ready/applied AND 025 full contract not yet applied',
    case
      when (select mr022 from ready_flags) or (select mr023 from ready_flags)
        then 'prerequisites_manual_review_blocked'
      when not ((select r020 from ready_flags) and (select r021 from ready_flags)
                and (select r022 from ready_flags) and (select r023 from ready_flags))
        then 'prerequisites_020_023_blocked'
      when not (select applied024 from ready_flags) then '024_not_applied'
      when (select applied025 from ready_flags) then 'already_applied'
      else 'ready_to_apply' end,
    case
      when (select mr022 from ready_flags) or (select mr023 from ready_flags)
        then 'MANUAL_REVIEW'
      when not ((select r020 from ready_flags) and (select r021 from ready_flags)
                and (select r022 from ready_flags) and (select r023 from ready_flags))
        then 'MISSING'
      when not (select applied024 from ready_flags) then 'MISSING'
      when (select applied025 from ready_flags) then 'ALREADY_APPLIED'
      else 'READY' end
)

select migration, category, object_name, expected_state, actual_state, status
from (
  select * from all_detail
  union all
  select * from summary_rows
) q
order by
  case migration
    when 'META' then 0 when '020' then 1 when '021' then 2 when '022' then 3
    when '023' then 4 when '024' then 5 when '025' then 6 when 'SUMMARY' then 7
    else 9 end,
  case category
    when '020_READY' then 0 when '021_READY' then 1 when '022_READY' then 2
    when '023_READY' then 3 when '024_READY_TO_APPLY' then 4 when '025_READY_TO_APPLY' then 5
    else 10 end,
  category, object_name;

-- =============================================================================
-- OPSİYONEL (ayrı çalıştır): schema_migrations VARSA version metadata
-- Yalnız SELECT. Tablo yoksa çalıştırmayın. ANA sorguya DAHİL ETMEYİN.
-- =============================================================================
-- select version, name
-- from supabase_migrations.schema_migrations
-- where version ~ '(020|021|022|023|024|025)'
--    or name ~ '(020|021|022|023|024|025|cloud_storage|learning_memory_policies|rbac_profile|company_membership|security_dr|security_view)'
-- order by version;
