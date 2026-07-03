-- official_notifications tablosu (GİB / SGK / UETS / KEP ortak bildirim kaydı)
-- Not: 004 migration uygulanmadıysa bu dosyayı Supabase SQL Editor'da çalıştırın.

create table if not exists public.official_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  source text not null check (source in ('gib', 'sgk', 'uets', 'kep')),
  notification_type text not null default 'tebligat',
  title text not null,
  reference_no text,
  served_date date,
  due_date date,
  status text not null default 'unread' check (status in ('unread', 'read', 'archived')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  description text,
  file_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_official_notifications_company_source
  on public.official_notifications (company_id, source, created_at desc);

create index if not exists idx_official_notifications_source_status
  on public.official_notifications (source, status, served_date desc);

create index if not exists idx_official_notifications_company_reference
  on public.official_notifications (company_id, reference_no);

create index if not exists idx_official_notifications_served_date
  on public.official_notifications (served_date desc nulls last);

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

alter table public.official_notifications enable row level security;

drop policy if exists "official_notifications_authenticated_all" on public.official_notifications;

create policy "official_notifications_authenticated_all"
  on public.official_notifications
  for all
  to authenticated, anon
  using (true)
  with check (true);

comment on table public.official_notifications is
  'Resmi bildirim ve tebligat kayıtları (GİB, SGK, UETS, KEP).';

comment on column public.official_notifications.source is
  'Bildirim kaynağı: gib | sgk | uets | kep';

comment on column public.official_notifications.notification_type is
  'Bildirim türü (ör. tebligat, ihbarneme, ödeme emri)';

comment on column public.official_notifications.served_date is
  'Tebligat/bildirim tarihi';

comment on column public.official_notifications.due_date is
  'Son tarih / cevap süresi bitişi';
