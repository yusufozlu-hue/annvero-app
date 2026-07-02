-- ANNVERO mevzuat parametreleri tablosu
-- Supabase SQL Editor üzerinden çalıştırılabilir.

create table if not exists public.mevzuat_parametreleri (
  id text primary key,
  module_key text not null,
  parameter_key text not null,
  parameter_name text not null,
  year integer not null,
  period text not null default 'Yıllık',
  value text not null,
  description text,
  valid_from date,
  valid_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mevzuat_parametreleri_module
  on public.mevzuat_parametreleri (module_key, year, is_active);

create unique index if not exists uq_mevzuat_parametreleri_key
  on public.mevzuat_parametreleri (module_key, parameter_key, year, period);

alter table public.mevzuat_parametreleri enable row level security;

-- Admin kullanıcılar service role veya özel policy ile yönetir.
-- İlk kurulumda authenticated admin policy tanımlanmalıdır.
