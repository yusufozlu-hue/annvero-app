-- ANNVERO kullanıcı profilleri, firma erişimi ve modül yetkileri
-- auth.users ile e-posta üzerinden eşleşir; id login sonrası güncellenir.

create table if not exists public.annvero_user_profiles (
  id text primary key,
  email text not null unique,
  display_name text not null default '',
  role text not null default 'muhasebe_personeli',
  permissions jsonb not null default '[]'::jsonb,
  company_ids jsonb not null default '[]'::jsonb,
  team_id text not null default '',
  is_active boolean not null default true,
  password_reset_requested_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_annvero_user_profiles_email
  on public.annvero_user_profiles (lower(email));

create index if not exists idx_annvero_user_profiles_role
  on public.annvero_user_profiles (role);

create index if not exists idx_annvero_user_profiles_active
  on public.annvero_user_profiles (is_active);

create or replace function public.annvero_user_profiles_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_annvero_user_profiles_set_updated_at on public.annvero_user_profiles;

create trigger trg_annvero_user_profiles_set_updated_at
before update on public.annvero_user_profiles
for each row
execute function public.annvero_user_profiles_set_updated_at();

alter table public.annvero_user_profiles enable row level security;

drop policy if exists "annvero_user_profiles_authenticated_read" on public.annvero_user_profiles;

create policy "annvero_user_profiles_authenticated_read"
  on public.annvero_user_profiles
  for select
  to authenticated
  using (true);

comment on table public.annvero_user_profiles is
  'ANNVERO RBAC profilleri. company_ids boş = tüm firmalar (admin/partner).';
