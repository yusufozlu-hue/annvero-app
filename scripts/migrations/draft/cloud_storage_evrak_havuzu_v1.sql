-- ANNVERO Cloud Storage / Evrak Havuzu V1 — SQL TASLAĞI
-- ÇALIŞTIRMA: Bu dosya draft’tır. Uygulanmadı / migrate edilmedi.
-- Yol: scripts/migrations/draft/cloud_storage_evrak_havuzu_v1.sql

-- Bağlantı (kullanıcı/hesap düzeyi) — token’lar yalnız şifreli referans ile
create table if not exists public.cloud_storage_connections (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  provider text not null check (provider in ('google_drive')),
  account_email text,
  access_scope text,
  token_reference text, -- encrypted blob / vault ref; plaintext yasak
  status text not null default 'disconnected',
  connected_at timestamptz,
  last_refresh_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cloud_storage_connections_user
  on public.cloud_storage_connections (user_id, provider);

-- Firma klasör eşlemesi
create table if not exists public.company_cloud_folders (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  connection_id uuid references public.cloud_storage_connections (id) on delete set null,
  root_folder_id text not null,
  root_folder_name text,
  folder_structure_version text not null default 'v1',
  sync_status text not null default 'idle',
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, root_folder_id)
);

create index if not exists idx_company_cloud_folders_company
  on public.company_cloud_folders (company_id);

-- Ortak belge indeksi (tüm modüller)
create table if not exists public.document_index (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  provider text not null default 'google_drive',
  provider_file_id text not null,
  parent_folder_id text,
  file_name text not null,
  mime_type text,
  file_size bigint,
  file_hash text,
  document_category text,
  document_type text,
  period_key text,
  revision_no integer not null default 0,
  source_path text,
  parse_status text not null default 'indexed',
  parser_version text,
  normalized_record_id text,
  last_modified_at timestamptz,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider_file_id)
);

create unique index if not exists uq_document_index_company_hash
  on public.document_index (company_id, file_hash)
  where file_hash is not null
    and file_hash <> ''
    and parse_status not in ('soft_deleted');

create index if not exists idx_document_index_company_period
  on public.document_index (company_id, period_key);

-- Sync olay günlüğü
create table if not exists public.document_sync_events (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  provider_file_id text,
  event_type text not null,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_document_sync_events_company
  on public.document_sync_events (company_id, created_at desc);

-- RLS taslakları (uygulama anında sıkılaştırılacak)
alter table public.cloud_storage_connections enable row level security;
alter table public.company_cloud_folders enable row level security;
alter table public.document_index enable row level security;
alter table public.document_sync_events enable row level security;
