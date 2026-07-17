-- ANNVERO Google Drive / Evrak Havuzu V1
-- Uygulama erişimi yalnız server-side service_role üzerinden yapılır.

create table if not exists public.cloud_storage_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'google_drive'),
  account_email text,
  access_scope text not null default 'https://www.googleapis.com/auth/drive.file',
  token_reference text,
  status text not null default 'disconnected' check (status in ('connected','disconnected','error')),
  connected_at timestamptz,
  last_refresh_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.company_cloud_folders (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  connection_id uuid references public.cloud_storage_connections(id) on delete set null,
  root_folder_id text not null,
  root_folder_name text,
  folder_structure_version text not null default 'v1',
  sync_status text not null default 'idle' check (sync_status in ('idle','syncing','ok','error','disconnected')),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id),
  unique (connection_id, root_folder_id)
);

create table if not exists public.document_index (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  provider text not null default 'google_drive' check (provider = 'google_drive'),
  provider_file_id text not null,
  parent_folder_id text,
  file_name text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  file_hash text,
  document_category text,
  document_type text,
  period_key text,
  revision_no integer not null default 0 check (revision_no >= 0),
  source_path text,
  parse_status text not null default 'indexed',
  parser_version text,
  normalized_record_id text,
  last_modified_at timestamptz,
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider_file_id)
);

create table if not exists public.document_sync_events (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  provider_file_id text,
  event_type text not null,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_document_index_company_hash
  on public.document_index (company_id, file_hash)
  where file_hash is not null and file_hash <> '' and parse_status <> 'soft_deleted';
create index if not exists idx_cloud_connections_user on public.cloud_storage_connections(user_id, provider);
create index if not exists idx_cloud_folders_company on public.company_cloud_folders(company_id);
create index if not exists idx_document_index_company_period on public.document_index(company_id, period_key);
create index if not exists idx_document_sync_events_company on public.document_sync_events(company_id, created_at desc);

alter table public.cloud_storage_connections enable row level security;
alter table public.company_cloud_folders enable row level security;
alter table public.document_index enable row level security;
alter table public.document_sync_events enable row level security;

-- Fail-closed: anon/authenticated için policy yok; service_role RLS bypass eder.
revoke all on public.cloud_storage_connections from anon, authenticated;
revoke all on public.company_cloud_folders from anon, authenticated;
revoke all on public.document_index from anon, authenticated;
revoke all on public.document_sync_events from anon, authenticated;

create or replace function public.cloud_storage_set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_cloud_connections_updated_at on public.cloud_storage_connections;
create trigger trg_cloud_connections_updated_at before update on public.cloud_storage_connections
for each row execute function public.cloud_storage_set_updated_at();
drop trigger if exists trg_company_cloud_folders_updated_at on public.company_cloud_folders;
create trigger trg_company_cloud_folders_updated_at before update on public.company_cloud_folders
for each row execute function public.cloud_storage_set_updated_at();
drop trigger if exists trg_document_index_updated_at on public.document_index;
create trigger trg_document_index_updated_at before update on public.document_index
for each row execute function public.cloud_storage_set_updated_at();

comment on column public.cloud_storage_connections.token_reference is
  'AES-256-GCM encrypted OAuth token bundle; plaintext token yasaktır.';
