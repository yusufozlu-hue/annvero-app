-- ANNVERO Güvenlik — legacy learning_memory public policy temizliği
-- 015 daha önce production'da uygulanmış olsa bile, eski açık (public) policy'lerin
-- kalıcı temizliğini garanti eder. Idempotent ve fail-safe.
-- - learning_memory yoksa notice verip güvenle atlar.
-- - Tablo veya veri SİLMEZ; yalnızca policy düşürür.
-- - RLS'yi açık bırakır.

do $$
begin
  if to_regclass('public.learning_memory') is null then
    raise notice '021 skip: public.learning_memory yok';
    return;
  end if;

  execute 'alter table public.learning_memory enable row level security';

  execute 'drop policy if exists "allow learning memory delete" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory insert" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory read" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory update" on public.learning_memory';

  raise notice '021: legacy learning_memory public policy temizliği tamamlandı';
end $$;
