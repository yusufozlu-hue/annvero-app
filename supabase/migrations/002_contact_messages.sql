-- ANNVERO iletişim widget form mesajları

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  message text not null,
  source text not null default 'contact_widget',
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create index if not exists idx_contact_messages_created_at
  on public.contact_messages (created_at desc);

create index if not exists idx_contact_messages_status
  on public.contact_messages (status, created_at desc);

alter table public.contact_messages enable row level security;

-- Herkese açık iletişim formu: yalnızca yeni kayıt ekleme
create policy "contact_messages_public_insert"
  on public.contact_messages
  for insert
  to anon, authenticated
  with check (true);
