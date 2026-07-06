-- Mevzuat Hap Notları modülü

create table if not exists public.mevzuat_hap_notlari (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text not null default 'Diğer' check (
    source in (
      'GİB',
      'SGK',
      'Resmî Gazete',
      'TÜRMOB',
      'İSMMMO',
      'Ticaret Bakanlığı',
      'TCMB',
      'KOSGEB',
      'Diğer'
    )
  ),
  source_url text,
  category text not null default 'Diğer' check (
    category in (
      'Vergi',
      'SGK',
      'E-Belge',
      'Teşvik',
      'Ticaret',
      'Finans',
      'Diğer'
    )
  ),
  summary text not null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_pinned boolean not null default false,
  is_active boolean not null default true
);

create index if not exists idx_mevzuat_hap_notlari_active_order
  on public.mevzuat_hap_notlari (is_active, is_pinned desc, published_at desc);

create index if not exists idx_mevzuat_hap_notlari_category
  on public.mevzuat_hap_notlari (category, published_at desc);

create index if not exists idx_mevzuat_hap_notlari_source
  on public.mevzuat_hap_notlari (source, published_at desc);

create or replace function public.mevzuat_hap_notlari_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mevzuat_hap_notlari_set_updated_at on public.mevzuat_hap_notlari;

create trigger trg_mevzuat_hap_notlari_set_updated_at
before update on public.mevzuat_hap_notlari
for each row
execute function public.mevzuat_hap_notlari_set_updated_at();

alter table public.mevzuat_hap_notlari enable row level security;

drop policy if exists "mevzuat_hap_notlari_public_read" on public.mevzuat_hap_notlari;
drop policy if exists "mevzuat_hap_notlari_authenticated_write" on public.mevzuat_hap_notlari;

create policy "mevzuat_hap_notlari_public_read"
  on public.mevzuat_hap_notlari
  for select
  to authenticated, anon
  using (true);

create policy "mevzuat_hap_notlari_authenticated_write"
  on public.mevzuat_hap_notlari
  for all
  to authenticated
  using (true)
  with check (true);

comment on table public.mevzuat_hap_notlari is
  'Vergi, SGK ve mali mevzuat duyuruları için kısa hap not kayıtları.';
