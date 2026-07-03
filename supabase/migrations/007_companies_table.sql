-- Firma ana kayıt tablosu (CompanyManagement / firma yönetimi)
-- Not: Tablo yoksa Supabase SQL Editor'da bu dosyayı çalıştırın.

create table if not exists public.companies (
  id text primary key,
  company_name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_companies_company_name
  on public.companies (company_name);

create index if not exists idx_companies_updated_at
  on public.companies (updated_at desc);

create index if not exists idx_companies_created_at
  on public.companies (created_at asc);

create or replace function public.companies_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_companies_set_updated_at on public.companies;

create trigger trg_companies_set_updated_at
before update on public.companies
for each row
execute function public.companies_set_updated_at();

alter table public.companies enable row level security;

drop policy if exists "companies_authenticated_all" on public.companies;

create policy "companies_authenticated_all"
  on public.companies
  for all
  to authenticated, anon
  using (true)
  with check (true);

comment on table public.companies is
  'Firma ana kayıtları. Detay alanları data jsonb içinde saklanır.';

comment on column public.companies.id is
  'Firma UUID (company_gib_credentials.company_id ile eşleşir)';

comment on column public.companies.company_name is
  'Firma adı (liste ve arama için denormalize)';

comment on column public.companies.data is
  'Firma detayları: iletişim, banka, modüller, personel vb.';
