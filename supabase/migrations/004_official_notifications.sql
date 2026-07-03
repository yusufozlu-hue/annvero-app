-- Resmi bildirim & tebligat takibi (GİB, SGK, UETS, KEP)

create table if not exists public.official_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  channel text not null check (channel in ('gib', 'sgk', 'uets', 'kep')),
  title text not null,
  summary text,
  reference_no text,
  notification_date date,
  status text not null default 'unread' check (status in ('unread', 'read', 'archived')),
  metadata jsonb default '{}'::jsonb,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gib_check_reminders (
  id uuid primary key default gen_random_uuid(),
  company_id text,
  enabled boolean not null default true,
  interval_days integer not null default 1 check (interval_days >= 1),
  reminder_time text not null default '09:00',
  last_check_at timestamptz,
  next_check_at timestamptz,
  push_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_official_notifications_company_channel
  on public.official_notifications (company_id, channel, created_at desc);

create index if not exists idx_official_notifications_channel_status
  on public.official_notifications (channel, status, notification_date desc);

create index if not exists idx_gib_check_reminders_company
  on public.gib_check_reminders (company_id);

alter table public.official_notifications enable row level security;
alter table public.gib_check_reminders enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "official_notifications_authenticated_all"
  on public.official_notifications
  for all
  to authenticated, anon
  using (true)
  with check (true);

create policy "gib_check_reminders_authenticated_all"
  on public.gib_check_reminders
  for all
  to authenticated, anon
  using (true)
  with check (true);

create policy "push_subscriptions_authenticated_all"
  on public.push_subscriptions
  for all
  to authenticated, anon
  using (true)
  with check (true);
