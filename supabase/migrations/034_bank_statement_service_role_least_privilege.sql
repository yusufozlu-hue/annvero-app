-- ANNVERO 034 — Bank statement service_role least-privilege correction
-- Forward-only, idempotent. Destructive SQL YOK (DROP TABLE / DELETE / TRUNCATE yok).
-- 033 değiştirilmez; 033 sonrası service_role üzerinde kalan ALL kalıntılarını temizler.
-- Staging (031+032+033) ve production (031[+033], 032 opsiyonel) için güvenli skip.
--
-- Amaç (mevcut tablolar için):
--   * service_role: ALL revoke → yalnız SELECT/INSERT/UPDATE/DELETE
--     (REFERENCES/TRIGGER/TRUNCATE kalmasın; TRUNCATE RLS bypass eder)
--   * authenticated: yalnız SELECT
--   * anon / PUBLIC: yetkisiz
--   * postgres owner yetkilerine dokunulmaz
--   * sequence: service_role yalnız USAGE/SELECT; anon/authenticated/PUBLIC yetkisiz
--   * trigger fn EXECUTE: yalnız owner (postgres) + service_role

do $$
declare
  t text;
  tables text[] := array[
    'bank_statement_sources',
    'bank_statement_movements',
    'bank_statement_movement_resolutions'
  ];
begin
  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice '034 skip table (not present yet): %', t;
      continue;
    end if;

    -- PUBLIC + anon + authenticated: temiz slate (owner/postgres dokunulmaz)
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);

    -- authenticated: yalnız SELECT
    execute format('grant select on table public.%I to authenticated', t);

    -- service_role: ALL kalıntısını (REFERENCES/TRIGGER/TRUNCATE) temizle, dar DML ver
    execute format('revoke all on table public.%I from service_role', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      t
    );

    raise notice '034 service_role least-privilege: public.%', t;
  end loop;
end $$;

-- Trigger functions: EXECUTE yalnız owner + service_role
do $$
declare
  fn text;
  funcs text[] := array[
    'bank_statement_sources_set_updated_at',
    'bank_statement_movement_resolutions_set_updated_at'
  ];
begin
  foreach fn in array funcs loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = fn
        and pg_get_function_identity_arguments(p.oid) = ''
    ) then
      raise notice '034 skip function (not present yet): %()', fn;
      continue;
    end if;

    execute format(
      'revoke all on function public.%I() from public',
      fn
    );
    execute format(
      'revoke all on function public.%I() from anon',
      fn
    );
    execute format(
      'revoke all on function public.%I() from authenticated',
      fn
    );
    -- Temiz slate: service_role'a yalnız EXECUTE (owner/postgres dokunulmaz)
    execute format(
      'revoke all on function public.%I() from service_role',
      fn
    );
    execute format(
      'grant execute on function public.%I() to service_role',
      fn
    );

    raise notice '034 function EXECUTE minimized: public.%()', fn;
  end loop;
end $$;

-- Owned sequence varsa: service_role USAGE/SELECT; anon/authenticated/PUBLIC yetkisiz
do $$
declare
  t text;
  seq regclass;
  tables text[] := array[
    'bank_statement_sources',
    'bank_statement_movements',
    'bank_statement_movement_resolutions'
  ];
begin
  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    for seq in
      select s.oid::regclass
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_depend d on d.refobjid = c.oid and d.deptype = 'a'
      join pg_class s on s.oid = d.objid and s.relkind = 'S'
      where n.nspname = 'public'
        and c.relname = t
    loop
      execute format('revoke all on sequence %s from public', seq);
      execute format('revoke all on sequence %s from anon', seq);
      execute format('revoke all on sequence %s from authenticated', seq);
      execute format('revoke all on sequence %s from service_role', seq);
      execute format('grant usage, select on sequence %s to service_role', seq);
      raise notice '034 sequence least-privilege: %', seq;
    end loop;
  end loop;
end $$;
