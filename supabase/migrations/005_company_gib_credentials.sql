-- Firma bazlı GİB kimlik bilgileri (şifreler şifreli saklanır)

create table if not exists public.company_gib_credentials (
  id uuid primary key default gen_random_uuid(),
  company_id text not null unique,
  gib_user_code text not null,
  encrypted_password text not null,
  encrypted_parola text,
  is_active boolean not null default true,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gib_company_query_state (
  company_id text primary key,
  last_query_at timestamptz,
  result_status text,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists public.gib_query_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  status text not null default 'awaiting_verification',
  result_status text,
  storage_state jsonb,
  captcha_image_base64 text,
  error_message text,
  scraped_notifications jsonb default '[]'::jsonb,
  new_notification_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists idx_gib_query_sessions_company
  on public.gib_query_sessions (company_id, created_at desc);

create index if not exists idx_gib_query_sessions_expires
  on public.gib_query_sessions (expires_at);

alter table public.company_gib_credentials enable row level security;
alter table public.gib_company_query_state enable row level security;
alter table public.gib_query_sessions enable row level security;

create policy "company_gib_credentials_authenticated_all"
  on public.company_gib_credentials
  for all
  to authenticated, anon
  using (true)
  with check (true);

create policy "gib_company_query_state_authenticated_all"
  on public.gib_company_query_state
  for all
  to authenticated, anon
  using (true)
  with check (true);

create policy "gib_query_sessions_authenticated_all"
  on public.gib_query_sessions
  for all
  to authenticated, anon
  using (true)
  with check (true);
