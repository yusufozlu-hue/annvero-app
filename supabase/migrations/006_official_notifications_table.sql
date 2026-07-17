-- official_notifications — idempotent uyumluluk migration'ı (canonical: source şeması)
-- - 004 hiç çalışmadıysa: canonical tabloyu tek başına oluşturur.
-- - 004 daha önce çalıştıysa (channel şeması): eksik kolonları ekler ve
--   channel değerlerini source'a güvenli taşır.
-- - Boş veya dolu tabloda hata vermez. Veri silmez / drop table yapmaz.

-- 1) Canonical tablo yoksa oluştur (source başlangıçta nullable — backfill için).
create table if not exists public.official_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  source text,
  notification_type text not null default 'tebligat',
  title text not null,
  reference_no text,
  served_date date,
  due_date date,
  status text not null default 'unread',
  priority text not null default 'normal',
  description text,
  file_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) 006'nın gerektirdiği kolonları garanti et (004'ten geliniyorsa eksikleri ekler).
alter table public.official_notifications
  add column if not exists source text,
  add column if not exists notification_type text not null default 'tebligat',
  add column if not exists served_date date,
  add column if not exists due_date date,
  add column if not exists priority text not null default 'normal',
  add column if not exists description text,
  add column if not exists file_url text;

-- 3) 004 (channel/notification_date) şemasından güvenli veri taşıma.
do $$
begin
  -- channel -> source (source boşsa)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'official_notifications'
      and column_name = 'channel'
  ) then
    execute $sql$
      update public.official_notifications
      set source = channel
      where source is null and channel is not null
    $sql$;
  end if;

  -- notification_date -> served_date (served_date boşsa) — veri kaybı yok
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'official_notifications'
      and column_name = 'notification_date'
  ) then
    execute $sql$
      update public.official_notifications
      set served_date = notification_date
      where served_date is null and notification_date is not null
    $sql$;
  end if;
end $$;

-- 4) source için gib/sgk/uets/kep kontrolünü koru (null'a toleranslı, idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'official_notifications_source_check'
      and conrelid = 'public.official_notifications'::regclass
  ) then
    if not exists (
      select 1 from public.official_notifications
      where source is not null
        and source not in ('gib', 'sgk', 'uets', 'kep')
    ) then
      execute $sql$
        alter table public.official_notifications
          add constraint official_notifications_source_check
          check (source is null or source in ('gib', 'sgk', 'uets', 'kep'))
      $sql$;
    else
      raise notice '006: source check atlandı — geçersiz mevcut source değerleri var';
    end if;
  end if;
end $$;

-- 5) 006 şemasının gerektirdiği indexler.
create index if not exists idx_official_notifications_company_source
  on public.official_notifications (company_id, source, created_at desc);

create index if not exists idx_official_notifications_source_status
  on public.official_notifications (source, status, served_date desc);

create index if not exists idx_official_notifications_company_reference
  on public.official_notifications (company_id, reference_no);

create index if not exists idx_official_notifications_served_date
  on public.official_notifications (served_date desc nulls last);

-- 6) updated_at trigger.
create or replace function public.official_notifications_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_official_notifications_set_updated_at on public.official_notifications;

create trigger trg_official_notifications_set_updated_at
before update on public.official_notifications
for each row
execute function public.official_notifications_set_updated_at();

-- 7) RLS aç + geçici açık policy (015 daha sonra sıkılaştırılmış policy'lerle değiştirir).
alter table public.official_notifications enable row level security;

drop policy if exists "official_notifications_authenticated_all" on public.official_notifications;

create policy "official_notifications_authenticated_all"
  on public.official_notifications
  for all
  to authenticated, anon
  using (true)
  with check (true);

comment on table public.official_notifications is
  'Resmi bildirim ve tebligat kayıtları (GİB, SGK, UETS, KEP). Canonical şema: source.';

comment on column public.official_notifications.source is
  'Bildirim kaynağı: gib | sgk | uets | kep';
