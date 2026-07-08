-- Strengthen annvero_user_profiles access:
-- - authenticated users read only their own row (by email)
-- - service_role keeps full access for server-side profile APIs

alter table public.annvero_user_profiles enable row level security;

drop policy if exists "annvero_user_profiles_authenticated_read" on public.annvero_user_profiles;
drop policy if exists "annvero_user_profiles_self_read" on public.annvero_user_profiles;
drop policy if exists "annvero_user_profiles_service_all" on public.annvero_user_profiles;

create policy "annvero_user_profiles_self_read"
  on public.annvero_user_profiles
  for select
  to authenticated
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "annvero_user_profiles_service_all"
  on public.annvero_user_profiles
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.annvero_user_profiles is
  'ANNVERO RBAC profilleri. Server API service_role ile yazar; kullanıcı kendi satırını okuyabilir.';
