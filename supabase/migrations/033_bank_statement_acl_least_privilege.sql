-- ANNVERO 033 — Bank statement snapshot ACL least-privilege harden
-- Forward-only, idempotent. Destructive SQL YOK (DROP TABLE yok).
-- 031 dosyası değiştirilmez; production'da 031 uygulandıktan sonra çalıştırılır.
-- Staging (031+032 varsa) ve production (yalnız 031) için güvenli.
--
-- Amaç:
--   * anon: hiçbir tablo yetkisi yok
--   * authenticated: yalnız SELECT (REFERENCES/TRIGGER/TRUNCATE kaldırılır)
--   * service_role: SELECT/INSERT/UPDATE/DELETE (API yazma yolu; ALL gereksiz)
--   * trigger function EXECUTE: PUBLIC/anon/authenticated revoke; owner/service_role yeterli
--
-- Not: PostgreSQL'de TRUNCATE RLS'yi bypass eder (table privilege). Bu yüzden
-- authenticated üzerinde TRUNCATE bırakılamaz.

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
      raise notice '033 skip table (not present yet): %', t;
      continue;
    end if;

    -- PUBLIC + anon + authenticated: temiz slate
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);

    -- authenticated: yalnız SELECT
    execute format('grant select on table public.%I to authenticated', t);

    -- service_role: API server-side yazma (service_role RLS bypass eder)
    -- ALL yerine dar DML: SELECT/INSERT/UPDATE/DELETE
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      t
    );

    raise notice '033 ACL hardened: public.%', t;
  end loop;
end $$;

-- Trigger functions: EXECUTE'u PUBLIC'ten kaldır (default EXECUTE PUBLIC riski)
do $$
declare
  fn text;
  -- 031 creates only sources_set_updated_at; movements has no updated_at trigger.
  -- resolutions fn appears after 032.
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
      raise notice '033 skip function (not present yet): %()', fn;
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
    -- Trigger owner (postgres) EXECUTE eder; service_role'a açık tutmak zararsız
    execute format(
      'grant execute on function public.%I() to service_role',
      fn
    );

    raise notice '033 function EXECUTE minimized: public.%()', fn;
  end loop;
end $$;

-- UUID PK: owned sequence yok. Yine de varsa daralt.
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
      execute format('grant usage, select on sequence %s to service_role', seq);
      raise notice '033 sequence hardened: %', seq;
    end loop;
  end loop;
end $$;
